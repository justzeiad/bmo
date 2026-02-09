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

        # Add gentle pacing: breathe after long commas and sentence breaks
        cleaned = re.sub(r",\s+", ", ... ", cleaned)
        cleaned = re.sub(r"\s*([!?])\s*", r"\1 ... ", cleaned)

        # Break up long sentences with pauses
        if len(cleaned) > 140:
            parts = [p.strip() for p in cleaned.split(".") if p.strip()]
            if len(parts) > 1:
                cleaned = ". ... ".join(parts) + "."

        # Normalize spacing around ellipses
        cleaned = re.sub(r"\s*\.\.\.\s*", " ... ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        return cleaned
