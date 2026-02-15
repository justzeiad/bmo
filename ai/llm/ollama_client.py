from typing import Dict, List, Optional
import base64
import httpx
import time
import re

from .emotion_parser import extract_emotion_block

_SPECIAL_TOKEN_RE = re.compile(r"<\|[^|>]+?\|>")
_ROLE_PREFIX_RE = re.compile(r"^\s*(assistant|bmo)\s*[:\-]\s*", re.I)
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")


class LLMClient:
    def __init__(
        self,
        model: str = "gemma3",
        host: str = "http://localhost:11434",
        options: Optional[Dict] = None,
        keep_alive: Optional[str] = None,
    ):
        self.model = model
        self.host = host.rstrip("/")
        self.options = options or {}
        self.keep_alive = keep_alive
        self._client = httpx.Client(timeout=45.0)

    def generate(self, messages: List[Dict], images: Optional[List[bytes]] = None) -> Dict:
        started = time.perf_counter()
        attempts = 3
        current_messages = list(messages)
        cleaned = ""
        emotion = None
        last_raw = ""
        repair_instructions = [
            "Respond with one short helpful sentence before the EMOTION line.",
            "Do not output only EMOTION. Return 1-2 useful sentences, then exactly one EMOTION JSON line.",
            "Give a concrete answer to the user question, then add EMOTION JSON.",
        ]

        for attempt in range(attempts):
            text = self._sanitize_text(self._request_once(current_messages, images=images))
            last_raw = text
            emotion, cleaned = extract_emotion_block(text)
            cleaned = self._sanitize_text(cleaned)
            if cleaned.strip():
                break
            if attempt < attempts - 1:
                # Repair prompt for models that output only EMOTION or empty text.
                current_messages = current_messages + [
                    {"role": "system", "content": repair_instructions[min(attempt, len(repair_instructions) - 1)]}
                ]

        if emotion is None:
            emotion = self._fallback_emotion(cleaned or last_raw)

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return {"text": cleaned, "emotion": emotion, "latency_ms": elapsed_ms}

    def _request_once(self, messages: List[Dict], images: Optional[List[bytes]] = None) -> str:
        payload = {
            "model": self.model,
            "messages": self._attach_images(messages, images),
            "stream": False,
            "options": self.options,
        }
        if self.keep_alive:
            payload["keep_alive"] = self.keep_alive

        resp = self._post(f"{self.host}/api/chat", payload)
        if resp.status_code == 404:
            if images:
                raise RuntimeError("Ollama /api/generate does not support images in this client.")
            prompt = self._messages_to_prompt(messages)
            resp = self._post(
                f"{self.host}/api/generate",
                {"model": self.model, "prompt": prompt, "stream": False},
            )
        if resp.status_code == 404:
            resp = self._post(
                f"{self.host}/v1/chat/completions",
                {"model": self.model, "messages": payload["messages"], "stream": False},
            )
            if resp.status_code == 404:
                if images:
                    raise RuntimeError("OpenAI-compatible /v1/completions does not support images in this client.")
                prompt = self._messages_to_prompt(messages)
                resp = self._post(
                    f"{self.host}/v1/completions",
                    {"model": self.model, "prompt": prompt, "stream": False},
                )
        resp.raise_for_status()
        data = resp.json()

        if "message" in data:
            return data.get("message", {}).get("content", "")
        if "response" in data:
            return data.get("response", "")

        choices = data.get("choices", [])
        if choices and "message" in choices[0]:
            return choices[0]["message"].get("content", "")
        if choices and "text" in choices[0]:
            return choices[0].get("text", "")
        return ""

    def _sanitize_text(self, text: str) -> str:
        if not text:
            return ""
        cleaned = text.replace("\r\n", "\n")
        cleaned = _SPECIAL_TOKEN_RE.sub("", cleaned).strip()
        cleaned = _ROLE_PREFIX_RE.sub("", cleaned)

        lines = [ln.strip() for ln in cleaned.split("\n")]
        if lines and lines[0].lower() in {"assistant", "bmo"}:
            lines = lines[1:]
        cleaned = "\n".join(lines).strip()
        cleaned = _MULTI_NEWLINE_RE.sub("\n\n", cleaned)
        return cleaned

    def _post(self, url: str, payload: Dict) -> httpx.Response:
        try:
            return self._client.post(url, json=payload)
        except httpx.TransportError:
            # Retry once with a fresh connection if keep-alive socket was dropped.
            self._client.close()
            self._client = httpx.Client(timeout=45.0)
            return self._client.post(url, json=payload)

    def warmup(self, prompt: str = "ping") -> None:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": {**self.options, "num_predict": 1, "temperature": 0},
        }
        if self.keep_alive:
            payload["keep_alive"] = self.keep_alive
        resp = self._post(f"{self.host}/api/chat", payload)
        if resp.status_code == 404:
            fallback = {
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "options": {"num_predict": 1, "temperature": 0},
            }
            if self.keep_alive:
                fallback["keep_alive"] = self.keep_alive
            resp = self._post(f"{self.host}/api/generate", fallback)
        resp.raise_for_status()

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
