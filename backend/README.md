# ID & Card Extraction Backend

FastAPI + LangGraph + LangChain backend that classifies an uploaded document
image (passport, driver license, national ID, or bank card) and extracts
structured fields using Groq's `qwen3.6-27b` multimodal model.

## Architecture

```
Upload (image bytes)
      │
      ▼
validate & normalize (Pillow: strip EXIF, downscale, re-encode JPEG)
      │
      ▼
upload to S3 (boto3, random key, presigned URL returned)
      │
      ▼
LangGraph pipeline
  ┌─────────────┐
  │  classify   │  -> ChatGroq + structured output -> DocumentType
  └──────┬──────┘
         │ (conditional routing on document_type)
  ┌──────┴───────────────────────────────────┐
  ▼            ▼               ▼             ▼
passport   driver_license  national_id   bank_card   (each: ChatGroq +
  │            │               │             │        schema-specific
  └──────┬─────┴───────┬───────┴──────┬──────┘        prompt)
         ▼
     validate node (IBAN regex check, re-mask card numbers defensively,
                     confidence warnings)
         ▼
     ExtractionResponse (JSON)
```

Each extraction node is bound to its own Pydantic schema via
`with_structured_output`, so Groq's JSON reply is parsed & validated
automatically — no manual JSON parsing or regex scraping of model output.

## Setup

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# then edit .env and set GROQ_API_KEY (get one at https://console.groq.com/keys)
# and the AWS_* / S3_BUCKET_NAME vars for upload storage
```

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

Swagger UI: http://localhost:8000/docs

## API

### `POST /extract`

`multipart/form-data`:
- `file`: image file (jpeg/png/webp), max 10MB
- `hint` (optional): free text hint like `"passport"` to help classification

Response:
```json
{
  "document_type": "passport",
  "classification_confidence": 0.97,
  "fields": {
    "given_names": "JOHN MICHAEL",
    "surname": "DOE",
    "date_of_birth": "1990-05-14",
    "nationality": "GERMAN",
    "sex": "M",
    "passport_number": "C01X23456",
    "date_of_issue": "2021-03-01",
    "date_of_expiry": "2031-03-01",
    "place_of_birth": "BERLIN",
    "issuing_country": "DEU",
    "mrz_raw": "P<DEUDOE<<JOHN<MICHAEL<<<<<<<<<<<<<<<<<<<<<\n..."
  },
  "warnings": [],
  "raw_model_notes": "Clear, well-lit passport photo page with legible MRZ.",
  "s3_key": "uploads/3f1b2c4a-....jpg",
  "s3_url": "https://<bucket>.s3.amazonaws.com/uploads/3f1b2c4a-....jpg?X-Amz-..."
}
```

The uploaded image is stored in S3 under a random key (never a public URL) —
`s3_url` is a presigned GET URL valid for 1 hour.

### `GET /health`
Simple liveness check.

## Security notes (please read before production use)

- **Bank card numbers**: the extraction prompt instructs the model to only
  ever return a masked card number (last 4 digits). The `validate` node also
  defensively re-masks anything the model leaks in full, as a second layer.
- **S3 storage**: uploaded images are stored in S3 under a random UUID key
  (`uploads/<uuid>.jpg`). The bucket should be **private** — the API never
  makes objects public, it only returns short-lived (1 hour) presigned URLs.
  Enable default encryption (SSE-S3 or SSE-KMS) on the bucket and scope the
  IAM credentials to `s3:PutObject` / `s3:GetObject` on that one bucket.
  Treat this as PII/KYC data (GDPR / local data-protection law applies) —
  add a lifecycle rule to expire/delete objects if you don't need to retain
  them.
- **Transport security**: run behind HTTPS in any real deployment; do not
  send document images over plain HTTP.
- **CORS**: `CORS_ORIGINS` in `.env` should be locked down to your real
  frontend origin(s) in production — don't leave it wildcarded.
- **Groq data usage**: review Groq's data retention/processing policy before
  sending real identity documents to their API in production.
