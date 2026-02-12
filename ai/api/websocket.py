import base64
import json
import os
import time
from typing import Optional

import yaml
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import anyio

from ai.core.dialog_manager import DialogManager
from ai.core.expression_engine import ExpressionEngine
from ai.core.orchestrator import Orchestrator
from ai.core.session import Session
from ai.llm.ollama_client import LLMClient
from ai.llm.safety import SafetyFilter
from ai.memory.store import MemoryStore
from ai.stt.whisper_streamer import STTStreamer
from ai.tts.audio_post import rms_amplitude
from ai.utils.audio import pcm16le_to_wav_bytes
from ai.tts.voice_formatter import VoiceFormatter
from ai.tts.xtts_engine import XTTSEngine
from ai.tts.piper_engine import PiperEngine
from ai.utils.logging import get_logger

logger = get_logger("ai.websocket")

app = FastAPI()


def _config_path(name: str) -> str:
    here = os.path.dirname(__file__)
    return os.path.abspath(os.path.join(here, "..", "config", name))


def _load_yaml(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


SETTINGS_PATH = os.getenv("BMO_SETTINGS", _config_path("settings.yaml"))
PROMPTS_PATH = os.getenv("BMO_PROMPTS", _config_path("prompts.yaml"))
SETTINGS = _load_yaml(SETTINGS_PATH)
PROMPTS = _load_yaml(PROMPTS_PATH)
TTS_CONFIG = SETTINGS.get("models", {}).get("tts", {})
LLM_CONFIG = SETTINGS.get("models", {}).get("llm", {})


def build_orchestrator() -> Orchestrator:
    memory_store = MemoryStore() if SETTINGS.get("features", {}).get("enable_memory", True) else None
    safety_filter = SafetyFilter() if SETTINGS.get("features", {}).get("enable_safety_filter", True) else None
    dialog_manager = DialogManager(
        memory_store=memory_store,
        safety_filter=safety_filter,
        system_prompt=PROMPTS.get("system_persona"),
        emotion_instruction=PROMPTS.get("emotion_instruction"),
    )
    llm_cfg = LLM_CONFIG
    llm_client = LLMClient(
        model=llm_cfg.get("model", "gemma3"),
        host=llm_cfg.get("host", "http://localhost:11434"),
        options=llm_cfg.get("options"),
    )
    tts_cfg = TTS_CONFIG
    tts_provider = tts_cfg.get("provider", "xtts")
    if tts_provider == "piper":
        tts_streamer = PiperEngine(
            model_path=tts_cfg.get("model", ""),
            speaker=tts_cfg.get("speaker"),
            sample_rate=tts_cfg.get("sample_rate", 16000),
            executable=tts_cfg.get("executable", "piper"),
            length_scale=tts_cfg.get("length_scale"),
            noise_scale=tts_cfg.get("noise_scale"),
            noise_w_scale=tts_cfg.get("noise_w_scale"),
            volume=tts_cfg.get("volume"),
        )
    else:
        tts_streamer = XTTSEngine()
    expression_engine = ExpressionEngine()
    voice_formatter = VoiceFormatter()
    return Orchestrator(dialog_manager, llm_client, tts_streamer, expression_engine, voice_formatter)


@app.on_event("startup")
async def _startup_warmup() -> None:
    if not LLM_CONFIG.get("warmup", False):
        return
    prompt = LLM_CONFIG.get("warmup_prompt", "ping")

    def _run() -> None:
        llm_client = LLMClient(
            model=LLM_CONFIG.get("model", "gemma3"),
            host=LLM_CONFIG.get("host", "http://localhost:11434"),
            options={**(LLM_CONFIG.get("options") or {}), "num_predict": 1},
        )
        try:
            llm_client.generate([{"role": "user", "content": prompt}])
            logger.info("LLM warmup complete")
        except Exception as exc:
            logger.warning("LLM warmup failed: %s", exc)

    await anyio.to_thread.run_sync(_run)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    orchestrator = build_orchestrator()
    stt_streamer: Optional[STTStreamer] = None
    session: Optional[Session] = None

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            if message.get("bytes") is not None:
                if not stt_streamer:
                    continue
                partial = stt_streamer.feed_chunk(message["bytes"])
                if partial:
                    await _send_json(websocket, {"type": "transcript_partial", "text": partial})
                continue

            if message.get("text") is None:
                continue

            try:
                payload = json.loads(message["text"])
            except Exception:
                await _send_json(websocket, {"type": "error", "code": "bad_json", "message": "Invalid JSON"})
                continue

            msg_type = payload.get("type")
            if msg_type == "open_session":
                session = Session(
                    session_id=payload.get("sessionId", "session"),
                    user_id=payload.get("userId", "user"),
                )
                await _send_json(websocket, {"type": "open_session", "ok": True})
                continue

            if msg_type == "start_speech":
                if session is None:
                    session = Session(session_id="session", user_id="user")
                stt_streamer = STTStreamer()
                await _send_json(websocket, {"type": "listening", "ok": True})
                continue

            if msg_type == "end_speech":
                if not stt_streamer:
                    continue
                final_text = stt_streamer.finalize()
                stt_streamer = None
                await _send_json(websocket, {"type": "transcript_final", "text": final_text})
                if session is None:
                    session = Session(session_id="session", user_id="user")
                if final_text.strip():
                    await _handle_user_text(websocket, orchestrator, session, final_text)
                else:
                    await _send_json(websocket, {"type": "error", "code": "empty_text", "message": "No speech detected"})
                continue

            if msg_type == "text_input":
                if session is None:
                    session = Session(session_id="session", user_id="user")
                text = payload.get("text", "")
                if not text.strip():
                    await _send_json(websocket, {"type": "error", "code": "empty_text", "message": "Empty text"})
                    continue
                await _handle_user_text(websocket, orchestrator, session, text)
                continue

            if msg_type == "image_upload_ready":
                await _send_json(websocket, {"type": "error", "code": "not_implemented", "message": "Image upload not implemented"})
                continue

            await _send_json(websocket, {"type": "error", "code": "unknown_type", "message": f"Unknown type: {msg_type}"})

    except WebSocketDisconnect:
        return
    except Exception as exc:
        logger.exception("WebSocket error: %s", exc)
        await _send_json(websocket, {"type": "error", "code": "server_error", "message": "Server error"})


async def _handle_user_text(websocket: WebSocket, orchestrator: Orchestrator, session: Session, text: str) -> None:
    turn_started = time.perf_counter()
    assistant_text, expression, tts_stream = orchestrator.handle_user_text(session, text)
    llm_done = time.perf_counter()

    await _send_json(websocket, {"type": "assistant_text", "text": assistant_text})
    await _send_json(websocket, {"type": "expression", **expression})

    seq = 0
    sent_audio = False
    tts_started = None
    for chunk in tts_stream:
        sent_audio = True
        if tts_started is None:
            tts_started = time.perf_counter()

        amp = rms_amplitude(chunk)
        await _send_json(websocket, {"type": "expression", **{**expression, "speaking": True, "mouth_amplitude": amp}})

        out_chunk = chunk
        if TTS_CONFIG.get("stream_wav_chunks", False):
            out_chunk = pcm16le_to_wav_bytes(
                chunk,
                sample_rate=int(TTS_CONFIG.get("sample_rate", 16000)),
                channels=1,
            )
        await _send_json(websocket, {"type": "tts_chunk", "seq": seq, "data": base64.b64encode(out_chunk).decode("ascii")})
        seq += 1

    if sent_audio:
        await _send_json(websocket, {"type": "expression", **{**expression, "speaking": False, "mouth_amplitude": 0.0}})
    else:
        await _send_json(websocket, {"type": "expression", **{**expression, "speaking": False}})

    done = time.perf_counter()
    llm_ms = int((llm_done - turn_started) * 1000)
    tts_start_ms = int((tts_started - turn_started) * 1000) if tts_started is not None else -1
    total_ms = int((done - turn_started) * 1000)
    logger.info("turn timings llm_ms=%d tts_start_ms=%d total_ms=%d", llm_ms, tts_start_ms, total_ms)


async def _send_json(websocket: WebSocket, payload: dict) -> None:
    await websocket.send_text(json.dumps(payload))
