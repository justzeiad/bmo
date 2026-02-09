class MemoryPolicy:
    def should_store(self, text: str) -> bool:
        # Placeholder policy
        return "remember" in text.lower()
