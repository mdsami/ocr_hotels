# Docscan — Passport / Driver License / ID / Bank Card Extraction

Upload one document image at a time (passport, driver license, national ID,
or bank card) and get structured fields back — powered by Groq's
`qwen3.6-27b` multimodal model, orchestrated with LangGraph + LangChain,
served via FastAPI.

## Project layout

```
backend/    FastAPI + LangGraph + LangChain + Groq
frontend/   React + Vite single-page app
```

## Quick start

**1. Backend**
```bash
cd backend
python3 -m venv venv && 


pip install -r requirements.txt
cp .env.example .env   # add your GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

**2. Frontend**
```bash
cd frontend
npm install
npm run dev             # opens on http://localhost:5173
```

The frontend calls `http://localhost:8000/extract` by default — edit
`API_BASE` at the top of `src/App.jsx` if your backend runs elsewhere.

## What each document type extracts

| Document | Fields |
|---|---|
| Passport | surname, given names, DOB, nationality, sex, passport number, place of birth, issuing country, issue/expiry dates, MRZ |
| Driver license | surname, given names, DOB, nationality, license number, address, categories, issuing authority, issue/expiry dates |
| National ID | surname, given names, DOB, nationality, sex, ID number, place of birth, issue/expiry dates |
| Bank card | cardholder name, bank name, network, masked card number (last 4 only), IBAN, expiry |

See `backend/README.md` for the architecture diagram, API contract, and
security notes (card number masking, no persistence, CORS, etc).
