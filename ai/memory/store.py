from typing import List, Dict

class MemoryStore:
    def __init__(self):
        self._items = []

    def insert(self, item: Dict) -> None:
        self._items.append(item)

    def query(self, text: str, top_k: int = 3) -> List[Dict]:
        # Placeholder: return most recent items
        if top_k <= 0:
            return []
        return list(self._items)[-top_k:]
