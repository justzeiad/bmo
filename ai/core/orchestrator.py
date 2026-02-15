from typing import Dict, Iterator, List, Optional, Tuple
import re

_EMOTION_LINE_RE = re.compile(r"^\s*EMOTION:\s*.*$", re.I)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_GREET_RE = re.compile(r"\b(hi|hello|hey|yo|good morning|good afternoon|good evening|sup)\b", re.I)
_JOKE_RE = re.compile(r"\b(joke|funny|make me laugh|laugh)\b", re.I)
_THANKS_RE = re.compile(r"\b(thanks|thank you|thx|appreciate it)\b", re.I)
_DIRECT_GREET_RE = re.compile(r"^\s*(hi|hello|hey|yo|sup|good morning|good afternoon|good evening)[!. ]*$", re.I)
_DIRECT_JOKE_RE = re.compile(
    r"^\s*((tell me|give me)\s+)?(a\s+)?(quick\s+)?(joke|something funny|a funny one|make me laugh)[!. ]*$",
    re.I,
)
_DIRECT_THANKS_RE = re.compile(r"^\s*(thanks|thank you|thx|appreciate it|ty)[!. ]*$", re.I)
_COMPLEX_QUERY_RE = re.compile(r"\b(about|with|for|because|if|when|while|and|or|friends?)\b", re.I)
_REQUESTY_RE = re.compile(r"\b(what|why|how|when|where|who|can|could|would|please|help|tell|explain|build|fix)\b", re.I)

_DEFAULT_LINEUPS: Dict[str, List[str]] = {
    "fallback": [
        "I can help with that. Tell me one more detail so I can answer clearly.",
        "I want to answer this well. Give me a tiny bit more context and I got you.",
        "Okay! I'm locked in. What exact part should I focus on first?",
    ],
    "greetings": [
        "BMO is online and ready for adventure mode.",
        "BMO is here and ready to help.",
        "BMO is listening. What do you want to do?",
    ],
    "jokes": [
        "Why did the pixel go to school? It wanted to be a little sharper.",
        "I tried to race a loading bar... it said, hold on, almost there.",
        "What do robots eat for snacks? Microchips with extra crunch.",
    ],
    "thanks": [
        "Thanks. That made my circuits happy.",
        "You are welcome. Teamwork high five.",
        "Anytime. BMO likes helping people.",
    ],
}


class Orchestrator:
    def __init__(
        self,
        dialog_manager,
        llm_client,
        tts_streamer,
        expression_engine,
        voice_formatter,
        split_tts_sentences: bool = False,
        lineups: Optional[Dict] = None,
    ):
        self.dialog_manager = dialog_manager
        self.llm_client = llm_client
        self.tts_streamer = tts_streamer
        self.expression_engine = expression_engine
        self.voice_formatter = voice_formatter
        self.split_tts_sentences = split_tts_sentences
        self.lineups = self._build_lineups(lineups)

    def handle_user_text(self, session, text: str, images=None) -> Tuple[str, dict, object]:
        safety_override = self.dialog_manager.apply_safety(text)
        if safety_override:
            emotion = self.expression_engine.safety_refusal()
            tts_stream = self.tts_streamer.stream(safety_override)
            return safety_override, emotion, tts_stream

        quick = self._quick_lineup_reply(session, text)
        if quick:
            assistant_text, emotion = quick
            session.add_turn("user", text)
            session.add_turn("assistant", assistant_text)
            spoken_text = self.voice_formatter.format_text(assistant_text)
            tts_stream = self._stream_tts_by_sentence(spoken_text)
            expression = self.expression_engine.from_emotion(
                emotion.get("emotion", "happy"),
                emotion.get("intensity", 0.6),
                speaking=True,
            )
            return assistant_text, expression, tts_stream

        messages = self.dialog_manager.build_input(session, text)
        llm_result = self.llm_client.generate(messages, images=images)
        assistant_text = llm_result.get("text", "")
        emotion = llm_result.get("emotion", {"emotion": "thinking", "intensity": 0.5})

        # Guard against EMOTION-only outputs
        if _EMOTION_LINE_RE.match(assistant_text.strip()):
            assistant_text = ""

        if not assistant_text.strip():
            assistant_text = self._fallback_reply(text, session)
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

    def _build_lineups(self, lineups_cfg: Optional[Dict]) -> Dict[str, List[str]]:
        cfg = lineups_cfg or {}
        # Support both top-level keys and {lineups:{...}}.
        if isinstance(cfg.get("lineups"), dict):
            cfg = cfg["lineups"]
        built: Dict[str, List[str]] = {}
        for key, defaults in _DEFAULT_LINEUPS.items():
            source = cfg.get(key, defaults) if isinstance(cfg, dict) else defaults
            if not isinstance(source, list):
                source = defaults
            cleaned = [str(x).strip() for x in source if str(x).strip()]
            built[key] = cleaned or list(defaults)
        return built

    def _pick_line(self, session, key: str) -> str:
        pool = self.lineups.get(key, _DEFAULT_LINEUPS.get(key, []))
        if not pool:
            return ""
        idx = session.next_lineup_index(key, len(pool))
        return pool[idx]

    def _quick_lineup_reply(self, session, text: str) -> Optional[Tuple[str, Dict[str, float]]]:
        normalized = (text or "").strip()
        if not normalized:
            return None

        # Greeting-like small talk ("hello my friends") should not fall back to a dull clarify prompt.
        if len(normalized) <= 80 and _GREET_RE.search(normalized) and not _REQUESTY_RE.search(normalized):
            return self._pick_line(session, "greetings"), {"emotion": "happy", "intensity": 0.68}

        if len(session.turns) <= 1 and len(normalized) <= 40 and _DIRECT_GREET_RE.match(normalized):
            return self._pick_line(session, "greetings"), {"emotion": "happy", "intensity": 0.72}
        if _DIRECT_JOKE_RE.match(normalized) and not _COMPLEX_QUERY_RE.search(normalized):
            return self._pick_line(session, "jokes"), {"emotion": "excited", "intensity": 0.78}
        if _DIRECT_THANKS_RE.match(normalized):
            return self._pick_line(session, "thanks"), {"emotion": "happy", "intensity": 0.62}

        # Explicitly avoid lineups for richer requests like "tell me a joke about ..."
        if _JOKE_RE.search(normalized) or _GREET_RE.search(normalized) or _THANKS_RE.search(normalized):
            return None
        return None

    def _fallback_reply(self, user_text: str, session) -> str:
        return self._pick_line(session, "fallback")

    def _stream_tts_by_sentence(self, spoken_text: str) -> Iterator[bytes]:
        if not spoken_text:
            return iter(())

        if not self.split_tts_sentences:
            return self.tts_streamer.stream(spoken_text)

        parts = [p.strip() for p in _SENTENCE_SPLIT_RE.split(spoken_text) if p.strip()]
        if not parts:
            parts = [spoken_text]

        def _generator() -> Iterator[bytes]:
            for sentence in parts:
                for chunk in self.tts_streamer.stream(sentence):
                    yield chunk

        return _generator()
