"""
Pydantic schemas used for:
1. Structured output contracts we ask the LLM to fill in (via LangChain's
   with_structured_output / JSON mode).
2. Response models returned to the frontend.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional, Literal

from pydantic import BaseModel, Field


class DocumentType(str, Enum):
    PASSPORT = "passport"
    DRIVER_LICENSE = "driver_license"
    NATIONAL_ID = "national_id"
    BANK_CARD = "bank_card"
    UNKNOWN = "unknown"


# ---------------------------------------------------------------------------
# Classification node output
# ---------------------------------------------------------------------------
class ClassificationResult(BaseModel):
    document_type: DocumentType = Field(
        description="The type of identity/financial document shown in the image."
    )
    confidence: float = Field(
        ge=0, le=1, description="Confidence score between 0 and 1."
    )
    reasoning: str = Field(
        description="One short sentence explaining the visual cues used to decide."
    )


# ---------------------------------------------------------------------------
# Per-document extraction contracts
# ---------------------------------------------------------------------------
class PassportFields(BaseModel):
    given_names: Optional[str] = Field(None, description="First / given name(s)")
    surname: Optional[str] = Field(None, description="Family name / surname")
    date_of_birth: Optional[str] = Field(None, description="Format YYYY-MM-DD if determinable, else as printed")
    nationality: Optional[str] = Field(None, description="Nationality as printed on the document")
    sex: Optional[str] = None
    passport_number: Optional[str] = None
    date_of_issue: Optional[str] = None
    date_of_expiry: Optional[str] = None
    place_of_birth: Optional[str] = None
    issuing_country: Optional[str] = None
    mrz_raw: Optional[str] = Field(None, description="Machine readable zone raw text, if visible")


class DriverLicenseFields(BaseModel):
    given_names: Optional[str] = Field(
        None, description="First / given name(s) only — do not include the surname."
    )
    surname: Optional[str] = Field(
        None, description="Family name / last name only — never a place name or address."
    )
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    license_number: Optional[str] = None
    address: Optional[str] = None
    date_of_issue: Optional[str] = None
    date_of_expiry: Optional[str] = None
    vehicle_categories: Optional[str] = Field(None, description="e.g. 'A, B, B1'")
    issuing_authority: Optional[str] = None


class NationalIDFields(BaseModel):
    given_names: Optional[str] = Field(
        None,
        description="First / given name(s) only, printed next to a label such as "
        "'Vorname(n)', 'Given names', 'Prénoms', or 'First name'. Do not include the surname.",
    )
    surname: Optional[str] = Field(
        None,
        description="Family name / last name only, printed next to a label such as "
        "'Name', 'Nachname', 'Surname', or 'Nom'. This is a person's family name — never "
        "the birth city/place, which belongs in place_of_birth.",
    )
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    id_number: Optional[str] = None
    sex: Optional[str] = None
    date_of_issue: Optional[str] = None
    date_of_expiry: Optional[str] = None
    place_of_birth: Optional[str] = Field(
        None,
        description="City/place of birth, printed next to a label such as 'Geburtsort', "
        "'Place of birth', or 'Lieu de naissance'. Never put this value in surname.",
    )


class BankCardFields(BaseModel):
    cardholder_name: Optional[str] = None
    bank_name: Optional[str] = Field(None, description="Issuing bank name if printed/logo identifiable")
    card_number_masked: Optional[str] = Field(
        None, description="Card number with all but last 4 digits masked, e.g. **** **** **** 1234"
    )
    iban: Optional[str] = Field(None, description="IBAN if printed on the card")
    expiry_date: Optional[str] = Field(None, description="MM/YY as printed")
    card_network: Optional[str] = Field(None, description="Visa / Mastercard / etc.")


# ---------------------------------------------------------------------------
# API response envelope
# ---------------------------------------------------------------------------
class ExtractionResponse(BaseModel):
    document_type: DocumentType
    classification_confidence: float
    fields: dict
    warnings: list[str] = Field(default_factory=list)
    raw_model_notes: Optional[str] = Field(
        None, description="Any free-text caveats the model produced (e.g. blurry image)."
    )


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
