from typing import Iterator, Optional
import numpy as np

try:
    from piper.voice import PiperVoice, SynthesisConfig
except Exception as exc:  # pragma: no cover
    PiperVoice = None
    SynthesisConfig = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None


class PiperEngine:
    _voice_cache = {}

    def __init__(
        self,
        model_path: str,
        speaker: Optional[int] = None,
        sample_rate: int = 16000,
        executable: str = "piper",
        use_cuda: bool = False,
        length_scale: Optional[float] = None,
        noise_scale: Optional[float] = None,
        noise_w_scale: Optional[float] = None,
        volume: Optional[float] = None,
    ):
        if _IMPORT_ERROR is not None:
            raise RuntimeError(f"piper-tts not installed or failed to import: {_IMPORT_ERROR}")
        if not model_path:
            raise RuntimeError("Piper model path is required")

        self.model_path = model_path
        self.speaker = speaker
        self.sample_rate = sample_rate
        self.use_cuda = use_cuda
        self.length_scale = length_scale
        self.noise_scale = noise_scale
        self.noise_w_scale = noise_w_scale
        self.volume = volume

        cache_key = (model_path, use_cuda)
        if cache_key not in self._voice_cache:
            self._voice_cache[cache_key] = PiperVoice.load(model_path, use_cuda=use_cuda)
        self.voice = self._voice_cache[cache_key]

    def stream(self, text: str) -> Iterator[bytes]:
        if not text:
            return
        syn_config = None
        if SynthesisConfig is not None:
            syn_config = SynthesisConfig(
                speaker_id=self.speaker,
                length_scale=self.length_scale,
                noise_scale=self.noise_scale,
                noise_w_scale=self.noise_w_scale,
                volume=self.volume if self.volume is not None else 1.0,
            )
        for chunk in self.voice.synthesize(text, syn_config=syn_config):
            # Convert float32 [-1,1] to int16 PCM
            audio = np.clip(chunk.audio_float_array * 32767.0, -32768, 32767).astype(np.int16)
            yield audio.tobytes()
