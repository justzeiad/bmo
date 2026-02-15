from typing import Iterator, Tuple
import re

_EMOTION_LINE_RE = re.compile(r"^\s*EMOTION:\s*.*$", re.I)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

_FALLBACKS = [
    "I can help with that. Tell me one more detail so I can answer clearly.",
    "I want to answer this well. Give me a bit more context and I'll do it.",
    "I'm on it. What exact part should I focus on first?",
]


class Orchestrator:
    def __init__(self, dialog_manager, llm_client, tts_streamer, expression_engine, voice_formatter):
        self.dialog_manager = dialog_manager
        self.llm_client = llm_client
        self.tts_streamer = tts_streamer
        self.expression_engine = expression_engine
        self.voice_formatter = voice_formatter

    def handle_user_text(self, session, text: str, images=None) -> Tuple[str, dict, object]:
        messages = self.dialog_manager.build_input(session, text)
        safety_override = self.dialog_manager.apply_safety(text)
        if safety_override:
            emotion = self.expression_engine.safety_refusal()
            tts_stream = self.tts_streamer.stream(safety_override)
            return safety_override, emotion, tts_stream

        llm_result = self.llm_client.generate(messages, images=images)
        assistant_text = llm_result.get("text", "")
        emotion = llm_result.get("emotion", {"emotion": "thinking", "intensity": 0.5})

        # Guard against EMOTION-only outputs
        if _EMOTION_LINE_RE.match(assistant_text.strip()):
            assistant_text = ""

        if not assistant_text.strip():
            assistant_text = self._fallback_reply(text, session.fallback_count)
            session.fallback_count += 1
            if emotion.get("emotion") in {"thinking", "neutral"}:
                emotion = {"emotion": "curious", "intensity": 0.5}

        # Update session history
        session.add_turn("user", text)
        session.add_turn("assistant", assistant_text)

        spoken_text = self.voice_formatter.format_text(assistant_text)
        tts_stream = self._stream_tts_by_sentence(spoken_text)
        expression = self.expression_engine.from_emotion(
            emotion.get("emotion", "thinking"),
            emotion.get("intensity", 0.5),
            speaking=True,
        )
        return assistant_text, expression, tts_stream

    def _fallback_reply(self, user_text: str, idx: int) -> str:
        base = _FALLBACKS[idx % len(_FALLBACKS)]
        snippet = " ".join((user_text or "").strip().split())
        if not snippet:
            return base
        if len(snippet) > 90:
            snippet = snippet[:90].rstrip() + "..."
        return f"{base} I heard: \"{snippet}\"."

    def _stream_tts_by_sentence(self, spoken_text: str) -> Iterator[bytes]:
        if not spoken_text:
            return iter(())

        parts = [p.strip() for p in _SENTENCE_SPLIT_RE.split(spoken_text) if p.strip()]
        if not parts:
            parts = [spoken_text]

        def _generator() -> Iterator[bytes]:
            for sentence in parts:
                for chunk in self.tts_streamer.stream(sentence):
                    yield chunk

        return _generator()
