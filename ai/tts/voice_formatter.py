class VoiceFormatter:
    def format_text(self, text: str) -> str:
        if not text:
            return ""
        # Basic pacing: add pauses between sentences when long
        if len(text) > 120:
            parts = [p.strip() for p in text.split(".") if p.strip()]
            if len(parts) > 1:
                return ". ... ".join(parts) + "."
        return text
