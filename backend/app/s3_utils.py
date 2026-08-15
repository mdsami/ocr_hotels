"""
Thin wrapper around boto3 for storing uploaded document images in S3.

Uploads go under a random key so nothing about the stored object name
reveals document contents. We never make objects public — callers get a
short-lived presigned URL instead.
"""
import os
import uuid

import boto3
from botocore.exceptions import BotoCoreError, ClientError

PRESIGNED_URL_EXPIRY_SECONDS = 3600

_s3_client = None


def _get_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
        )
    return _s3_client


def upload_image(raw_bytes: bytes, content_type: str = "image/jpeg") -> dict:
    """
    Uploads image bytes to the configured S3 bucket under a random key.
    Returns {"s3_key": ..., "s3_url": ...} where s3_url is a presigned GET
    URL valid for PRESIGNED_URL_EXPIRY_SECONDS. Raises RuntimeError if
    S3_BUCKET_NAME isn't set or the upload fails.
    """
    bucket = os.environ.get("S3_BUCKET_NAME")
    if not bucket:
        raise RuntimeError(
            "S3_BUCKET_NAME is not set. Copy .env.example to .env and configure it."
        )

    key = f"uploads/{uuid.uuid4()}.jpg"
    client = _get_client()
    try:
        client.put_object(Bucket=bucket, Key=key, Body=raw_bytes, ContentType=content_type)
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=PRESIGNED_URL_EXPIRY_SECONDS,
        )
    except (BotoCoreError, ClientError) as e:
        raise RuntimeError(f"S3 upload failed: {e}")

    return {"s3_key": key, "s3_url": url}
