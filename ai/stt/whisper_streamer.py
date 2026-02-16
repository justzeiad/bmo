from typing import Optional

import numpy as np
import whisper


class STTStreamer:
    _model_cache = {}

    def __init__(
        self,
        model_size: str = "base",
        device: str = "cpu",
        compute_type: str = "int8",
        sample_rate: int = 16000,
        partial_seconds: float = 1.0,
        max_partial_seconds: float = 30.0,
        language: Optional[str] = "en",
    ):
        self.sample_rate = sample_rate
        self.partial_bytes = int(sample_rate * partial_seconds * 2)
        self.max_partial_bytes = int(sample_rate * max_partial_seconds * 2)
        self.language = language
        self._buffer = bytearray()
        self._last_partial_len = 0
        self._use_fp16 = str(device or "").lower().startswith("cuda")

        # Keep compute_type for backwards compatibility in config files.
        cache_key = (model_size, device)
        if cache_key not in self._model_cache:
            self._model_cache[cache_key] = whisper.load_model(model_size, device=device)
        self.model = self._model_cache[cache_key]

    def feed_chunk(self, bytes_chunk: bytes) -> Optional[str]:
        if bytes_chunk:
            self._buffer.extend(bytes_chunk)
        if len(self._buffer) - self._last_partial_len < self.partial_bytes:
            return None
        self._last_partial_len = len(self._buffer)
        audio = self._to_audio_array(self._buffer, self.max_partial_bytes)
        return self._transcribe(audio, is_final=False)

    def finalize(self) -> str:
        if not self._buffer:
            return ""
        audio = self._to_audio_array(self._buffer, None)
        text = self._transcribe(audio, is_final=True)
        self._buffer.clear()
        self._last_partial_len = 0
        return text or ""

    def _to_audio_array(self, buffer: bytearray, max_bytes: Optional[int]) -> np.ndarray:
        if max_bytes and len(buffer) > max_bytes:
            buffer = buffer[-max_bytes:]
        audio = np.frombuffer(buffer, dtype=np.int16).astype(np.float32) / 32768.0
        return audio

    def _transcribe(self, audio: np.ndarray, is_final: bool) -> Optional[str]:
        if audio.size == 0:
            return None
        result = self.model.transcribe(
            audio,
            language=self.language,
            temperature=0.0,
            verbose=False,
            fp16=self._use_fp16,
            condition_on_previous_text=not is_final,
        )
        text = str(result.get("text") or "").strip()
        return text if text else None
