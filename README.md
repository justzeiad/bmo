# 🕹️ BMO Voice Arcade

> "Hi friend! I am BMO. I can talk, think, and do cool face animations."  
> (yes, this README is in BMO mode)

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-WebSocket-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111827)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Ollama](https://img.shields.io/badge/LLM-Ollama-black)
![Piper](https://img.shields.io/badge/TTS-Piper-22C55E)
![License](https://img.shields.io/badge/License-MIT-blue)

Realtime voice AI + arcade-style frontend powered by:
- 🎤 STT (`whisper`)
- 🧠 LLM (Ollama)
- 🔊 TTS (Piper)
- 😀 Live face modes (`idle`, `listening`, `thinking`, `speaking`)
- 🟢 FastAPI + WebSocket backend
- 🕹️ React/Vite frontend at `/bmo/`

## ✨ Why It's Cool

- ⚡ Realtime voice turns over WebSocket
- 🎭 Character expression system with emotion + intensity
- 🗣️ Live mode, auto endpoint on silence, and barge-in
- 🧩 Local-first setup (no cloud required)
- 🎮 Arcade shell UI with BMO personality

## 🧠 Face Modes

BMO switches in realtime:
- `warmup`
- `idle`
- `listening`
- `thinking`
- `speaking`
- `error`

## 🛠️ Tech Stack

- Backend: FastAPI, Uvicorn
- Frontend: React 18, Vite, Tailwind CSS
- STT: `whisper`
- LLM: Ollama (`llama3.2:1b` default)
- TTS: `piper-tts`
- Transport: WebSocket (`/ws`)

## 🚀 Quick Start (Docker)

### 1. Start services

```bash
docker compose up --build
```

- `app` on `:8000`
- `ollama` on `:11434`

### 2. Pull LLM model (first time)

```bash
docker compose exec ollama ollama pull llama3.2:1b
```

Optional VLM model:

```bash
docker compose exec ollama ollama pull moondream2
```

### 3. Open BMO

👉 `http://localhost:8000/bmo/`

Legacy URL support:
- `/frontend/` redirects to `/bmo/`

## 💻 Local Run (No Docker)

### Prerequisites

- Python 3.11+
- Node.js 20+
- Ollama installed and running

### 1. Install backend deps

```bash
pip install -r requirements.txt
```

### 2. Build frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

### 3. Pull LLM model

```bash
ollama pull llama3.2:1b
```

### 4. Start server

```bash
python main.py
```

### 5. Open app

👉 `http://localhost:8000/bmo/`

## ⚙️ Configuration

Main files:
- `ai/config/settings.yaml`
- `ai/config/settings.docker.yaml`
- `ai/config/prompts.yaml`
- `ai/config/lineups.yaml`

Set custom config file:

```bash
BMO_SETTINGS=ai/config/settings.yaml python main.py
```

## 📡 WebSocket Events

Client -> Server:
- `open_session`
- `text_input`
- `start_speech`
- `end_speech`
- `barge_in`

Server -> Client:
- `transcript_partial`
- `transcript_final`
- `assistant_text`
- `expression`
- `tts_chunk`
- `turn_done`
- `error`

Helpers:
- `scripts/ws_client.py`
- `scripts/ws_client.html`

## 🗺️ Project Map

```text
BMO/
├─ ai/
│  ├─ api/
│  ├─ config/
│  ├─ core/
│  ├─ llm/
│  ├─ stt/
│  ├─ tts/
│  ├─ memory/
│  ├─ multimodal/
│  └─ utils/
├─ frontend/
│  ├─ public/
│  └─ src/
├─ scripts/
├─ Dockerfile
├─ docker-compose.yml
├─ main.py
└─ requirements.txt
```

## 🧯 Troubleshooting (BMO Is Sleepy)

### No LLM responses

- Check Ollama: `http://localhost:11434`
- Verify model: `ollama list`
- Pull model: `ollama pull llama3.2:1b`

### First run is slow

Normal on first startup:
- STT model warmup/download
- LLM model load

### Face/UI changes not showing

```bash
cd frontend
npm run build
```

Then hard refresh browser: `Ctrl+F5`

## 🧪 Dev Notes

- Vite base path is `/bmo/`
- FastAPI mounts static frontend at `/bmo`
- Root `/` redirects to `/bmo/`

## 🤝 Contributing

1. Create a branch
2. Make focused changes
3. Test text + voice flows
4. Open a PR with notes/screenshots

---

### 💚 BMO Sign-Off

If you build something cool with this, BMO says:  
**"Yay! Friendship and software, together forever."**
