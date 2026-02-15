import json
import re
from typing import Dict, Optional, Tuple

ALLOWED_EMOTIONS = {
    "neutral",
    "happy",
    "excited",
    "curious",
    "thinking",
    "confused",
    "sad",
    "concerned",
    "sleepy",
}

EMOTION_JSON_RE = re.compile(r"EMOTION:\s*(\{.*?\})", flags=re.S | re.I)
EMOTION_WORD_RE = re.compile(r'EMOTION:\s*"?([a-zA-Z_]+)"?', flags=re.I)
EMOTION_TOKEN_RE = re.compile(r'EMOTION:\s*(\{.*?\}|"?[a-zA-Z_]+"?)', flags=re.S | re.I)
EMOTION_LINE_RE = re.compile(r"^\s*EMOTION:\s*.*$", flags=re.M | re.I)
EMOTION_DEFAULT_INTENSITY = {
    "neutral": 0.3,
    "happy": 0.6,
    "excited": 0.75,
    "curious": 0.5,
    "thinking": 0.5,
    "confused": 0.6,
    "sad": 0.6,
    "concerned": 0.6,
    "sleepy": 0.45,
}
EMOTION_ALIASES = {
    "joy": "happy",
    "joyful": "happy",
    "good": "happy",
    "exploring": "curious",
    "curiosity": "curious",
    "worry": "concerned",
    "worried": "concerned",
}


def _normalize_emotion(raw: str) -> str:
    emotion = (raw or "").strip().strip('"').lower()
    if emotion in ALLOWED_EMOTIONS:
        return emotion
    return EMOTION_ALIASES.get(emotion, "thinking")


def _clean_text(text: str) -> str:
    cleaned = EMOTION_LINE_RE.sub("", text)
    cleaned = EMOTION_TOKEN_RE.sub("", cleaned)
    # Drop orphan narration labels left by malformed outputs, e.g. "BMO grins:"
    cleaned = re.sub(r"^\s*(?:bmo|assistant)\b[^:\n]{0,120}:\s*$", "", cleaned, flags=re.I | re.M)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned.strip()


def extract_emotion_block(text: str) -> Tuple[Optional[Dict], str]:
    text = text or ""
    cleaned = _clean_text(text)

    match = EMOTION_JSON_RE.search(text)
    if match:
        json_text = match.group(1)
        try:
            data = json.loads(json_text)
            emotion = _normalize_emotion(str(data.get("emotion", "thinking")))
            intensity = data.get("intensity", EMOTION_DEFAULT_INTENSITY.get(emotion, 0.5))
            try:
                intensity = float(intensity)
            except Exception:
                intensity = EMOTION_DEFAULT_INTENSITY.get(emotion, 0.5)
            intensity = max(0.0, min(1.0, intensity))
            return {"emotion": emotion, "intensity": intensity}, cleaned
        except Exception:
            # Fall through to word-based extraction.
            pass

    word_match = EMOTION_WORD_RE.search(text)
    if word_match:
        emotion = _normalize_emotion(word_match.group(1))
        intensity = EMOTION_DEFAULT_INTENSITY.get(emotion, 0.5)
        return {"emotion": emotion, "intensity": intensity}, cleaned

    return None, cleaned
