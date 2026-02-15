let ws = null;
let audioCtx = null;
let masterGain = null;
let ttsGain = null;
let nextPlayTime = 0;
let activeAudioSources = [];

let micStream = null;
let micSource = null;
let micProcessor = null;
let talking = false;

let silenceTimer = null;
let lastSpeechAt = 0;
let startedTalkingAt = 0;
let speechDetectedInTurn = false;

let liveMode = false;
let assistantSpeaking = false;
let awaitingAssistantTurn = false;
let waitingForAssistant = false;
let waitingSince = 0;
let pendingAssistantReplyAt = 0;

let faceTimer = null;
let faceState = "warmup";
let faceFrameIndex = 0;
let currentEmotion = "neutral";
let currentIntensity = 0.3;
let lastSyncedEmotion = "neutral";
let errorUntil = 0;
let ttsSpeakingHoldTimer = null;
let expressionAmp = 0;
let speakingLockUntil = 0;
let noAudioReplyTimer = null;
let lastTtsChunkAt = 0;
const LOG_VERBOSE = false;

const TARGET_SAMPLE_RATE = 16000;
const MIC_BUFFER_SIZE = 4096;
const SILENCE_MS = 950;
const MIN_TURN_MS = 700;
const SPEECH_RMS_THRESHOLD = 0.0065;
const THINKING_TIMEOUT_MS = 10000;

const el = (id) => document.getElementById(id);

const FACE_FRAMES = {
  warmup: ["/frontend/faces/warmup/warmup%2001.png"],
  idle: ["/frontend/faces/idle/idle%2001.png"],
  listening: ["/frontend/faces/listening/listen%2001.png", "/frontend/faces/listening/listen%2002.png"],
  thinking: ["/frontend/faces/thinking/thinking%2001.png", "/frontend/faces/thinking/thinking%2002.png", "/frontend/faces/thinking/thinking%2003.png", "/frontend/faces/thinking/thinking%2004.png"],
  speaking: ["/frontend/faces/speaking/speaking%2001.png", "/frontend/faces/speaking/speaking%2002.png", "/frontend/faces/speaking/speaking%2003.png"],
  error: ["/frontend/faces/error/error%2001.png"],
};

const EMOTION_COLOR = {
  neutral: "#6fd7ff",
  happy: "#9af46f",
  excited: "#b8ff7c",
  curious: "#6fd7ff",
  thinking: "#77bcff",
  confused: "#ffb084",
  sad: "#ff9898",
  concerned: "#ff8e84",
  sleepy: "#d2c4ff",
};

/* ─── preload all face frames to eliminate network jank ─── */
const _imageCache = {};
const PRELOAD_QUEUE = [
  ...FACE_FRAMES.warmup,
  ...FACE_FRAMES.idle,
  ...FACE_FRAMES.listening,
  ...FACE_FRAMES.thinking,
  ...FACE_FRAMES.speaking,
  ...FACE_FRAMES.error
];

// Load images sequentially to avoid flooding network
function preloadNext(index = 0) {
  if (index >= PRELOAD_QUEUE.length) return;
  const src = PRELOAD_QUEUE[index];
  if (!_imageCache[src]) {
    const img = new Image();
    img.src = src;
    img.onload = () => preloadNext(index + 1);
    img.onerror = () => preloadNext(index + 1);
    _imageCache[src] = img;
  } else {
    preloadNext(index + 1);
  }
}
// Start preloading
setTimeout(() => preloadNext(0), 100);

const log = (msg) => {
  const t = el("log");
  t.value += msg + "\n";
  t.scrollTop = t.scrollHeight;
};

const setBadge = (online) => {
  const badge = el("connBadge");
  badge.className = `badge ${online ? "online" : "offline"}`;
  badge.textContent = online ? "online" : "offline";
};

const setMicState = (text) => {
  el("micState").textContent = text;
};

const setConnected = (connected) => {
  el("connectBtn").disabled = connected;
  el("disconnectBtn").disabled = !connected;
  el("sendBtn").disabled = !connected;
  el("startMicBtn").disabled = !connected || talking || liveMode;
  el("stopMicBtn").disabled = !connected || !talking || liveMode;
  el("startLiveBtn").disabled = !connected || liveMode;
  el("stopLiveBtn").disabled = !connected || !liveMode;
  el("interruptBtn").disabled = !connected;
  setBadge(connected);
};

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    ttsGain = audioCtx.createGain();
    masterGain.gain.value = 1;
    ttsGain.gain.value = 1;
    ttsGain.connect(masterGain);
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

async function resumeAudio() {
  const ctx = ensureAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
}

function stopFaceAnimation() {
  if (faceTimer) {
    clearInterval(faceTimer);
    faceTimer = null;
  }
}

function renderFaceFrame(index = 0) {
  const frames = FACE_FRAMES[faceState] || FACE_FRAMES.idle;
  el("faceImage").src = frames[index % frames.length];
}

function animationSpeedFor(state, emotion, intensity) {
  let base = 300;
  if (state === "speaking") base = 120;
  if (state === "listening") base = 320;
  if (state === "thinking") base = 350;
  if (emotion === "excited") base -= 40;
  if (emotion === "sleepy") base += 80;
  if (intensity > 0.7) base -= 20;
  return Math.max(90, base);
}

function setTurnIndicator(mode) {
  const map = {
    idle: "turnIdle",
    listening: "turnListening",
    thinking: "turnThinking",
    speaking: "turnSpeaking",
  };
  ["turnIdle", "turnListening", "turnThinking", "turnSpeaking"].forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.classList.toggle("active", id === map[mode]);
  });
}

function applyEmotionStyle(emotion, intensity) {
  const body = document.body;
  const prevEmotion = body.dataset.emotion;
  body.dataset.emotion = emotion;
  body.style.setProperty("--emotion-color", EMOTION_COLOR[emotion] || EMOTION_COLOR.neutral);
  body.style.setProperty("--emotion-intensity", String(intensity));

  // Add a brief transition class when the emotion color actually changes
  if (prevEmotion !== emotion) {
    const stage = el("stageCard");
    stage.classList.add("emotion-shift");
    setTimeout(() => stage.classList.remove("emotion-shift"), 400);
  }
}

function deriveFaceState() {
  if (
    waitingForAssistant &&
    !assistantSpeaking &&
    !talking &&
    waitingSince > 0 &&
    (Date.now() - waitingSince) > THINKING_TIMEOUT_MS
  ) {
    waitingForAssistant = false;
    if (!liveMode) awaitingAssistantTurn = false;
  }

  const now = Date.now();
  if (now < errorUntil) return "error";

  // Speaking has highest priority (visual feedback for audio)
  if (assistantSpeaking) return "speaking";

  // If we're waiting for BMO and not speaking/listening, show thinking
  if (waitingForAssistant && activeAudioSources.length === 0) {
    return "thinking";
  }

  if (talking) return "listening";

  return "idle";
}

function syncFaceState(force = false) {
  const state = deriveFaceState();
  const stage = el("stageCard");
  stage.classList.remove("idle", "listening", "thinking", "speaking", "error");
  stage.classList.add(state);
  setTurnIndicator(state === "error" ? "thinking" : state);

  el("faceState").textContent = `${state}`;
  el("emotionState").textContent = `${currentEmotion} ${Math.round(currentIntensity * 100)}%`;

  const speed = animationSpeedFor(state, currentEmotion, currentIntensity);
  // Restart animation when face state OR emotion changes (emotion affects speed)
  const emotionChanged = currentEmotion !== lastSyncedEmotion;
  if (!force && state === faceState && !emotionChanged && faceTimer) return;

  lastSyncedEmotion = currentEmotion;
  faceState = state;
  faceFrameIndex = 0;
  stopFaceAnimation();
  renderFaceFrame(faceFrameIndex);

  const frames = FACE_FRAMES[state] || FACE_FRAMES.idle;
  if (frames.length <= 1) return;

  // For frames with 3+ images, play them as a ping-pong (1→2→3→4→3→2→1…)
  // so the face looks side-to-side smoothly instead of jumping back to frame 1.
  let sequence;
  if (frames.length >= 3) {
    sequence = [...Array(frames.length).keys()];
    // Add the middle frames in reverse: [0,1,2,3] → [0,1,2,3,2,1]
    for (let i = frames.length - 2; i >= 1; i--) {
      sequence.push(i);
    }
  } else {
    sequence = [0, 1];
  }
  let seqIdx = 0;

  faceTimer = setInterval(() => {
    seqIdx = (seqIdx + 1) % sequence.length;
    renderFaceFrame(sequence[seqIdx]);
  }, speed);
}

function updateLatencyLabel(ms) {
  if (!ms || ms < 0) {
    el("latencyState").textContent = "-";
    return;
  }
  el("latencyState").textContent = `${Math.round(ms)}ms`;
}

function updateMouthMeter(value) {
  const v = Math.max(0, Math.min(1, Number(value || 0)));
  el("mouthMeter").style.width = `${Math.round(v * 100)}%`;
}

function setSpeakingLock(ms = 1000) {
  speakingLockUntil = Date.now() + ms;
  assistantSpeaking = true;
  if (noAudioReplyTimer) {
    clearTimeout(noAudioReplyTimer);
    noAudioReplyTimer = null;
  }
  if (ttsSpeakingHoldTimer) clearTimeout(ttsSpeakingHoldTimer);
  ttsSpeakingHoldTimer = setTimeout(() => {
    if (Date.now() >= speakingLockUntil && activeAudioSources.length === 0) {
      assistantSpeaking = false;
      syncFaceState();
      maybeResumeLiveListening();
    }
  }, ms + 40);
}

function updateFaceFromExpression(payload) {
  const incomingEmotion = String(payload.emotion || "neutral").toLowerCase();
  const incomingIntensity = Math.max(0, Math.min(1, Number(payload.intensity ?? 0.3)));

  const emotionChanged = incomingEmotion && incomingEmotion !== currentEmotion;

  if (incomingEmotion) {
    currentEmotion = incomingEmotion;
    currentIntensity = incomingIntensity;
    applyEmotionStyle(currentEmotion, currentIntensity);
  }

  const amp = Math.max(0, Math.min(1, Number(payload.mouth_amplitude || 0)));
  expressionAmp = amp;
  updateMouthMeter(expressionAmp);

  const prevSpeaking = assistantSpeaking;
  if (Boolean(payload.speaking)) {
    const hasRecentTts = (Date.now() - lastTtsChunkAt) < 550;
    if (hasRecentTts || activeAudioSources.length > 0 || !waitingForAssistant) {
      setSpeakingLock(1000);
    } else {
      assistantSpeaking = false;
    }
  } else if (Date.now() < speakingLockUntil || activeAudioSources.length > 0) {
    assistantSpeaking = true;
  } else {
    assistantSpeaking = false;
  }

  if (prevSpeaking && !assistantSpeaking && liveMode) {
    maybeResumeLiveListening();
  }

  // Force animation restart when emotion changes so speed/style updates immediately
  syncFaceState(emotionChanged);
}

function smoothStopAssistantPlayback() {
  if (!audioCtx || !ttsGain) {
    stopAssistantPlayback();
    return;
  }

  const now = audioCtx.currentTime;
  ttsGain.gain.cancelScheduledValues(now);
  ttsGain.gain.setValueAtTime(ttsGain.gain.value, now);
  ttsGain.gain.linearRampToValueAtTime(0, now + 0.1);

  setTimeout(() => {
    stopAssistantPlayback();
    ttsGain.gain.setValueAtTime(1, audioCtx.currentTime);
  }, 120);
}

function stopAssistantPlayback() {
  if (ttsSpeakingHoldTimer) {
    clearTimeout(ttsSpeakingHoldTimer);
    ttsSpeakingHoldTimer = null;
  }
  for (const source of activeAudioSources) {
    try { source.stop(); } catch (_) { }
  }
  activeAudioSources = [];
  if (audioCtx) nextPlayTime = audioCtx.currentTime;
  assistantSpeaking = false;
  speakingLockUntil = 0;
  lastTtsChunkAt = 0;
  waitingForAssistant = false;
  waitingSince = 0;
  expressionAmp = 0;
  updateMouthMeter(0);
  if (noAudioReplyTimer) {
    clearTimeout(noAudioReplyTimer);
    noAudioReplyTimer = null;
  }
  syncFaceState();
}

function holdSpeakingFromTts() {
  waitingForAssistant = false;
  waitingSince = 0;
  setSpeakingLock(1200);
  syncFaceState();
}

async function interruptAssistantAndListen() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "barge_in" }));
  el("stageCard").classList.add("barge");
  setTimeout(() => el("stageCard").classList.remove("barge"), 260);
  smoothStopAssistantPlayback();
  waitingForAssistant = false;
  waitingSince = 0;
  awaitingAssistantTurn = false;
  pendingAssistantReplyAt = 0;
  if (!talking) await startMic();
}

function rms(samples) {
  let total = 0;
  for (let i = 0; i < samples.length; i++) total += samples[i] * samples[i];
  return Math.sqrt(total / samples.length);
}

function downsampleFloatToInt16(float32Array, inSampleRate, outSampleRate) {
  if (outSampleRate > inSampleRate) throw new Error("Output sample rate must be <= input sample rate");
  const ratio = inSampleRate / outSampleRate;
  const outLength = Math.floor(float32Array.length / ratio);
  const result = new Int16Array(outLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < outLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < float32Array.length; i++) {
      accum += float32Array[i];
      count += 1;
    }
    const sample = count > 0 ? accum / count : 0;
    const s = Math.max(-1, Math.min(1, sample));
    result[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7fff;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function stopSilenceWatcher() {
  if (silenceTimer) {
    clearInterval(silenceTimer);
    silenceTimer = null;
  }
}

function startSilenceWatcher() {
  stopSilenceWatcher();
  silenceTimer = setInterval(() => {
    if (!talking || !el("autoEndpoint").checked) return;
    if (!speechDetectedInTurn) return;

    const now = Date.now();
    const silentFor = now - lastSpeechAt;
    const turnFor = now - startedTalkingAt;
    if (turnFor >= MIN_TURN_MS && silentFor >= SILENCE_MS) stopMic("silence");
  }, 100);
}

function markThinkingPending() {
  // End any stale speaking lock from the previous turn.
  assistantSpeaking = false;
  speakingLockUntil = 0;
  if (ttsSpeakingHoldTimer) {
    clearTimeout(ttsSpeakingHoldTimer);
    ttsSpeakingHoldTimer = null;
  }
  waitingForAssistant = true;
  waitingSince = Date.now();
  awaitingAssistantTurn = liveMode;
  pendingAssistantReplyAt = Date.now();
  syncFaceState();
}

async function startMic() {
  if (!ws || ws.readyState !== WebSocket.OPEN || talking) return;

  await resumeAudio();

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  micSource = audioCtx.createMediaStreamSource(micStream);
  micProcessor = audioCtx.createScriptProcessor(MIC_BUFFER_SIZE, 1, 1);

  startedTalkingAt = Date.now();
  lastSpeechAt = startedTalkingAt;
  speechDetectedInTurn = false;
  waitingForAssistant = false;
  waitingSince = 0;
  awaitingAssistantTurn = false;
  pendingAssistantReplyAt = 0;

  micProcessor.onaudioprocess = (event) => {
    if (!talking || !ws || ws.readyState !== WebSocket.OPEN) return;

    const input = event.inputBuffer.getChannelData(0);
    const level = rms(input);

    if (level > SPEECH_RMS_THRESHOLD) {
      speechDetectedInTurn = true;
      lastSpeechAt = Date.now();
    }

    ws.send(downsampleFloatToInt16(input, audioCtx.sampleRate, TARGET_SAMPLE_RATE).buffer);
  };

  micSource.connect(micProcessor);
  micProcessor.connect(audioCtx.destination);

  ws.send(JSON.stringify({ type: "start_speech" }));
  talking = true;
  setMicState(liveMode ? "live listening" : "listening");
  setConnected(true);
  syncFaceState();
  startSilenceWatcher();
  log("mic started");
}

function stopMic(reason = "manual") {
  if (!talking) return;

  talking = false;
  stopSilenceWatcher();

  if (micProcessor) {
    micProcessor.disconnect();
    micProcessor.onaudioprocess = null;
    micProcessor = null;
  }
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "end_speech" }));
    markThinkingPending();
  }

  setMicState(liveMode ? "live waiting for BMO" : "mic idle");
  setConnected(true);
  syncFaceState();
  log(`mic stopped (${reason})`);
}

async function maybeResumeLiveListening() {
  if (!liveMode || talking || assistantSpeaking || !awaitingAssistantTurn) return;
  awaitingAssistantTurn = false;
  await startMic();
}

function computeBufferRms(audioBuffer) {
  const channel = audioBuffer.getChannelData(0);
  let acc = 0;
  const step = Math.max(1, Math.floor(channel.length / 1800));
  let n = 0;
  for (let i = 0; i < channel.length; i += step) {
    const v = channel[i];
    acc += v * v;
    n += 1;
  }
  if (n === 0) return 0;
  return Math.min(1, Math.sqrt(acc / n) * 6.5);
}

el("connectBtn").onclick = () => {
  const url = el("wsUrl").value;
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  currentEmotion = "neutral";
  currentIntensity = 0.3;
  applyEmotionStyle(currentEmotion, currentIntensity);
  syncFaceState(true);

  ws.onopen = async () => {
    await resumeAudio();
    setConnected(true);
    log("connected");
    ws.send(JSON.stringify({ type: "open_session", sessionId: "web", userId: "web" }));
    nextPlayTime = audioCtx.currentTime;
  };

  ws.onclose = () => {
    liveMode = false;
    stopAssistantPlayback();
    stopMic("disconnect");
    setConnected(false);
    setMicState("mic idle");
    updateLatencyLabel(0);
    waitingForAssistant = false;
    waitingSince = 0;
    awaitingAssistantTurn = false;
    pendingAssistantReplyAt = 0;
    if (ttsSpeakingHoldTimer) {
      clearTimeout(ttsSpeakingHoldTimer);
      ttsSpeakingHoldTimer = null;
    }
    if (noAudioReplyTimer) {
      clearTimeout(noAudioReplyTimer);
      noAudioReplyTimer = null;
    }
    syncFaceState(true);
    log("disconnected");
  };

  ws.onmessage = async (evt) => {
    if (typeof evt.data !== "string") return;

    const payload = JSON.parse(evt.data);
    const type = payload.type;

    if (type === "transcript_partial" || type === "transcript_final") {
      el("transcriptText").textContent = payload.text || "-";
      if (type === "transcript_final" && String(payload.text || "").trim()) {
        pendingAssistantReplyAt = Date.now();
      }
    }

    if (type === "assistant_text") {
      const text = String(payload.text || "").trim();
      el("assistantText").textContent = text || "...";
      if (pendingAssistantReplyAt > 0) {
        updateLatencyLabel(Date.now() - pendingAssistantReplyAt);
        pendingAssistantReplyAt = 0;
      }
      // Keep thinking visible until audio starts; if no audio arrives, exit thinking shortly.
      if (noAudioReplyTimer) clearTimeout(noAudioReplyTimer);
      noAudioReplyTimer = setTimeout(() => {
        if (!assistantSpeaking && activeAudioSources.length === 0) {
          waitingForAssistant = false;
          waitingSince = 0;
          if (!liveMode) {
            awaitingAssistantTurn = false;
          } else {
            awaitingAssistantTurn = true;
          }
          syncFaceState();
          maybeResumeLiveListening();
        }
      }, 2500);
      syncFaceState();
    }

    if (type === "turn_done") {
      waitingForAssistant = false;
      waitingSince = 0;
      if (noAudioReplyTimer) {
        clearTimeout(noAudioReplyTimer);
        noAudioReplyTimer = null;
      }
      if (liveMode) {
        awaitingAssistantTurn = true;
        maybeResumeLiveListening();
      } else {
        awaitingAssistantTurn = false;
      }
      syncFaceState();
    }

    if (type === "expression") {
      updateFaceFromExpression(payload);
    }

    if (type === "error") {
      errorUntil = Date.now() + 1300;
      waitingForAssistant = false;
      waitingSince = 0;
      awaitingAssistantTurn = liveMode;
      pendingAssistantReplyAt = 0;
      if (noAudioReplyTimer) {
        clearTimeout(noAudioReplyTimer);
        noAudioReplyTimer = null;
      }
      syncFaceState(true);
      if (liveMode) {
        setTimeout(() => {
          maybeResumeLiveListening();
        }, 350);
      }
      setTimeout(() => syncFaceState(true), 1320);
    }

    if (type === "tts_chunk") {
      const data = payload.data || "";
      if (!data) return;

      lastTtsChunkAt = Date.now();
      waitingForAssistant = false;
      waitingSince = 0;
      if (noAudioReplyTimer) {
        clearTimeout(noAudioReplyTimer);
        noAudioReplyTimer = null;
      }
      holdSpeakingFromTts();
      await resumeAudio();

      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer;
      const audioBuffer = await audioCtx.decodeAudioData(bytes.slice(0));
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ttsGain);
      source.onended = () => {
        activeAudioSources = activeAudioSources.filter((s) => s !== source);
        if (activeAudioSources.length === 0 && Date.now() >= speakingLockUntil) {
          assistantSpeaking = false;
          syncFaceState();
        }
      };
      activeAudioSources.push(source);

      expressionAmp = Math.max(expressionAmp * 0.55, computeBufferRms(audioBuffer));
      updateMouthMeter(expressionAmp);

      const startTime = Math.max(nextPlayTime, audioCtx.currentTime);
      source.start(startTime);
      nextPlayTime = startTime + audioBuffer.duration;
      return;
    }

    if (LOG_VERBOSE || (type !== "expression" && type !== "listening")) {
      log(JSON.stringify(payload));
    }
  };
};

el("disconnectBtn").onclick = () => {
  if (ws) ws.close();
};

el("sendBtn").onclick = async () => {
  const text = el("textInput").value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  await resumeAudio();
  ws.send(JSON.stringify({ type: "text_input", text }));
  assistantSpeaking = false;
  speakingLockUntil = 0;
  if (ttsSpeakingHoldTimer) {
    clearTimeout(ttsSpeakingHoldTimer);
    ttsSpeakingHoldTimer = null;
  }
  waitingForAssistant = true;
  waitingSince = Date.now();
  pendingAssistantReplyAt = Date.now();
  awaitingAssistantTurn = liveMode;
  syncFaceState();
};

el("startMicBtn").onclick = async () => {
  try {
    await startMic();
  } catch (err) {
    log(`mic error: ${String(err)}`);
    errorUntil = Date.now() + 1400;
    syncFaceState(true);
  }
};

el("stopMicBtn").onclick = () => {
  stopMic("manual");
};

el("startLiveBtn").onclick = async () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  liveMode = true;
  awaitingAssistantTurn = false;
  setConnected(true);
  setMicState("live starting");
  try {
    await startMic();
  } catch (err) {
    liveMode = false;
    log(`live start error: ${String(err)}`);
    errorUntil = Date.now() + 1400;
    syncFaceState(true);
  }
};

el("stopLiveBtn").onclick = () => {
  liveMode = false;
  waitingForAssistant = false;
  waitingSince = 0;
  awaitingAssistantTurn = false;
  smoothStopAssistantPlayback();
  stopMic("live stop");
  setMicState("mic idle");
  syncFaceState(true);
  setConnected(true);
};

el("interruptBtn").onclick = async () => {
  try {
    await interruptAssistantAndListen();
  } catch (err) {
    log(`interrupt error: ${String(err)}`);
  }
};

applyEmotionStyle("neutral", 0.3);
syncFaceState(true);
setConnected(false);
setMicState("mic idle");
updateMouthMeter(0);
