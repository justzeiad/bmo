import math


def rms_amplitude(pcm_bytes: bytes) -> float:
    if not pcm_bytes:
        return 0.0
    # 16-bit PCM little-endian
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
