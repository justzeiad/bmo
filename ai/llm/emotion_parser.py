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

EMOTION_RE = re.compile(r"EMOTION:\s*(\{.*?\})", flags=re.S)


def extract_emotion_block(text: str) -> Tuple[Optional[Dict], str]:
    match = EMOTION_RE.search(text)
    if not match:
        return None, text.strip()

    json_text = match.group(1)
    cleaned = EMOTION_RE.sub("", text).strip()
    try:
        data = json.loads(json_text)
    except Exception:
        return None, cleaned

    emotion = data.get("emotion", "thinking")
    intensity = data.get("intensity", 0.5)
    if emotion not in ALLOWED_EMOTIONS:
        emotion = "thinking"
    try:
        intensity = float(intensity)
    except Exception:
        intensity = 0.5
    intensity = max(0.0, min(1.0, intensity))

    return {"emotion": emotion, "intensity": intensity}, cleaned
