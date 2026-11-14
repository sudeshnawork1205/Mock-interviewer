import type { PersonaId } from '../types/interview';

export interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function scoreVoiceClarity(voice: SpeechSynthesisVoice): number {
  let score = 0;
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();

  if (lang === 'en-us' || lang === 'en-gb') score += 40;
  else if (lang.startsWith('en')) score += 25;

  if (name.includes('natural') || name.includes('neural')) score += 35;
  if (name.includes('online')) score += 20;
  if (name.includes('google')) score += 18;
  if (name.includes('microsoft')) score += 12;
  if (
    name.includes('aria') ||
    name.includes('jenny') ||
    name.includes('guy') ||
    name.includes('samantha') ||
    name.includes('daniel') ||
    name.includes('serena') ||
    name.includes('ava')
  ) {
    score += 10;
  }
  if (name.includes('espeak') || name.includes('compact')) score -= 30;
  if (voice.localService) score += 2;

  return score;
}

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSynthesisSupported()) return [];
  const voices = window.speechSynthesis.getVoices();
  return [...voices].sort((a, b) => {
    const scoreDiff = scoreVoiceClarity(b) - scoreVoiceClarity(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.name.localeCompare(b.name);
  });
}

// Shared AudioContext, WAV buffer cache, and deduplicated in-flight TTS requests
let sharedAudioCtx: AudioContext | null = null;
const ttsAudioCache = new Map<string, ArrayBuffer>();
const inFlightTtsRequests = new Map<string, Promise<ArrayBuffer | null>>();
const MAX_TTS_CACHE_ENTRIES = 36;

let neuralTtsCooldownUntil = 0;
let activePlaybackId = 0;
let activeFetchController: AbortController | null = null;
let activeSourceNode: AudioBufferSourceNode | null = null;
let activeLevelRafId: number | null = null;
let activeAudioLevelCb: ((level: number | null) => void) | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

/** Call inside a user click handler so Web Audio stays unlocked for auto-played prompts. */
export function unlockAudioPlayback(): void {
  const ctx = getSharedAudioContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function cacheTtsBuffer(key: string, buffer: ArrayBuffer): void {
  if (ttsAudioCache.size >= MAX_TTS_CACHE_ENTRIES) {
    const oldestKey = ttsAudioCache.keys().next().value;
    if (oldestKey) ttsAudioCache.delete(oldestKey);
  }
  ttsAudioCache.set(key, buffer);
}

function fetchNeuralTtsBuffer(
  text: string,
  personaId: PersonaId,
  apiKey?: string,
  signal?: AbortSignal
): Promise<ArrayBuffer | null> {
  const cacheKey = `${personaId}:${text}`;
  const cached = ttsAudioCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  if (Date.now() < neuralTtsCooldownUntil) {
    return Promise.resolve(null);
  }

  const existing = inFlightTtsRequests.get(cacheKey);
  if (existing) {
    return existing;
  }

  const requestPromise = (async (): Promise<ArrayBuffer | null> => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey?.trim()) {
        headers['x-gemini-api-key'] = apiKey.trim();
      }

      const res = await fetch('/api/gemini/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text,
          persona: personaId,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status >= 500) {
          neuralTtsCooldownUntil = Date.now() + 30000;
        }
        return null;
      }

      const data = (await res.json()) as { audioBase64?: string };
      if (!data.audioBase64) return null;

      const wavBuffer = base64ToArrayBuffer(data.audioBase64);
      cacheTtsBuffer(cacheKey, wavBuffer);
      return wavBuffer;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      inFlightTtsRequests.delete(cacheKey);
    }
  })();

  inFlightTtsRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

export function prefetchSpeechAudio(
  text: string,
  options: {
    personaId?: PersonaId;
    apiKey?: string;
    demoMode?: boolean;
  } = {}
): void {
  const cleaned = text.trim();
  if (!cleaned || options.demoMode) return;
  void fetchNeuralTtsBuffer(
    cleaned,
    options.personaId ?? 'strict_tech',
    options.apiKey
  );
}

export function stopSpeaking(): void {
  activePlaybackId += 1;

  if (activeFetchController) {
    activeFetchController.abort();
    activeFetchController = null;
  }

  if (activeLevelRafId !== null) {
    cancelAnimationFrame(activeLevelRafId);
    activeLevelRafId = null;
  }

  if (activeSourceNode) {
    try {
      activeSourceNode.onended = null;
      activeSourceNode.stop();
      activeSourceNode.disconnect();
    } catch {
      // ignore AudioBufferSourceNode stop errors
    }
    activeSourceNode = null;
  }

  if (activeAudioLevelCb) {
    activeAudioLevelCb(0);
    activeAudioLevelCb = null;
  }

  if (isSpeechSynthesisSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore speech synthesis cancellation errors
    }
  }
}

export interface SpeakTextOptions {
  voiceURI?: string;
  pitch?: number;
  rate?: number;
  muted?: boolean;
  personaId?: PersonaId;
  apiKey?: string;
  demoMode?: boolean;
  onStart?: () => void;
  onBoundaryChar?: (charIndex: number) => void;
  onAudioLevel?: (level: number | null) => void;
  onEnd?: () => void;
}

function speakWithBrowserSynthesis(
  text: string,
  options: SpeakTextOptions,
  playbackId: number
): void {
  if (playbackId !== activePlaybackId) return;

  if (!isSpeechSynthesisSupported()) {
    options.onAudioLevel?.(0);
    options.onEnd?.();
    return;
  }

  // Signal avatar to use boundary-driven cadence when using browser speechSynthesis
  options.onAudioLevel?.(null);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.pitch = 1.0;
  utterance.rate = Math.min(1.08, Math.max(0.92, options.rate ?? 1.0));

  const sortedVoices = getAvailableVoices();
  if (options.voiceURI) {
    const exact = sortedVoices.find((v) => v.voiceURI === options.voiceURI);
    if (exact) {
      utterance.voice = exact;
    } else if (sortedVoices[0]) {
      utterance.voice = sortedVoices[0];
    }
  } else if (sortedVoices[0]) {
    utterance.voice = sortedVoices[0];
  }

  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      if (playbackId === activePlaybackId) {
        options.onAudioLevel?.(0);
      }
      options.onEnd?.();
    }
  };

  utterance.onstart = () => {
    if (playbackId === activePlaybackId) {
      options.onStart?.();
    }
  };
  utterance.onboundary = (event) => {
    if (playbackId === activePlaybackId && typeof event.charIndex === 'number') {
      options.onBoundaryChar?.(event.charIndex);
    }
  };
  utterance.onend = finish;
  utterance.onerror = finish;

  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    finish();
  }
}

async function fetchAndPlayNeuralTts(
  text: string,
  options: SpeakTextOptions,
  playbackId: number
): Promise<boolean> {
  const audioCtx = getSharedAudioContext();
  if (!audioCtx) return false;

  const controller = new AbortController();
  activeFetchController = controller;

  const rawWavBuffer = await fetchNeuralTtsBuffer(
    text,
    options.personaId ?? 'strict_tech',
    options.apiKey,
    controller.signal
  );

  if (activeFetchController === controller) {
    activeFetchController = null;
  }

  if (playbackId !== activePlaybackId) return true;
  if (!rawWavBuffer) return false;

  try {
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    if (audioCtx.state !== 'running') {
      return false;
    }

    const decoded = await audioCtx.decodeAudioData(rawWavBuffer.slice(0));
    if (playbackId !== activePlaybackId) return true;

    const source = audioCtx.createBufferSource();
    source.buffer = decoded;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.65;

    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    activeSourceNode = source;
    activeAudioLevelCb = options.onAudioLevel ?? null;

    const timeData = new Uint8Array(analyser.frequencyBinCount);
    const totalDuration = Math.max(0.4, decoded.duration);
    const startedAt = audioCtx.currentTime;
    let smoothedLevel = 0;
    let lastBoundaryEmit = 0;
    let lastBoundaryChar = -1;

    options.onStart?.();
    options.onBoundaryChar?.(0);

    const tick = (now: number) => {
      if (playbackId !== activePlaybackId || activeSourceNode !== source) return;

      analyser.getByteTimeDomainData(timeData);
      let sumSquares = 0;
      for (let i = 0; i < timeData.length; i++) {
        const norm = (timeData[i] - 128) / 128;
        sumSquares += norm * norm;
      }
      const rms = Math.sqrt(sumSquares / timeData.length);
      const scaled = Math.min(1, Math.max(0, (rms - 0.008) * 5.8));
      smoothedLevel = smoothedLevel * 0.48 + scaled * 0.52;
      options.onAudioLevel?.(Number(smoothedLevel.toFixed(2)));

      if (now - lastBoundaryEmit >= 90) {
        lastBoundaryEmit = now;
        const progress = Math.min(
          1,
          Math.max(0, (audioCtx.currentTime - startedAt) / totalDuration)
        );
        const charIndex = Math.min(
          text.length,
          Math.floor(progress * text.length)
        );
        if (charIndex !== lastBoundaryChar) {
          lastBoundaryChar = charIndex;
          options.onBoundaryChar?.(charIndex);
        }
      }

      activeLevelRafId = requestAnimationFrame(tick);
    };

    source.onended = () => {
      if (activeSourceNode === source) {
        activeSourceNode = null;
      }
      if (activeLevelRafId !== null) {
        cancelAnimationFrame(activeLevelRafId);
        activeLevelRafId = null;
      }
      if (playbackId === activePlaybackId) {
        options.onAudioLevel?.(0);
        activeAudioLevelCb = null;
        options.onEnd?.();
      }
    };

    source.start(0);
    activeLevelRafId = requestAnimationFrame(tick);
    return true;
  } catch {
    return false;
  }
}

export function speakText(
  text: string,
  options: SpeakTextOptions = {}
): void {
  const cleaned = text.trim();
  if (options.muted || !cleaned) {
    options.onAudioLevel?.(0);
    options.onEnd?.();
    return;
  }

  stopSpeaking();
  const playbackId = activePlaybackId;

  if (options.demoMode) {
    speakWithBrowserSynthesis(cleaned, options, playbackId);
    return;
  }

  void fetchAndPlayNeuralTts(cleaned, options, playbackId).then((played) => {
    if (!played && playbackId === activePlaybackId) {
      speakWithBrowserSynthesis(cleaned, options, playbackId);
    }
  });
}

export async function startMicAudioMonitor(
  onVolumeLevel: (level: number) => void
): Promise<() => void> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof AudioContext === 'undefined'
  ) {
    return () => {};
  }

  let stopped = false;
  let rafId: number | null = null;
  let audioCtx: AudioContext | null = null;
  let stream: MediaStream | null = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return () => {};
    }

    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let smoothed = 0;
    let lastEmitAt = 0;
    let lastEmittedValue = -1;

    const tick = (now: number) => {
      if (stopped) return;
      analyser.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      const scaled = Math.min(1, Math.max(0, (rms - 0.012) * 5.2));
      smoothed = smoothed * 0.55 + scaled * 0.45;
      const rounded = Number(smoothed.toFixed(2));

      if (
        now - lastEmitAt >= 80 &&
        Math.abs(rounded - lastEmittedValue) >= 0.03
      ) {
        lastEmitAt = now;
        lastEmittedValue = rounded;
        onVolumeLevel(rounded);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  } catch {
    onVolumeLevel(0);
  }

  return () => {
    stopped = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    if (audioCtx && audioCtx.state !== 'closed') {
      void audioCtx.close().catch(() => {});
    }
    onVolumeLevel(0);
  };
}
