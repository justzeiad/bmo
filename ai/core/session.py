from dataclasses import dataclass, field
from typing import List, Dict

@dataclass
class Session:
    session_id: str
    user_id: str
    turns: List[Dict] = field(default_factory=list)
    max_turns: int = 8

    def add_turn(self, role: str, content: str) -> None:
        self.turns.append({"role": role, "content": content})
        if len(self.turns) > self.max_turns:
            self.turns = self.turns[-self.max_turns :]

    def recent_turns(self) -> List[Dict]:
        return list(self.turns)
