import io
import math
import wave


def pcm16le_rms(pcm_bytes: bytes) -> float:
    if not pcm_bytes:
        return 0.0
    count = len(pcm_bytes) // 2
    if count == 0:
        return 0.0
    total = 0
    for i in range(0, count * 2, 2):
        sample = int.from_bytes(pcm_bytes[i:i+2], "little", signed=True)
        total += sample * sample
    mean = total / count
    rms = math.sqrt(mean) / 32768.0
    return max(0.0, min(1.0, rms))


def pcm16le_to_wav_bytes(pcm_bytes: bytes, sample_rate: int = 16000, channels: int = 1) -> bytes:
    if not pcm_bytes:
        return b""
    with io.BytesIO() as buffer:
        with wave.open(buffer, "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm_bytes)
        return buffer.getvalue()
