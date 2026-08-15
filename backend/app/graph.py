"""
LangGraph pipeline for document extraction.

Flow:
    classify_node -> route -> {passport, driver_license, national_id, bank_card}
    extract node  -> validate_node -> END

Each extraction node uses a LangChain ChatGroq model bound to a Pydantic
schema via with_structured_output, so the model's JSON reply is parsed and
validated automatically instead of us hand-rolling JSON parsing.
"""
from __future__ import annotations

import re
import time
from typing import Optional, TypedDict

from groq import BadRequestError as GroqBadRequestError, RateLimitError as GroqRateLimitError
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

from app.llm import get_vision_llm
from app.schemas import (
    ClassificationResult,
    DocumentType,
    PassportFields,
    DriverLicenseFields,
    NationalIDFields,
    BankCardFields,
)


class GraphState(TypedDict, total=False):
    image_data_uri: str
    hint: Optional[str]  # optional user-provided hint, e.g. "this is a passport"
    document_type: str
    classification_confidence: float
    fields: dict
    warnings: list[str]
    notes: Optional[str]


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
CLASSIFY_SYSTEM_PROMPT = """You are a document classification expert for a KYC/identity \
verification system. Look at the image and decide which of these categories it belongs to:

- passport: a passport photo page (has MRZ lines, photo, nationality, passport number)
- driver_license: a driving license / driver's license card
- national_id: a national identity card (not a passport or driver's license)
- bank_card: a debit/credit/bank card (has card number, expiry, network logo)
- unknown: none of the above, unreadable, or not a document at all

Respond only with the structured classification."""

EXTRACT_SYSTEM_PROMPTS = {
    DocumentType.PASSPORT: """You are an expert document data extraction system for passports. \
Extract every field you can clearly read from the passport image. Use the Machine Readable \
Zone (the two lines of text with '<' characters at the bottom) to cross-check and correct the \
visually printed fields if they disagree. If a field is not visible or not legible, leave it null \
— never guess or invent values. Normalize dates to YYYY-MM-DD when the format is unambiguous.""",
    DocumentType.DRIVER_LICENSE: """You are an expert document data extraction system for driver's \
licenses. Extract every field you can clearly read. If a field is not visible or not legible, leave \
it null — never guess or invent values. Normalize dates to YYYY-MM-DD when unambiguous.""",
    DocumentType.NATIONAL_ID: """You are an expert document data extraction system for national ID \
cards. Extract every field you can clearly read. If a field is not visible or not legible, leave it \
null — never guess or invent values. Normalize dates to YYYY-MM-DD when unambiguous.

The card may be photographed sideways or upside down — mentally rotate it to read the text \
before extracting anything. Many national ID cards print field labels in multiple languages \
(e.g. 'Name/Surname/Nom', 'Vorname/Given names/Prénoms', 'Geburtsort/Place of birth/Lieu de \
naissance') stacked in a column, with the corresponding values printed in a separate column or \
block. Carefully pair each value with the label it visually lines up with — do not assume the \
values appear in the same top-to-bottom order as the labels, and never swap the surname with the \
place of birth or the given names; they are frequently printed close together and are easy to \
mix up. If the machine-readable zone (MRZ) or a barcode area repeats the name, use it to \
cross-check and correct the printed surname/given names.""",
    DocumentType.BANK_CARD: """You are an expert document data extraction system for bank cards. \
Extract the cardholder name, bank name (from logo/text), card network (Visa/Mastercard/Amex/etc), \
expiry date, and IBAN if printed. For the card number, ONLY return it masked as \
'**** **** **** 1234' (last 4 digits only) — never output the full card number, for security \
reasons, even if it is fully visible. If a field is not visible, leave it null.""",
}

SCHEMA_BY_TYPE = {
    DocumentType.PASSPORT: PassportFields,
    DocumentType.DRIVER_LICENSE: DriverLicenseFields,
    DocumentType.NATIONAL_ID: NationalIDFields,
    DocumentType.BANK_CARD: BankCardFields,
}


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------
RATE_LIMIT_RETRY_DELAY_SECONDS = 15
RATE_LIMIT_MAX_RETRIES = 2


def _invoke_structured(schema, messages: list[BaseMessage], reasoning_effort: Optional[str] = None, max_tokens: Optional[int] = None):
    """
    Runs a structured-output call against the vision model, with retries.

    qwen3.6-27b "thinks" before answering, and that thinking counts against
    max_tokens. On harder images the thinking trace can occasionally run so
    long it never reaches the tool call, which Groq reports as a 400
    tool_use_failed with an empty failed_generation. If that happens, retry
    once with reasoning_effort="none" to skip the extended thinking pass —
    it trades a bit of reasoning depth for a call that reliably completes.

    Groq's tokens-per-minute limit is shared across every call this process
    makes, so a burst of requests can trip a 429 even when each individual
    call is well within max_tokens. That's a transient condition, not a bad
    request, so we retry it a couple of times with a short delay rather than
    failing the whole extraction.
    """
    llm_kwargs = {}
    if max_tokens is not None:
        llm_kwargs["max_tokens"] = max_tokens

    for attempt in range(RATE_LIMIT_MAX_RETRIES + 1):
        llm = get_vision_llm(temperature=0.0, reasoning_effort=reasoning_effort, **llm_kwargs)
        try:
            return llm.with_structured_output(schema).invoke(messages)
        except GroqBadRequestError as e:
            if "tool_use_failed" not in str(e):
                raise
            fallback_llm = get_vision_llm(temperature=0.0, reasoning_effort="none", **llm_kwargs)
            return fallback_llm.with_structured_output(schema).invoke(messages)
        except GroqRateLimitError:
            if attempt == RATE_LIMIT_MAX_RETRIES:
                raise
            time.sleep(RATE_LIMIT_RETRY_DELAY_SECONDS)


def classify_node(state: GraphState) -> GraphState:
    human_content = [
        {"type": "text", "text": "Classify this document image."},
        {"type": "image_url", "image_url": {"url": state["image_data_uri"]}},
    ]
    if state.get("hint"):
        human_content[0]["text"] += f" User hint: {state['hint']}"

    result: ClassificationResult = _invoke_structured(
        ClassificationResult,
        [
            SystemMessage(content=CLASSIFY_SYSTEM_PROMPT),
            HumanMessage(content=human_content),
        ],
    )

    return {
        "document_type": result.document_type.value,
        "classification_confidence": result.confidence,
        "notes": result.reasoning,
    }


def _extract_with_schema(state: GraphState, doc_type: DocumentType) -> GraphState:
    schema = SCHEMA_BY_TYPE[doc_type]
    system_prompt = EXTRACT_SYSTEM_PROMPTS[doc_type]

    human_content = [
        {"type": "text", "text": "Extract the fields from this document image."},
        {"type": "image_url", "image_url": {"url": state["image_data_uri"]}},
    ]

    result = _invoke_structured(
        schema,
        [
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_content),
        ],
    )

    return {"fields": result.model_dump()}


def extract_passport_node(state: GraphState) -> GraphState:
    return _extract_with_schema(state, DocumentType.PASSPORT)


def extract_driver_license_node(state: GraphState) -> GraphState:
    return _extract_with_schema(state, DocumentType.DRIVER_LICENSE)


def extract_national_id_node(state: GraphState) -> GraphState:
    return _extract_with_schema(state, DocumentType.NATIONAL_ID)


def extract_bank_card_node(state: GraphState) -> GraphState:
    return _extract_with_schema(state, DocumentType.BANK_CARD)


def extract_unknown_node(state: GraphState) -> GraphState:
    return {
        "fields": {},
        "warnings": ["Could not confidently classify the document type."],
    }


IBAN_RE = re.compile(r"^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$")


def validate_node(state: GraphState) -> GraphState:
    warnings = list(state.get("warnings", []))
    fields = dict(state.get("fields", {}))
    doc_type = state.get("document_type")

    if state.get("classification_confidence", 1.0) < 0.6:
        warnings.append(
            "Low confidence classification — please double-check the document type detected."
        )

    if doc_type == DocumentType.BANK_CARD.value:
        iban = fields.get("iban")
        if iban:
            cleaned = iban.replace(" ", "").upper()
            fields["iban"] = cleaned
            if not IBAN_RE.match(cleaned):
                warnings.append("IBAN format looks invalid — please verify manually.")

        card_number = fields.get("card_number_masked")
        if card_number and sum(c.isdigit() for c in card_number) > 4:
            # Model leaked more than last 4 digits; re-mask defensively.
            digits = re.sub(r"\D", "", card_number)
            fields["card_number_masked"] = f"**** **** **** {digits[-4:]}"
            warnings.append("Card number was re-masked for security.")

    # Drop empty/None-only field sets down to null-clean dict but keep keys
    # so the frontend always knows the expected shape.
    if not any(v for v in fields.values()):
        warnings.append("No fields could be confidently extracted from this image.")

    return {"fields": fields, "warnings": warnings}


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------
def route_after_classify(state: GraphState) -> str:
    doc_type = state.get("document_type", DocumentType.UNKNOWN.value)
    mapping = {
        DocumentType.PASSPORT.value: "extract_passport",
        DocumentType.DRIVER_LICENSE.value: "extract_driver_license",
        DocumentType.NATIONAL_ID.value: "extract_national_id",
        DocumentType.BANK_CARD.value: "extract_bank_card",
    }
    return mapping.get(doc_type, "extract_unknown")


# ---------------------------------------------------------------------------
# Build graph
# ---------------------------------------------------------------------------
def build_graph():
    graph = StateGraph(GraphState)

    graph.add_node("classify", classify_node)
    graph.add_node("extract_passport", extract_passport_node)
    graph.add_node("extract_driver_license", extract_driver_license_node)
    graph.add_node("extract_national_id", extract_national_id_node)
    graph.add_node("extract_bank_card", extract_bank_card_node)
    graph.add_node("extract_unknown", extract_unknown_node)
    graph.add_node("validate", validate_node)

    graph.set_entry_point("classify")

    graph.add_conditional_edges(
        "classify",
        route_after_classify,
        {
            "extract_passport": "extract_passport",
            "extract_driver_license": "extract_driver_license",
            "extract_national_id": "extract_national_id",
            "extract_bank_card": "extract_bank_card",
            "extract_unknown": "extract_unknown",
        },
    )

    for node in [
        "extract_passport",
        "extract_driver_license",
        "extract_national_id",
        "extract_bank_card",
        "extract_unknown",
    ]:
        graph.add_edge(node, "validate")

    graph.add_edge("validate", END)

    return graph.compile()


# Compiled once at import time; reused across requests.
document_extraction_graph = build_graph()
