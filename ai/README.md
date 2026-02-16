# BMO AI Backend

This folder contains the AI backend architecture for BMO. It defines how STT, LLM/VLM, TTS, memory, and the expression engine interact.

## Layout
- config: YAML settings and prompts
- core: orchestrator, dialog manager, session, expression engine
- stt: streaming speech-to-text wrappers
- llm: model clients, emotion parsing, safety checks
- tts: speech synthesis engines and audio post-processing
- memory: vector store and embedding wrappers
- multimodal: image and vision handlers
- api: websocket and optional REST routes
- utils: shared helpers
- tests: unit tests

## Run Locally (placeholder)
- Configure models in `ai/config/settings.yaml` and prompts in `ai/config/prompts.yaml`.
- Start the API server in your app entrypoint (not included here).
- Ensure Ollama, Whisper, and Piper/XTTS are available locally if enabled.

## Add a New Emotion
- Update `ai/config/emotions.yaml`.
- Ensure the frontend supports the same emotion enum.
- Optionally add guardrail rules in `ai/core/expression_engine.py`.
