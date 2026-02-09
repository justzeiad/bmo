import argparse
import asyncio
import base64
import json
import wave

import websockets


def _wav_frames(path: str, chunk_ms: int = 100):
    with wave.open(path, "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
            raise ValueError("WAV must be mono 16-bit 16kHz")
        frames_per_chunk = int(16000 * (chunk_ms / 1000.0))
        while True:
            data = wf.readframes(frames_per_chunk)
            if not data:
                break
            yield data


async def run_client(url: str, text: str, wav_path: str, chunk_ms: int):
    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"type": "open_session", "sessionId": "local", "userId": "local"}))

        if text:
            await ws.send(json.dumps({"type": "text_input", "text": text}))
        elif wav_path:
            await ws.send(json.dumps({"type": "start_speech"}))
            for chunk in _wav_frames(wav_path, chunk_ms=chunk_ms):
                await ws.send(chunk)
            await ws.send(json.dumps({"type": "end_speech"}))

        async for msg in ws:
            if isinstance(msg, bytes):
                print(f"binary {len(msg)} bytes")
                continue
            payload = json.loads(msg)
            mtype = payload.get("type")
            if mtype == "tts_chunk":
                data = base64.b64decode(payload.get("data", ""))
                print(f"tts_chunk seq={payload.get('seq')} bytes={len(data)}")
                continue
            print(json.dumps(payload, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://localhost:8000/ws")
    parser.add_argument("--text", default="")
    parser.add_argument("--wav", default="")
    parser.add_argument("--chunk-ms", type=int, default=100)
    args = parser.parse_args()

    if not args.text and not args.wav:
        raise SystemExit("Provide --text or --wav")

    asyncio.run(run_client(args.url, args.text, args.wav, args.chunk_ms))


if __name__ == "__main__":
    main()
