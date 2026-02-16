import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TARGET_SAMPLE_RATE = 16000;
const MIC_BUFFER_SIZE = 4096;
const SILENCE_MS = 650;
const MIN_TURN_MS = 450;
const SPEECH_RMS_THRESHOLD = 0.0065;
const PLAYBACK_LEAD_SEC = 0.035;

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const asset = (path) => `${BASE}${path.startsWith("/") ? path : `/${path}`}`;

const FACE_FRAMES = {
  warmup: [asset("/faces/warmup/warmup%2001.png")],
  idle: [asset("/faces/idle/idle%2001.png")],
  listening: [asset("/faces/listening/listen%2001.png"), asset("/faces/listening/listen%2002.png")],
  thinking: [
    asset("/faces/thinking/thinking%2001.png"),
    asset("/faces/thinking/thinking%2002.png"),
    asset("/faces/thinking/thinking%2003.png"),
    asset("/faces/thinking/thinking%2004.png"),
  ],
  speaking: [
    asset("/faces/speaking/speaking%2001.png"),
    asset("/faces/speaking/speaking%2002.png"),
    asset("/faces/speaking/speaking%2003.png"),
  ],
  error: [asset("/faces/error/error%2001.png")],
};

const EMOTION_COLORS = {
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

const GAMES = [
  { id: "snake", title: "Snake", status: "coming soon" },
  { id: "runner", title: "Pixel Runner", status: "coming soon" },
  { id: "puzzle", title: "BMO Blocks", status: "coming soon" },
];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rms(samples) {
  let total = 0;
  for (let i = 0; i < samples.length; i += 1) total += samples[i] * samples[i];
  return Math.sqrt(total / Math.max(1, samples.length));
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
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < float32Array.length; i += 1) {
      accum += float32Array[i];
      count += 1;
    }
    const sample = count > 0 ? accum / count : 0;
    const s = clamp(sample, -1, 1);
    result[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7fff;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
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
  return clamp(Math.sqrt(acc / n) * 6.5, 0, 1);
}

function pcm16ToAudioBuffer(audioCtx, rawBuffer, sampleRate) {
  const dv = new DataView(rawBuffer);
  const samples = new Float32Array(rawBuffer.byteLength / 2);
  let j = 0;
  for (let i = 0; i < rawBuffer.byteLength; i += 2) {
    samples[j] = dv.getInt16(i, true) / 32768;
    j += 1;
  }
  const sr = Number(sampleRate) > 0 ? Number(sampleRate) : 22050;
  const buf = audioCtx.createBuffer(1, samples.length, sr);
  buf.copyToChannel(samples, 0);
  return buf;
}

function useStateRef(initialValue) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef(initialValue);
  const set = useCallback((next) => {
    const computed = typeof next === "function" ? next(ref.current) : next;
    ref.current = computed;
    setValue(computed);
  }, []);
  return [value, set, ref];
}

function WaveMeter({ mouthAmp, micLevel, faceMode }) {
  const canvasRef = useRef(null);
  const mouthRef = useRef(mouthAmp);
  const micRef = useRef(micLevel);
  const modeRef = useRef(faceMode);

  useEffect(() => {
    mouthRef.current = mouthAmp;
  }, [mouthAmp]);

  useEffect(() => {
    micRef.current = micLevel;
  }, [micLevel]);

  useEffect(() => {
    modeRef.current = faceMode;
  }, [faceMode]);

  useEffect(() => {
    let raf = 0;
    let phase = 0;
    const canvas = canvasRef.current;
    if (!canvas) return () => {};
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => {};

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      const bars = 40;
      const barW = w / bars;
      const mode = modeRef.current;
      const active = mode === "speaking" || mode === "listening";
      const energy = clamp(Math.max(mouthRef.current, micRef.current), 0, 1);
      phase += active ? 0.28 : 0.1;

      for (let i = 0; i < bars; i += 1) {
        const x = i * barW;
        const wave = Math.sin(phase + i * 0.35);
        const pulse = active ? 0.25 : 0.08;
        const amp = clamp(energy * 0.88 + pulse + wave * 0.14, 0.06, 1);
        const barH = (h * amp) / 1.7;
        const y = (h - barH) / 2;
        ctx.fillStyle = i % 2 ? "rgba(58,230,109,0.92)" : "rgba(164,255,188,0.88)";
        ctx.fillRect(x + 1, y, Math.max(1, barW - 2), barH);
      }
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="h-16 w-full rounded-lg border border-bmo-line/80 bg-black/45" />;
}

export default function App() {
  const defaultWsUrl = useMemo(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/ws`;
  }, []);

  const [booting, setBooting] = useState(true);
  const [section, setSection] = useState("menu");
  const [activeGame, setActiveGame] = useState(null);
  const [wsUrl, setWsUrl] = useState(defaultWsUrl);
  const [textInput, setTextInput] = useState("");
  const [transcript, setTranscript] = useState("-");
  const [assistantText, setAssistantText] = useState("Connect and start a live chat.");
  const [latencyMs, setLatencyMs] = useState(null);
  const [micState, setMicState] = useState("mic idle");
  const [logLines, setLogLines] = useState([]);
  const [emotionPulse, setEmotionPulse] = useState(false);
  const [bargeFlash, setBargeFlash] = useState(false);
  const [faceFrameIdx, setFaceFrameIdx] = useState(0);

  const [connected, setConnected, connectedRef] = useStateRef(false);
  const [talking, setTalking, talkingRef] = useStateRef(false);
  const [liveMode, setLiveMode, liveModeRef] = useStateRef(false);
  const [assistantSpeaking, setAssistantSpeaking, assistantSpeakingRef] = useStateRef(false);
  const [waitingForAssistant, setWaitingForAssistant, waitingForAssistantRef] = useStateRef(false);
  const [emotion, setEmotion, emotionRef] = useStateRef("neutral");
  const [intensity, setIntensity, intensityRef] = useStateRef(0.3);
  const [mouthAmp, setMouthAmp, mouthAmpRef] = useStateRef(0);
  const [micLevel, setMicLevel, micLevelRef] = useStateRef(0);
  const [faceMode, setFaceMode, faceModeRef] = useStateRef("warmup");

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const masterGainRef = useRef(null);
  const ttsGainRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const activeAudioSourcesRef = useRef([]);
  const micStreamRef = useRef(null);
  const micSourceRef = useRef(null);
  const micProcessorRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const noAudioReplyTimerRef = useRef(null);
  const speakingHoldTimerRef = useRef(null);
  const waitingSinceRef = useRef(0);
  const pendingAssistantReplyAtRef = useRef(0);
  const speakingLockUntilRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const startedTalkingAtRef = useRef(0);
  const speechDetectedInTurnRef = useRef(false);
  const errorUntilRef = useRef(0);
  const lastMicUiUpdateRef = useRef(0);
  const startingMicRef = useRef(false);

  const appendLog = useCallback((line) => {
    const text = String(line || "").trim();
    if (!text) return;
    setLogLines((prev) => [...prev.slice(-140), text]);
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const master = ctx.createGain();
      const tts = ctx.createGain();
      master.gain.value = 1;
      tts.gain.value = 1;
      tts.connect(master);
      master.connect(ctx.destination);
      audioCtxRef.current = ctx;
      masterGainRef.current = master;
      ttsGainRef.current = tts;
      nextPlayTimeRef.current = ctx.currentTime;
    }
    return audioCtxRef.current;
  }, []);

  const resumeAudio = useCallback(async () => {
    const ctx = ensureAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx;
  }, [ensureAudioContext]);

  const playUiTone = useCallback(
    async (kind) => {
      const ctx = await resumeAudio();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      if (kind === "confirm") {
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(720, ctx.currentTime + 0.08);
      } else if (kind === "warn") {
        osc.frequency.setValueAtTime(210, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(170, ctx.currentTime + 0.09);
      } else {
        osc.frequency.setValueAtTime(420, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(500, ctx.currentTime + 0.06);
      }
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
      osc.connect(gain);
      gain.connect(masterGainRef.current);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    },
    [resumeAudio],
  );

  const syncFaceState = useCallback(
    (force = false) => {
      let next = "idle";
      const now = Date.now();
      if (now < errorUntilRef.current) next = "error";
      else if (assistantSpeakingRef.current) next = "speaking";
      else if (waitingForAssistantRef.current && !talkingRef.current) next = "thinking";
      else if (talkingRef.current) next = "listening";
      else if (!connectedRef.current) next = "warmup";
      if (force || next !== faceModeRef.current) setFaceMode(next);
    },
    [assistantSpeakingRef, connectedRef, faceModeRef, setFaceMode, talkingRef, waitingForAssistantRef],
  );

  const stopSilenceWatcher = useCallback(() => {
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stopAssistantPlayback = useCallback(() => {
    if (speakingHoldTimerRef.current) {
      clearTimeout(speakingHoldTimerRef.current);
      speakingHoldTimerRef.current = null;
    }
    if (noAudioReplyTimerRef.current) {
      clearTimeout(noAudioReplyTimerRef.current);
      noAudioReplyTimerRef.current = null;
    }
    for (const source of activeAudioSourcesRef.current) {
      try {
        source.stop();
      } catch (_) {
        // noop
      }
    }
    activeAudioSourcesRef.current = [];
    if (audioCtxRef.current) {
      nextPlayTimeRef.current = audioCtxRef.current.currentTime;
    }
    setAssistantSpeaking(false);
    setWaitingForAssistant(false);
    setMouthAmp(0);
    speakingLockUntilRef.current = 0;
    syncFaceState(true);
  }, [setAssistantSpeaking, setMouthAmp, setWaitingForAssistant, syncFaceState]);

  const smoothStopAssistantPlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    const gain = ttsGainRef.current;
    if (!ctx || !gain) {
      stopAssistantPlayback();
      return;
    }
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.08);
    setTimeout(() => {
      stopAssistantPlayback();
      gain.gain.setValueAtTime(1, ctx.currentTime);
    }, 110);
  }, [stopAssistantPlayback]);

  const stopMic = useCallback(
    (reason = "manual") => {
      if (!talkingRef.current) return;
      setTalking(false);
      stopSilenceWatcher();
      if (micProcessorRef.current) {
        micProcessorRef.current.disconnect();
        micProcessorRef.current.onaudioprocess = null;
        micProcessorRef.current = null;
      }
      if (micSourceRef.current) {
        micSourceRef.current.disconnect();
        micSourceRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      setMicLevel(0);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "end_speech" }));
        setWaitingForAssistant(true);
        waitingSinceRef.current = Date.now();
      }
      setMicState(liveModeRef.current ? "live waiting" : "mic idle");
      appendLog(`mic stopped (${reason})`);
      syncFaceState(true);
    },
    [appendLog, liveModeRef, setMicLevel, setTalking, setWaitingForAssistant, stopSilenceWatcher, syncFaceState, talkingRef],
  );

  const maybeResumeLiveListening = useCallback(async (force = false) => {
    if (!force && !liveModeRef.current) return;
    if (!connectedRef.current || talkingRef.current || assistantSpeakingRef.current || waitingForAssistantRef.current) return;
    try {
      await resumeAudio();
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || talkingRef.current) return;
      if (startingMicRef.current) return;
      startingMicRef.current = true;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const ctx = ensureAudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(MIC_BUFFER_SIZE, 1, 1);
        startedTalkingAtRef.current = Date.now();
        lastSpeechAtRef.current = startedTalkingAtRef.current;
        speechDetectedInTurnRef.current = false;
        processor.onaudioprocess = (event) => {
          if (!talkingRef.current) return;
          const input = event.inputBuffer.getChannelData(0);
          const level = rms(input);
          if (level > SPEECH_RMS_THRESHOLD) {
            speechDetectedInTurnRef.current = true;
            lastSpeechAtRef.current = Date.now();
          }
          if (Date.now() - lastMicUiUpdateRef.current > 45) {
            lastMicUiUpdateRef.current = Date.now();
            setMicLevel(clamp(level * 8, 0, 1));
          }
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(downsampleFloatToInt16(input, ctx.sampleRate, TARGET_SAMPLE_RATE).buffer);
          }
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        micStreamRef.current = stream;
        micSourceRef.current = source;
        micProcessorRef.current = processor;
        wsRef.current.send(JSON.stringify({ type: "start_speech" }));
        setTalking(true);
        setMicState(liveModeRef.current ? "live listening" : "listening");
        setWaitingForAssistant(false);
        waitingSinceRef.current = 0;
        if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
        silenceTimerRef.current = setInterval(() => {
          if (!talkingRef.current || !speechDetectedInTurnRef.current) return;
          const now = Date.now();
          if (now - startedTalkingAtRef.current < MIN_TURN_MS) return;
          if (now - lastSpeechAtRef.current >= SILENCE_MS) stopMic("silence");
        }, 100);
        appendLog("mic started");
        syncFaceState(true);
      } catch (err) {
        appendLog(`mic error: ${String(err)}`);
        errorUntilRef.current = Date.now() + 1200;
        syncFaceState(true);
      } finally {
        startingMicRef.current = false;
      }
    } catch (_) {
      // noop
    }
  }, [
    appendLog,
    assistantSpeakingRef,
    connectedRef,
    ensureAudioContext,
    liveModeRef,
    resumeAudio,
    setMicLevel,
    setTalking,
    setWaitingForAssistant,
    stopMic,
    syncFaceState,
    talkingRef,
    waitingForAssistantRef,
  ]);

  const interruptAssistant = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "barge_in" }));
    setBargeFlash(true);
    setTimeout(() => setBargeFlash(false), 280);
    smoothStopAssistantPlayback();
    setWaitingForAssistant(false);
    waitingSinceRef.current = 0;
    appendLog("barge-in");
    await playUiTone("warn");
    await maybeResumeLiveListening(true);
  }, [appendLog, maybeResumeLiveListening, playUiTone, setWaitingForAssistant, smoothStopAssistantPlayback]);

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) ws.close();
  }, []);

  const handleExpression = useCallback(
    (payload) => {
      const nextEmotion = String(payload.emotion || "neutral").toLowerCase();
      const nextIntensity = clamp(Number(payload.intensity ?? 0.3), 0, 1);
      const emotionChanged = nextEmotion !== emotionRef.current;
      setEmotion(nextEmotion);
      setIntensity(nextIntensity);
      if (emotionChanged) {
        setEmotionPulse(true);
        setTimeout(() => setEmotionPulse(false), 320);
      }

      const amp = clamp(Number(payload.mouth_amplitude || 0), 0, 1);
      setMouthAmp(amp);
      if (payload.speaking) {
        speakingLockUntilRef.current = Date.now() + 1000;
        setAssistantSpeaking(true);
      } else if (activeAudioSourcesRef.current.length === 0 && Date.now() >= speakingLockUntilRef.current) {
        setAssistantSpeaking(false);
      }
      if (speakingHoldTimerRef.current) clearTimeout(speakingHoldTimerRef.current);
      speakingHoldTimerRef.current = setTimeout(() => {
        if (activeAudioSourcesRef.current.length === 0 && Date.now() >= speakingLockUntilRef.current) {
          setAssistantSpeaking(false);
          syncFaceState();
          void maybeResumeLiveListening();
        }
      }, 1040);
      syncFaceState(emotionChanged);
    },
    [
      emotionRef,
      maybeResumeLiveListening,
      setAssistantSpeaking,
      setEmotion,
      setIntensity,
      setMouthAmp,
      syncFaceState,
    ],
  );

  const handleTtsChunk = useCallback(
    async (payload) => {
      const data = payload.data || "";
      if (!data) return;
      const ctx = await resumeAudio();
      if (noAudioReplyTimerRef.current) {
        clearTimeout(noAudioReplyTimerRef.current);
        noAudioReplyTimerRef.current = null;
      }
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const rawBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const format = String(payload.format || "wav").toLowerCase();
      let audioBuffer;
      if (format === "pcm16") {
        audioBuffer = pcm16ToAudioBuffer(ctx, rawBuffer, payload.sample_rate);
      } else {
        audioBuffer = await ctx.decodeAudioData(rawBuffer);
      }
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ttsGainRef.current);
      source.onended = () => {
        activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter((s) => s !== source);
        if (activeAudioSourcesRef.current.length === 0 && Date.now() >= speakingLockUntilRef.current) {
          setAssistantSpeaking(false);
          setMouthAmp(0);
          syncFaceState();
          void maybeResumeLiveListening();
        }
      };
      activeAudioSourcesRef.current.push(source);
      const amp = Math.max(mouthAmpRef.current * 0.55, computeBufferRms(audioBuffer));
      setMouthAmp(amp);
      setAssistantSpeaking(true);
      setWaitingForAssistant(false);
      speakingLockUntilRef.current = Date.now() + 1200;
      syncFaceState();
      const startTime = Math.max(nextPlayTimeRef.current, ctx.currentTime + PLAYBACK_LEAD_SEC);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + audioBuffer.duration;
    },
    [
      maybeResumeLiveListening,
      mouthAmpRef,
      resumeAudio,
      setAssistantSpeaking,
      setMouthAmp,
      setWaitingForAssistant,
      syncFaceState,
    ],
  );

  const connect = useCallback(async () => {
    if (connectedRef.current) return;
    try {
      await resumeAudio();
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        setMicState("connected");
        setTranscript("-");
        setAssistantText("Connected. Start live mode and talk.");
        ws.send(JSON.stringify({ type: "open_session", sessionId: "web", userId: "web" }));
        appendLog("connected");
        void playUiTone("confirm");
        syncFaceState(true);
      };
      ws.onclose = () => {
        stopMic("disconnect");
        stopAssistantPlayback();
        setConnected(false);
        setLiveMode(false);
        setMicState("mic idle");
        setWaitingForAssistant(false);
        pendingAssistantReplyAtRef.current = 0;
        appendLog("disconnected");
        syncFaceState(true);
      };
      ws.onmessage = (evt) => {
        if (typeof evt.data !== "string") return;
        let payload;
        try {
          payload = JSON.parse(evt.data);
        } catch {
          return;
        }
        const type = payload.type;
        if (type === "transcript_partial" || type === "transcript_final") {
          setTranscript(payload.text || "");
          if (type === "transcript_final" && String(payload.text || "").trim()) {
            pendingAssistantReplyAtRef.current = Date.now();
          }
        } else if (type === "assistant_text") {
          const text = String(payload.text || "").trim();
          setAssistantText(text || "...");
          if (pendingAssistantReplyAtRef.current > 0) {
            setLatencyMs(Date.now() - pendingAssistantReplyAtRef.current);
            pendingAssistantReplyAtRef.current = 0;
          }
          if (noAudioReplyTimerRef.current) clearTimeout(noAudioReplyTimerRef.current);
          noAudioReplyTimerRef.current = setTimeout(() => {
            if (!assistantSpeakingRef.current && activeAudioSourcesRef.current.length === 0) {
              setWaitingForAssistant(false);
              waitingSinceRef.current = 0;
              syncFaceState();
              void maybeResumeLiveListening();
            }
          }, 900);
        } else if (type === "expression") {
          handleExpression(payload);
        } else if (type === "tts_chunk") {
          void handleTtsChunk(payload);
        } else if (type === "turn_done") {
          setWaitingForAssistant(false);
          waitingSinceRef.current = 0;
          syncFaceState();
          void maybeResumeLiveListening();
        } else if (type === "error") {
          errorUntilRef.current = Date.now() + 1300;
          setWaitingForAssistant(false);
          setAssistantSpeaking(false);
          appendLog(`${payload.code || "error"}: ${payload.message || "request failed"}`);
          syncFaceState(true);
          setTimeout(() => syncFaceState(true), 1320);
          void playUiTone("warn");
          void maybeResumeLiveListening();
        } else if (type === "open_session") {
          appendLog("session open");
        } else if (type !== "listening" && type !== "barge_in_ack") {
          appendLog(JSON.stringify(payload));
        }
      };
    } catch (err) {
      appendLog(`connect error: ${String(err)}`);
      errorUntilRef.current = Date.now() + 1200;
      syncFaceState(true);
    }
  }, [
    appendLog,
    assistantSpeakingRef,
    connectedRef,
    handleExpression,
    handleTtsChunk,
    maybeResumeLiveListening,
    playUiTone,
    resumeAudio,
    setAssistantSpeaking,
    setConnected,
    setLiveMode,
    setWaitingForAssistant,
    stopAssistantPlayback,
    stopMic,
    syncFaceState,
    wsUrl,
  ]);

  const sendText = useCallback(() => {
    const ws = wsRef.current;
    const text = textInput.trim();
    if (!ws || ws.readyState !== WebSocket.OPEN || !text) return;
    ws.send(JSON.stringify({ type: "text_input", text }));
    setTextInput("");
    setWaitingForAssistant(true);
    waitingSinceRef.current = Date.now();
    pendingAssistantReplyAtRef.current = Date.now();
    syncFaceState(true);
  }, [setWaitingForAssistant, syncFaceState, textInput]);

  const startLiveMode = useCallback(async () => {
    if (!connectedRef.current) return;
    setLiveMode(true);
    setMicState("live starting");
    await playUiTone("confirm");
    await maybeResumeLiveListening();
  }, [connectedRef, maybeResumeLiveListening, playUiTone, setLiveMode]);

  const stopLiveMode = useCallback(() => {
    setLiveMode(false);
    stopMic("live stop");
    smoothStopAssistantPlayback();
    setWaitingForAssistant(false);
    setMicState("mic idle");
    syncFaceState(true);
  }, [setLiveMode, setWaitingForAssistant, smoothStopAssistantPlayback, stopMic, syncFaceState]);

  const currentFrames = FACE_FRAMES[faceMode] || FACE_FRAMES.idle;
  const faceSrc = currentFrames[Math.min(faceFrameIdx, Math.max(0, currentFrames.length - 1))] || FACE_FRAMES.idle[0];

  useEffect(() => {
    document.body.style.setProperty("--emotion-color", EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral);
  }, [emotion]);

  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), 760);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    Object.values(FACE_FRAMES)
      .flat()
      .forEach((src) => {
        const img = new Image();
        img.src = src;
      });
  }, []);

  useEffect(() => {
    const frames = FACE_FRAMES[faceMode] || FACE_FRAMES.idle;
    setFaceFrameIdx(0);
    if (frames.length <= 1) return () => {};
    let sequence;
    if (frames.length >= 3) {
      sequence = [...Array(frames.length).keys()];
      for (let i = frames.length - 2; i >= 1; i -= 1) sequence.push(i);
    } else {
      sequence = [0, 1];
    }
    let seqPos = 0;
    let speed = 280;
    if (faceMode === "speaking") speed = 120;
    if (faceMode === "listening") speed = 240;
    if (faceMode === "thinking") speed = 330;
    if (emotion === "excited") speed -= 24;
    if (emotion === "sleepy") speed += 80;
    speed = clamp(speed - intensity * 28, 90, 420);

    const id = setInterval(() => {
      seqPos = (seqPos + 1) % sequence.length;
      setFaceFrameIdx(sequence[seqPos]);
    }, speed);
    return () => clearInterval(id);
  }, [emotion, faceMode, intensity, mouthAmp]);

  useEffect(
    () => () => {
      disconnect();
      stopMic("cleanup");
      stopAssistantPlayback();
      stopSilenceWatcher();
    },
    [disconnect, stopAssistantPlayback, stopMic, stopSilenceWatcher],
  );

  const statusColor = EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral;
  const inChat = section === "chat";
  const turnMode = faceMode;
  const canConnect = !connected;
  const canDisconnect = connected;
  const canStartMic = connected && !talking;
  const canStopMic = connected && talking;
  const canStartLive = connected && !liveMode;
  const canStopLive = connected && liveMode;

  return (
    <div className="min-h-screen text-bmo-text">
      <div className={`boot-overlay ${booting ? "" : "hidden"}`}>
        <div className="crt-scan w-full max-w-xl rounded-2xl border border-bmo-line bg-black/75 p-6 shadow-crt">
          <div className="pixel-font text-center text-sm text-bmo-accentSoft">BMO OS BOOTING...</div>
          <div className="mt-4 h-2 overflow-hidden rounded bg-bmo-line/30">
            <div className="h-full w-full origin-left animate-pulse bg-bmo-accent" />
          </div>
        </div>
      </div>

      {section === "menu" && (
        <main className="menu-enter flex min-h-screen items-center justify-center px-4 py-8">
          <section className="crt-scan w-full max-w-2xl rounded-2xl border border-bmo-line bg-bmo-panel/90 p-6 shadow-crt">
            <header className="mb-6 flex items-end justify-between">
              <div>
                <div className="pixel-font text-2xl tracking-wide text-bmo-accentSoft">BMO ARCADE OS</div>
                <div className="mt-2 text-sm text-bmo-sub">chat + games shell</div>
              </div>
              <div className="rounded-full border border-bmo-line px-3 py-1 text-xs uppercase tracking-wider text-bmo-sub">v0.1</div>
            </header>
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                className="rounded-xl border border-bmo-accent/50 bg-black/45 p-4 text-left transition hover:-translate-y-0.5 hover:border-bmo-accent hover:bg-black/60"
                onClick={() => {
                  setSection("chat");
                  void playUiTone("confirm");
                }}
              >
                <div className="pixel-font text-sm text-bmo-accentSoft">CHAT</div>
                <div className="mt-2 text-sm text-bmo-sub">Talk with BMO in realtime voice mode.</div>
              </button>
              <button
                type="button"
                className="rounded-xl border border-bmo-accent/50 bg-black/45 p-4 text-left transition hover:-translate-y-0.5 hover:border-bmo-accent hover:bg-black/60"
                onClick={() => {
                  setSection("games");
                  void playUiTone("confirm");
                }}
              >
                <div className="pixel-font text-sm text-bmo-accentSoft">GAMES</div>
                <div className="mt-2 text-sm text-bmo-sub">Fullscreen game launcher with arcade shell.</div>
              </button>
            </div>
          </section>
        </main>
      )}
      {section === "games" && (
        <main className="menu-enter min-h-screen bg-black/60 p-3 md:p-5">
          <section className="crt-scan mx-auto flex min-h-[calc(100vh-24px)] w-full max-w-6xl flex-col rounded-2xl border border-bmo-line bg-bmo-panel/95 shadow-crt">
            <header className="flex items-center justify-between border-b border-bmo-line/70 px-4 py-3">
              <div className="pixel-font text-sm text-bmo-accentSoft">BMO GAME LIBRARY</div>
              <button
                type="button"
                className="rounded-md border border-bmo-line bg-black/50 px-3 py-1 text-sm text-bmo-sub hover:border-bmo-accent"
                onClick={() => {
                  setSection("menu");
                  void playUiTone("ui");
                }}
              >
                Back
              </button>
            </header>
            <div className="grid flex-1 gap-3 p-4 md:grid-cols-3">
              {GAMES.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className="rounded-xl border border-bmo-line bg-black/50 p-4 text-left transition hover:-translate-y-1 hover:border-bmo-accent"
                  onClick={() => {
                    setActiveGame(game);
                    void playUiTone("confirm");
                  }}
                >
                  <div className="pixel-font text-xs text-bmo-accentSoft">{game.title}</div>
                  <div className="mt-3 text-sm uppercase tracking-wider text-bmo-sub">{game.status}</div>
                </button>
              ))}
            </div>
          </section>

          {activeGame && (
            <div className="fixed inset-0 z-40 bg-black/95 p-2">
              <div className="crt-scan relative h-full w-full rounded-xl border border-bmo-accent/50 bg-black">
                <button
                  type="button"
                  className="absolute right-3 top-3 z-10 rounded-md border border-bmo-line bg-black/60 px-3 py-1 text-sm text-bmo-sub hover:border-bmo-accent"
                  onClick={() => {
                    setActiveGame(null);
                    void playUiTone("ui");
                  }}
                >
                  Exit
                </button>
                <div className="grid h-full place-items-center">
                  <div className="text-center">
                    <div className="pixel-font text-lg text-bmo-accentSoft">{activeGame.title}</div>
                    <p className="mt-3 text-bmo-sub">Game canvas placeholder. Add your arcade game here.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {inChat && (
        <main className="menu-enter mx-auto min-h-screen w-full max-w-7xl p-3 md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              className="rounded-md border border-bmo-line bg-black/45 px-3 py-1 text-sm text-bmo-sub hover:border-bmo-accent"
              onClick={() => {
                setSection("menu");
                void playUiTone("ui");
              }}
            >
              Back
            </button>
            <div className="rounded-full border border-bmo-line bg-black/45 px-3 py-1 text-xs uppercase tracking-wider text-bmo-sub">
              {connected ? "online" : "offline"}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
            <section
              className={`crt-scan rounded-2xl border border-bmo-line bg-bmo-panel/90 p-3 shadow-crt ${
                emotionPulse ? "emotion-pulse" : ""
              } ${bargeFlash ? "barge-flash" : ""}`}
            >
              <div className="relative overflow-hidden rounded-xl border border-bmo-line bg-black/60">
                <img
                  src={faceSrc}
                  alt="BMO face"
                  className={`monitor-face aspect-[4/3] w-full object-cover ${faceMode}`}
                  draggable={false}
                />
                <div className="face-overlay" />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-[11px] uppercase tracking-wider text-bmo-sub">
                {["idle", "listening", "thinking", "speaking"].map((chip) => (
                  <div
                    key={chip}
                    className={`turn-chip rounded-md border border-bmo-line bg-black/45 px-2 py-1 text-center ${
                      turnMode === chip ? "active" : ""
                    }`}
                  >
                    {chip}
                  </div>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-bmo-sub">
                <div className="rounded-md border border-bmo-line bg-black/45 px-2 py-1">
                  emotion: <span style={{ color: statusColor }}>{emotion}</span>
                </div>
                <div className="rounded-md border border-bmo-line bg-black/45 px-2 py-1">
                  intensity: {Math.round(intensity * 100)}%
                </div>
                <div className="rounded-md border border-bmo-line bg-black/45 px-2 py-1">mic: {micState}</div>
                <div className="rounded-md border border-bmo-line bg-black/45 px-2 py-1">
                  latency: {latencyMs ? `${latencyMs}ms` : "-"}
                </div>
              </div>

              <div className="mt-3">
                <WaveMeter mouthAmp={mouthAmp} micLevel={micLevel} faceMode={faceMode} />
                <div className="mt-2 h-2 overflow-hidden rounded bg-bmo-line/40">
                  <div
                    className="h-full bg-gradient-to-r from-bmo-accent to-bmo-accentSoft transition-all duration-75"
                    style={{ width: `${Math.round(clamp(mouthAmp, 0, 1) * 100)}%` }}
                  />
                </div>
              </div>
            </section>

            <section className="crt-scan rounded-2xl border border-bmo-line bg-bmo-panel/90 p-3 shadow-crt">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-bmo-line bg-black/45 p-3">
                  <div className="mb-1 text-xs uppercase tracking-widest text-bmo-sub">Transcript</div>
                  <div className="min-h-14 text-sm text-bmo-text">{transcript || "-"}</div>
                </div>
                <div className="rounded-xl border border-bmo-line bg-black/45 p-3">
                  <div className="mb-1 text-xs uppercase tracking-widest text-bmo-sub">BMO Reply</div>
                  <div className="min-h-14 text-sm text-bmo-text">{assistantText || "-"}</div>
                </div>
              </div>

              <div className="mt-3 grid gap-2 rounded-xl border border-bmo-line bg-black/45 p-3">
                <label className="text-xs uppercase tracking-wider text-bmo-sub" htmlFor="wsUrl">
                  websocket
                </label>
                <input
                  id="wsUrl"
                  className="rounded-md border border-bmo-line bg-black/60 px-3 py-2 text-sm text-bmo-text outline-none focus:border-bmo-accent"
                  value={wsUrl}
                  onChange={(e) => setWsUrl(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <button
                    type="button"
                    disabled={!canConnect}
                    className="rounded-md border border-bmo-line bg-black/55 px-3 py-2 text-sm hover:border-bmo-accent disabled:opacity-40"
                    onClick={connect}
                  >
                    Connect
                  </button>
                  <button
                    type="button"
                    disabled={!canDisconnect}
                    className="rounded-md border border-bmo-line bg-black/55 px-3 py-2 text-sm hover:border-bmo-accent disabled:opacity-40"
                    onClick={disconnect}
                  >
                    Disconnect
                  </button>
                  <button
                    type="button"
                    disabled={!canStartLive}
                    className="rounded-md border border-bmo-line bg-black/55 px-3 py-2 text-sm hover:border-bmo-accent disabled:opacity-40"
                    onClick={startLiveMode}
                  >
                    Start Live
                  </button>
                  <button
                    type="button"
                    disabled={!canStopLive}
                    className="rounded-md border border-bmo-line bg-black/55 px-3 py-2 text-sm hover:border-bmo-accent disabled:opacity-40"
                    onClick={stopLiveMode}
                  >
                    Stop Live
                  </button>
                  <button
                    type="button"
                    disabled={!canStartMic}
                    className="rounded-md border border-bmo-line bg-black/55 px-3 py-2 text-sm hover:border-bmo-accent disabled:opacity-40"
                    onClick={() => maybeResumeLiveListening(true)}
                  >
                    Start Mic
                  </button>
                  <button
                    type="button"
                    disabled={!canStopMic}
                    className="rounded-md border border-bmo-line bg-black/55 px-3 py-2 text-sm hover:border-bmo-accent disabled:opacity-40"
                    onClick={() => stopMic("manual")}
                  >
                    Stop Mic
                  </button>
                  <button
                    type="button"
                    disabled={!connected}
                    className="col-span-2 rounded-md border border-bmo-line bg-black/55 px-3 py-2 text-sm hover:border-bmo-accent disabled:opacity-40"
                    onClick={interruptAssistant}
                  >
                    Interrupt / Barge-in
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-2 rounded-xl border border-bmo-line bg-black/45 p-3">
                <label className="text-xs uppercase tracking-wider text-bmo-sub" htmlFor="textInput">
                  text fallback
                </label>
                <div className="flex gap-2">
                  <input
                    id="textInput"
                    className="flex-1 rounded-md border border-bmo-line bg-black/60 px-3 py-2 text-sm text-bmo-text outline-none focus:border-bmo-accent"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") sendText();
                    }}
                    placeholder="Type a message"
                  />
                  <button
                    type="button"
                    disabled={!connected || !textInput.trim()}
                    className="rounded-md border border-bmo-line bg-black/60 px-4 py-2 text-sm hover:border-bmo-accent disabled:opacity-40"
                    onClick={sendText}
                  >
                    Send
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-bmo-line bg-black/45 p-3">
                <div className="mb-2 text-xs uppercase tracking-widest text-bmo-sub">event log</div>
                <div className="h-40 overflow-auto rounded border border-bmo-line/60 bg-black/70 p-2 font-mono text-xs text-bmo-sub">
                  {logLines.map((line, idx) => (
                    <div key={`${line}-${idx}`}>{line}</div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
