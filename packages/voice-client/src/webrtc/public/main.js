const WS_URL = `ws://${location.host}/ws`;
const VAD_THRESHOLD = 0.01;
const VAD_ON_FRAMES = 3;
const VAD_OFF_FRAMES = 10;
const CARTESIA_SAMPLE_RATE = 44100;
const MIC_SAMPLE_RATE = 16000;

let ws = null;
let audioCtx = null;
let mediaStream = null;
let workletNode = null;
let isSpeaking = false;
let vadOnCount = 0;
let vadOffCount = 0;
let ttsNode = null;
let isTtsPlaying = false;
let ttsQueue = [];
const logBuffer = [];

const statusPill = document.getElementById("status");
const levelBar = document.getElementById("level-bar");
const vadIndicator = document.getElementById("vad-indicator");
const logArea = document.getElementById("log-area");

function appendLog(msg) {
  logBuffer.push(msg);
  if (logBuffer.length > 10) logBuffer.shift();
  logArea.textContent = logBuffer.join("\n");
}

function setStatus(state) {
  statusPill.textContent = state;
  statusPill.dataset.state = state;
}

function setVadState(speaking) {
  isSpeaking = speaking;
  vadIndicator.textContent = speaking ? "VAD ACTIVE" : "VAD IDLE";
  vadIndicator.dataset.active = speaking ? "1" : "0";
}

function rms(f32) {
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  return Math.sqrt(sum / f32.length);
}

function float32ToInt16(f32) {
  const s16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    s16[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return s16;
}

function downsampleTo16k(f32, fromRate) {
  if (fromRate === MIC_SAMPLE_RATE) return f32;
  const ratio = fromRate / MIC_SAMPLE_RATE;
  const outLen = Math.floor(f32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = f32[Math.floor(i * ratio)];
  return out;
}

function updateVad(level) {
  const pct = Math.min(100, level * 1000);
  levelBar.style.width = pct + "%";

  if (level > VAD_THRESHOLD) {
    vadOnCount++;
    vadOffCount = 0;
  } else {
    vadOffCount++;
    vadOnCount = 0;
  }

  if (!isSpeaking && vadOnCount >= VAD_ON_FRAMES) {
    setVadState(true);
    return true;
  }
  if (isSpeaking && vadOffCount >= VAD_OFF_FRAMES) {
    setVadState(false);
  }
  return false;
}

function bargeIn() {
  if (!isTtsPlaying) return;
  if (ttsNode) {
    try {
      ttsNode.stop();
    } catch (_) {
      appendLog("[barge-in] playback already stopped");
    }
    ttsNode = null;
  }
  ttsQueue = [];
  isTtsPlaying = false;
  appendLog("[barge-in] TTS playback cut");
  document.dispatchEvent(new CustomEvent("bargein"));
}

function playNextQueued() {
  if (ttsQueue.length === 0) return;
  const next = ttsQueue.shift();
  playTtsChunk(next);
}

function playTtsChunk(arrayBuf) {
  if (!audioCtx) return;
  const f32 = new Float32Array(arrayBuf);
  const samples = f32.length;
  if (samples === 0) return;
  const audioBuf = audioCtx.createBuffer(1, samples, CARTESIA_SAMPLE_RATE);
  audioBuf.getChannelData(0).set(f32);
  const src = audioCtx.createBufferSource();
  src.buffer = audioBuf;
  src.connect(audioCtx.destination);
  ttsNode = src;
  isTtsPlaying = true;
  src.onended = () => {
    if (ttsNode === src) {
      ttsNode = null;
      isTtsPlaying = false;
    }
    playNextQueued();
  };
  src.start();
  appendLog(`[tts] playing ${samples} samples`);
}

async function startMic() {
  try {
    audioCtx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: MIC_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    await audioCtx.audioWorklet.addModule("/public/vad-worklet.js");
    workletNode = new AudioWorkletNode(audioCtx, "vad-worklet");

    const source = audioCtx.createMediaStreamSource(mediaStream);
    const sink = audioCtx.createGain();
    sink.gain.value = 0;
    source.connect(workletNode);
    workletNode.connect(sink);
    sink.connect(audioCtx.destination);

    workletNode.port.onmessage = (evt) => {
      const f32 = evt.data;
      const level = rms(f32);
      const justBecameSpeaking = updateVad(level);
      if (justBecameSpeaking && isTtsPlaying) bargeIn();
      if (ws?.readyState === WebSocket.OPEN) {
        const downsampled = downsampleTo16k(f32, audioCtx.sampleRate);
        const s16 = float32ToInt16(downsampled);
        ws.send(s16.buffer);
      }
    };

    appendLog("[mic] started");
    setStatus("live");
  } catch (err) {
    appendLog("[mic] error: " + err.message);
    setStatus("mic-error");
  }
}

function stopMic() {
  workletNode?.disconnect();
  mediaStream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  workletNode = null;
  mediaStream = null;
  audioCtx = null;
}

function init() {
  setStatus("connecting");
  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    setStatus("connected");
    appendLog("[ws] connected");
    startMic();
  };

  ws.onclose = () => {
    setStatus("disconnected");
    appendLog("[ws] disconnected");
    stopMic();
  };

  ws.onerror = () => {
    setStatus("error");
    appendLog("[ws] error");
  };

  ws.onmessage = (evt) => {
    if (!(evt.data instanceof ArrayBuffer)) return;
    appendLog(`[tts] received ${evt.data.byteLength} bytes`);
    if (isTtsPlaying) {
      ttsQueue.push(evt.data);
    } else {
      playTtsChunk(evt.data);
    }
  };
}

init();
