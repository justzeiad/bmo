import re

_STAGE_RE = re.compile(r"\*[^*]+\*")

class VoiceFormatter:
    def format_text(self, text: str) -> str:
        if not text:
            return ""

        # Remove stage directions like *shakes head sadly*
        cleaned = _STAGE_RE.sub("", text)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        if not cleaned:
            return ""

        # Keep punctuation mostly natural to avoid unstable prosody.
        cleaned = re.sub(r",\s+", ", ", cleaned)

        # Only add pauses for very long text blocks.
        if len(cleaned) > 220:
            parts = [p.strip() for p in cleaned.split(".") if p.strip()]
            if len(parts) > 1:
                cleaned = ". ... ".join(parts) + "."

        # Normalize spacing around ellipses
        cleaned = re.sub(r"\s*\.\.\.\s*", " ... ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        return cleaned
