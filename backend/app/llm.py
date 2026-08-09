"""
Thin factory around the Groq multimodal chat model via langchain-groq.

We centralize model creation here so the rest of the app never hardcodes
model names or temperature settings.
"""
import os
from typing import Optional

from langchain_groq import ChatGroq

GROQ_VISION_MODEL = "qwen/qwen3.6-27b"

# qwen3.6-27b is a reasoning model: its hidden "thinking" tokens count against
# max_tokens before it ever emits the actual answer/tool call. On harder
# images (rotated cards, multi-language labels) the thinking trace can run
# long, so we give it generous headroom to avoid the completion being cut off
# mid-reasoning — which surfaces from Groq as a 400 tool_use_failed with an
# empty failed_generation when structured output is requested.
DEFAULT_MAX_TOKENS = 4096


def get_vision_llm(
    temperature: float = 0.0,
    reasoning_effort: Optional[str] = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> ChatGroq:
    """
    Returns a ChatGroq instance configured for deterministic, low-temperature
    extraction. temperature=0 minimizes hallucinated field values, which
    matters a lot for identity documents.

    reasoning_effort: "none" or "default" (qwen3.6-27b only). Pass "none" to
    skip the model's extended thinking pass — useful as a fallback when the
    default (deeper reasoning) call fails to complete its tool call in time.
    """
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Copy .env.example to .env and add your key."
        )
    model_kwargs = {}
    if reasoning_effort is not None:
        model_kwargs["reasoning_effort"] = reasoning_effort
    return ChatGroq(
        model=GROQ_VISION_MODEL,
        temperature=temperature,
        api_key=api_key,
        max_tokens=max_tokens,
        model_kwargs=model_kwargs,
    )
