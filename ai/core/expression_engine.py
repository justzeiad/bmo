from typing import Dict

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

class ExpressionEngine:
    def from_emotion(self, emotion: str, intensity: float, speaking: bool = False) -> Dict:
        emotion = emotion if emotion in ALLOWED_EMOTIONS else "thinking"
        intensity = max(0.0, min(1.0, float(intensity)))
        return {
            "emotion": emotion,
            "intensity": intensity,
            "speaking": bool(speaking),
            "mouth_amplitude": 0.0,
            "eye_state": "open",
            "blink": False,
        }

    def listening(self) -> Dict:
        return self.from_emotion("curious", 0.3, speaking=False)

    def stt_failure(self) -> Dict:
        return self.from_emotion("confused", 0.6, speaking=False)

    def safety_refusal(self) -> Dict:
        return self.from_emotion("concerned", 0.6, speaking=False)
