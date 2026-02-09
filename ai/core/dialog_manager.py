from typing import Dict, List, Optional

class DialogManager:
    def __init__(self, memory_store=None, safety_filter=None, system_prompt: Optional[str] = None, emotion_instruction: Optional[str] = None):
        self.memory_store = memory_store
        self.safety_filter = safety_filter
        self.system_prompt = system_prompt
        self.emotion_instruction = emotion_instruction

    def build_input(self, session, user_text: str) -> List[Dict]:
        messages = []
        system_parts = [p for p in [self.system_prompt, self.emotion_instruction] if p]
        if system_parts:
            messages.append({"role": "system", "content": "\n\n".join(system_parts)})
        # Include recent turns
        messages.extend(session.recent_turns())
        # Append current user input
        messages.append({"role": "user", "content": user_text})
        # Inject relevant memories if enabled
        if self.memory_store:
            memories = self.memory_store.query(user_text, top_k=3)
            if memories:
                memory_block = "Relevant memories:\n" + "\n".join(
                    f"- {m['text']}" for m in memories
                )
                insert_at = 1 if (messages and messages[0].get("role") == "system") else 0
                messages.insert(insert_at, {"role": "system", "content": memory_block})
        return messages

    def apply_safety(self, text: str) -> Optional[str]:
        if not self.safety_filter:
            return None
        return self.safety_filter.check(text)
