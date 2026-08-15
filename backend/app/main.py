import os
import logging

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.graph import document_extraction_graph
from app.image_utils import validate_and_normalize_image, bytes_to_data_uri, ALLOWED_CONTENT_TYPES
from app.schemas import ExtractionResponse, DocumentType
from app import s3_utils

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("id-extractor")

app = FastAPI(
    title="ID & Card Extraction API",
    description="Uploads a passport / driver license / national ID / bank card image and "
    "extracts structured fields using a Groq multimodal LLM orchestrated with LangGraph.",
    version="1.0.0",
)

origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE_MB = 10


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractionResponse)
async def extract_document(
    file: UploadFile = File(..., description="Image of the passport, driver license, national ID, or bank card"),
    hint: str | None = Form(None, description="Optional hint, e.g. 'passport'"),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{file.content_type}'. Allowed: {sorted(ALLOWED_CONTENT_TYPES)}",
        )

    raw_bytes = await file.read()
    size_mb = len(raw_bytes) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(status_code=400, detail=f"File too large ({size_mb:.1f} MB). Max {MAX_FILE_SIZE_MB} MB.")

    try:
        normalized = validate_and_normalize_image(raw_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    data_uri = bytes_to_data_uri(normalized, mime="image/jpeg")

    try:
        result = document_extraction_graph.invoke({"image_data_uri": data_uri, "hint": hint})
    except RuntimeError as e:
        # e.g. missing GROQ_API_KEY
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception("Extraction pipeline failed")
        raise HTTPException(status_code=502, detail=f"Extraction failed: {e}")

    return ExtractionResponse(
        document_type=DocumentType(result.get("document_type", "unknown")),
        classification_confidence=result.get("classification_confidence", 0.0),
        fields=result.get("fields", {}),
        warnings=result.get("warnings", []),
        raw_model_notes=result.get("notes"),
    )
