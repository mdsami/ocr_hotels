"""
Helpers for turning raw uploaded bytes into the base64 data URIs Groq's
multimodal API expects, plus light validation/normalization with Pillow.
"""
import base64
import io

from PIL import Image

MAX_DIMENSION = 2000  # px, keeps payloads reasonable without hurting OCR quality
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


def validate_and_normalize_image(raw_bytes: bytes) -> bytes:
    """
    Opens the image to confirm it's valid, downsizes it if it's huge, strips
    EXIF/metadata, and re-encodes as JPEG. Raises ValueError on bad input.
    """
    try:
        img = Image.open(io.BytesIO(raw_bytes))
        img.load()
    except Exception as e:
        raise ValueError(f"Uploaded file is not a readable image: {e}")

    # Flatten to RGB (handles PNG transparency, CMYK, etc.)
    if img.mode != "RGB":
        img = img.convert("RGB")

    # Downscale if needed, preserving aspect ratio
    if max(img.size) > MAX_DIMENSION:
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def bytes_to_data_uri(raw_bytes: bytes, mime: str = "image/jpeg") -> str:
    encoded = base64.b64encode(raw_bytes).decode("utf-8")
    return f"data:{mime};base64,{encoded}"
