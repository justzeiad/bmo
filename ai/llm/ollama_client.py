from typing import Dict, List, Optional
import base64
import httpx
from .emotion_parser import extract_emotion_block

class LLMClient:
    def __init__(self, model: str = "gemma3", host: str = "http://localhost:11434", options: Optional[Dict] = None):
        self.model = model
        self.host = host.rstrip("/")
        self.options = options or {}

    def generate(self, messages: List[Dict], images: Optional[List[bytes]] = None) -> Dict:
        payload = {
            "model": self.model,
            "messages": self._attach_images(messages, images),
            "stream": False,
            "options": self.options,
        }

        with httpx.Client(timeout=60.0) as client:
            # Try Ollama native chat
            resp = client.post(f"{self.host}/api/chat", json=payload)
            if resp.status_code == 404:
                # Fallback to /api/generate for older Ollama builds
                if images:
                    raise RuntimeError("Ollama /api/generate does not support images in this client.")
                prompt = self._messages_to_prompt(messages)
                resp = client.post(
                    f"{self.host}/api/generate",
                    json={"model": self.model, "prompt": prompt, "stream": False},
                )
            if resp.status_code == 404:
                # Fallback to OpenAI-compatible endpoints
                resp = client.post(
                    f"{self.host}/v1/chat/completions",
                    json={"model": self.model, "messages": payload["messages"], "stream": False},
                )
                if resp.status_code == 404:
                    if images:
                        raise RuntimeError("OpenAI-compatible /v1/completions does not support images in this client.")
                    prompt = self._messages_to_prompt(messages)
                    resp = client.post(
                        f"{self.host}/v1/completions",
                        json={"model": self.model, "prompt": prompt, "stream": False},
                    )
            resp.raise_for_status()
            data = resp.json()

        if "message" in data:
            text = data.get("message", {}).get("content", "")
        elif "response" in data:
            text = data.get("response", "")
        else:
            # OpenAI-compatible responses
            choices = data.get("choices", [])
            if choices and "message" in choices[0]:
                text = choices[0]["message"].get("content", "")
            elif choices and "text" in choices[0]:
                text = choices[0].get("text", "")
            else:
                text = ""
        emotion, cleaned = extract_emotion_block(text)
        if emotion is None:
            emotion = self._fallback_emotion(cleaned)
        return {"text": cleaned, "emotion": emotion}

    def _attach_images(self, messages: List[Dict], images: Optional[List[bytes]]) -> List[Dict]:
        if not images:
            return messages
        if not messages:
            return [{"role": "user", "content": "", "images": [self._b64(i) for i in images]}]
        updated = [dict(m) for m in messages]
        last = updated[-1]
        if last.get("role") != "user":
            updated.append({"role": "user", "content": "", "images": [self._b64(i) for i in images]})
            return updated
        last = dict(last)
        last["images"] = [self._b64(i) for i in images]
        updated[-1] = last
        return updated

    def _b64(self, data: bytes) -> str:
        return base64.b64encode(data).decode("ascii")

    def _messages_to_prompt(self, messages: List[Dict]) -> str:
        parts = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            parts.append(f"{role.upper()}: {content}")
        parts.append("ASSISTANT:")
        return "\n".join(parts)

    def _fallback_emotion(self, text: str) -> Dict:
        t = text.lower()
        if any(k in t for k in ["awesome", "amazing", "so happy", "thrilled", "excited"]):
            return {"emotion": "excited", "intensity": 0.6}
        if any(k in t for k in ["great", "love", "nice", "glad", "good to hear"]):
            return {"emotion": "happy", "intensity": 0.5}
        if any(k in t for k in ["sorry", "sad", "unfortunate", "regret"]):
            return {"emotion": "sad", "intensity": 0.6}
        if any(k in t for k in ["hmm", "let me think", "thinking"]):
            return {"emotion": "thinking", "intensity": 0.5}
        if any(k in t for k in ["confused", "not sure", "unclear"]):
            return {"emotion": "confused", "intensity": 0.6}
        if any(k in t for k in ["careful", "warning", "can't", "cannot"]):
            return {"emotion": "concerned", "intensity": 0.6}
        return {"emotion": "neutral", "intensity": 0.3}
