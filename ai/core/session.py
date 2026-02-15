from dataclasses import dataclass, field
from typing import List, Dict

@dataclass
class Session:
    session_id: str
    user_id: str
    turns: List[Dict] = field(default_factory=list)
    max_turns: int = 8
    fallback_count: int = 0
    lineup_counters: Dict[str, int] = field(default_factory=dict)

    def add_turn(self, role: str, content: str) -> None:
        self.turns.append({"role": role, "content": content})
        if len(self.turns) > self.max_turns:
            self.turns = self.turns[-self.max_turns :]

    def recent_turns(self) -> List[Dict]:
        return list(self.turns)

    def next_lineup_index(self, key: str, size: int) -> int:
        if size <= 0:
            return 0
        idx = self.lineup_counters.get(key, 0) % size
        self.lineup_counters[key] = idx + 1
        return idx
