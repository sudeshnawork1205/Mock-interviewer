import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Mic,
  Play,
  ShieldCheck,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import {
  PERSONAS,
  type ExperienceLevel,
  type InterviewMode,
  type InterviewSessionResult,
  type InterviewSetupConfig,
  type PersonaId,
  type QuestionVolume,
  type RoleOption,
} from '../types/interview';
import { parseJobDescriptionText, parseResumeFile } from '../services/pdfParser';
import {
  getAvailableVoices,
  getSpeechRecognitionConstructor,
  isSpeechRecognitionSupported,
  type SpeechRecognitionInstance,
} from '../services/speechService';
import { evaluateVisionFrame, getFaceLandmarker } from '../services/visionCoach';
import { PersonaAvatar } from './PersonaAvatar';

const ROLE_OPTIONS: RoleOption[] = [
  'Software Engineer',
  'Product Manager',
  'Data Analyst',
  'QA Engineer',
  'UI/UX Designer',
  'HR',
  'Sales',
  'Marketing',
  'Other',
];

const EXPERIENCE_LEVELS: ExperienceLevel[] = ['Fresher', 'Mid-level', 'Senior'];
const INTERVIEW_MODES: InterviewMode[] = ['Technical', 'Behavioral', 'Mixed'];
const QUESTION_VOLUMES: QuestionVolume[] = [3, 5, 7];

interface SetupScreenProps {
  config: InterviewSetupConfig;
  hasServerKey: boolean;
  isStarting: boolean;
  startError: string | null;
  history: InterviewSessionResult[];
  onChangeConfig: (updater: (prev: InterviewSetupConfig) => InterviewSetupConfig) => void;
  onStartInterview: () => void;
  onOpenHistorySession: (session: InterviewSessionResult) => void;
  onClearHistory: () => void;
}

export function SetupScreen({
  config,
  hasServerKey,
  isStarting,
  startError,
  history,
  onChangeConfig,
  onStartInterview,
  onOpenHistorySession,
  onClearHistory,
}: SetupScreenProps) {
  const [personalizationOpen, setPersonalizationOpen] = useState(
    Boolean(config.resume || config.jd.rawText)
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [resumeParsing, setResumeParsing] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Mini live webcam preview pill when Webcam Coach is enabled
  const [miniPreviewActive, setMiniPreviewActive] = useState(false);
  const miniPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const miniPreviewStreamRef = useRef<MediaStream | null>(null);

  // Pre-flight mic & camera test state
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [micTesting, setMicTesting] = useState(false);
  const [micTranscript, setMicTranscript] = useState('');
  const [micStatus, setMicStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [micError, setMicError] = useState<string | null>(null);

  const [camTesting, setCamTesting] = useState(false);
  const [faceDetectedOk, setFaceDetectedOk] = useState<boolean | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const preflightVideoRef = useRef<HTMLVideoElement | null>(null);
  const preflightStreamRef = useRef<MediaStream | null>(null);
  const preflightRafRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    const syncVoices = () => {
      const list = getAvailableVoices();
      setVoices(list);
      if (!config.selectedVoiceURI && list.length > 0) {
        const defaultEn =
          list.find((v) => v.lang.startsWith('en') && v.default) ??
          list.find((v) => v.lang.startsWith('en')) ??
          list[0];
        if (defaultEn) {
          onChangeConfig((prev) => ({
            ...prev,
            selectedVoiceURI: defaultEn.voiceURI,
          }));
        }
      }
    };

    syncVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = syncVoices;
    }
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [config.selectedVoiceURI, onChangeConfig]);

  const stopMiniPreview = () => {
    if (miniPreviewStreamRef.current) {
      miniPreviewStreamRef.current.getTracks().forEach((t) => t.stop());
      miniPreviewStreamRef.current = null;
    }
    setMiniPreviewActive(false);
  };

  const toggleMiniPreview = async () => {
    if (miniPreviewActive) {
      stopMiniPreview();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
      });
      miniPreviewStreamRef.current = stream;
      setMiniPreviewActive(true);
      requestAnimationFrame(() => {
        if (miniPreviewVideoRef.current) {
          miniPreviewVideoRef.current.srcObject = stream;
          void miniPreviewVideoRef.current.play();
        }
      });
    } catch {
      setMiniPreviewActive(false);
    }
  };

  useEffect(() => {
    if (!config.webcamCoachEnabled) {
      stopMiniPreview();
    }
  }, [config.webcamCoachEnabled]);

  useEffect(() => {
    return () => {
      stopPreflightChecks();
      stopMiniPreview();
    };
  }, []);

  const stopPreflightChecks = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (preflightRafRef.current !== null) {
      cancelAnimationFrame(preflightRafRef.current);
      preflightRafRef.current = null;
    }
    if (preflightStreamRef.current) {
      preflightStreamRef.current.getTracks().forEach((t) => t.stop());
      preflightStreamRef.current = null;
    }
    setMicTesting(false);
    setCamTesting(false);
  };

  const handleResumeUpload = async (file: File) => {
    setResumeParsing(true);
    setResumeError(null);
    try {
      const parsed = await parseResumeFile(file);
      onChangeConfig((prev) => ({ ...prev, resume: parsed }));
      setPersonalizationOpen(true);
    } catch (err) {
      setResumeError(
        err instanceof Error ? err.message : 'Unable to extract text from resume.'
      );
    } finally {
      setResumeParsing(false);
    }
  };

  const handleMicTest = async () => {
    setMicError(null);
    if (!isSpeechRecognitionSupported()) {
      setMicStatus('error');
      setMicError('Web Speech API is unavailable in this browser. You can still type answers.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setMicStatus('error');
      setMicError('Microphone permission denied. Allow mic access in browser settings.');
      return;
    }

    const RecognitionCtor = getSpeechRecognitionConstructor();
    if (!RecognitionCtor) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }

    const rec = new RecognitionCtor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    setMicTesting(true);
    setMicTranscript('');
    setMicStatus('idle');

    rec.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript + ' ';
      }
      const trimmed = text.trim();
      setMicTranscript(trimmed);
      if (trimmed.length >= 2) {
        setMicStatus('ok');
      }
    };

    rec.onerror = (event) => {
      if (event.error !== 'aborted') {
        setMicStatus('error');
        setMicError(`Speech recognition error: ${event.error}`);
      }
      setMicTesting(false);
    };

    rec.onend = () => {
      setMicTesting(false);
    };

    recognitionRef.current = rec;
    rec.start();
  };

  const handleCamTest = async () => {
    setCamError(null);
    setFaceDetectedOk(null);
    setCamTesting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      preflightStreamRef.current = stream;

      if (preflightVideoRef.current) {
        preflightVideoRef.current.srcObject = stream;
        await preflightVideoRef.current.play();
      }

      const landmarker = await getFaceLandmarker();
      let lastCheck = 0;

      const loop = (now: number) => {
        if (!preflightStreamRef.current || !preflightVideoRef.current) return;
        if (
          now - lastCheck >= 220 &&
          preflightVideoRef.current.readyState >= 2
        ) {
          lastCheck = now;
          const sample = evaluateVisionFrame(
            landmarker,
            preflightVideoRef.current,
            performance.now()
          );
          setFaceDetectedOk(sample.faceDetected);
        }
        preflightRafRef.current = requestAnimationFrame(loop);
      };

      preflightRafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setCamTesting(false);
      setCamError(
        err instanceof Error
          ? err.message
          : 'Unable to access webcam or load MediaPipe FaceLandmarker.'
      );
    }
  };

  const canStart =
    (config.role !== 'Other' || config.customRole.trim().length > 0) &&
    (config.demoMode || config.apiKey.trim().length > 0 || hasServerKey);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="mb-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
            Configure your mock interview
          </h1>
          <p className="mt-2 text-base text-slate-600 leading-relaxed">
            Choose a live interviewer persona, attach your resume and target job description,
            and run a private mic &amp; vision pre-flight check before starting.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (preflightOpen) {
              stopPreflightChecks();
              setPreflightOpen(false);
            } else {
              setPreflightOpen(true);
            }
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          {preflightOpen ? 'Close Pre-flight Check' : 'Run Mic & Camera Check'}
        </button>
      </div>

      {/* Pre-flight Check Drawer */}
      {preflightOpen && (
        <section
          aria-label="Microphone and Camera Pre-flight Check"
          className="mb-8 bg-white border border-slate-200 rounded-xl p-6"
        >
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Hardware &amp; MediaPipe Pre-flight Check
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Verify voice transcription and client-side face tracking locally in your browser.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                stopPreflightChecks();
                setPreflightOpen(false);
              }}
              className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="Close pre-flight check"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-5">
            {/* Mic test */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-slate-700" />
                  <span className="text-sm font-semibold text-slate-900">
                    Microphone &amp; Speech Test
                  </span>
                </div>
                <button
                  type="button"
                  onClick={micTesting ? stopPreflightChecks : handleMicTest}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    micTesting
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {micTesting ? 'Stop Listening' : 'Say "Hello" Test'}
                </button>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 min-h-[76px] text-sm">
                {micError ? (
                  <p className="text-red-600 text-xs">{micError}</p>
                ) : micTranscript ? (
                  <div className="space-y-1">
                    <p className="text-slate-800">{micTranscript}</p>
                    {micStatus === 'ok' && (
                      <p className="text-xs font-medium text-emerald-700 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Speech recognition active
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs">
                    {micTesting
                      ? 'Listening... say "Hello, testing my microphone."'
                      : 'Click the test button and speak a short phrase to confirm live transcription.'}
                  </p>
                )}
              </div>
            </div>

            {/* Camera test */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-slate-700" />
                  <span className="text-sm font-semibold text-slate-900">
                    Webcam &amp; FaceLandmarker Test
                  </span>
                </div>
                <button
                  type="button"
                  onClick={camTesting ? stopPreflightChecks : handleCamTest}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    camTesting
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {camTesting ? 'Stop Camera' : 'Test Face Detection'}
                </button>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-lg bg-slate-50 border border-slate-200 min-h-[76px]">
                <div className="w-24 h-16 rounded-md bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center">
                  <video
                    ref={preflightVideoRef}
                    muted
                    playsInline
                    className={`w-full h-full object-cover -scale-x-100 ${
                      camTesting ? 'block' : 'hidden'
                    }`}
                  />
                  {!camTesting && (
                    <Camera className="w-5 h-5 text-slate-500" />
                  )}
                </div>
                <div className="text-xs space-y-1">
                  {camError ? (
                    <p className="text-red-600">{camError}</p>
                  ) : camTesting ? (
                    faceDetectedOk ? (
                      <p className="text-emerald-700 font-medium inline-flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        Face detected ✓ (MediaPipe active)
                      </p>
                    ) : (
                      <p className="text-amber-700 font-medium">
                        Center your face in the frame...
                      </p>
                    )
                  ) : (
                    <p className="text-slate-500">
                      Video stays 100% on-device. Click to verify MediaPipe FaceLandmarker.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Primary Configuration Column */}
        <div className="lg:col-span-8 space-y-6">
          {/* Core Parameters */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                01. Role &amp; Session Scope
              </h2>
              <span className="text-xs text-slate-500 tabular-nums">
                {config.questionCount} questions · {config.mode}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label
                  htmlFor="role-select"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Target Role
                </label>
                <select
                  id="role-select"
                  value={config.role}
                  onChange={(e) =>
                    onChangeConfig((prev) => ({
                      ...prev,
                      role: e.target.value as RoleOption,
                    }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {config.role === 'Other' ? (
                <div>
                  <label
                    htmlFor="custom-role-input"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    Specify Role Title
                  </label>
                  <input
                    id="custom-role-input"
                    type="text"
                    value={config.customRole}
                    onChange={(e) =>
                      onChangeConfig((prev) => ({
                        ...prev,
                        customRole: e.target.value,
                      }))
                    }
                    placeholder="e.g., Solutions Architect"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              ) : (
                <div>
                  <span className="block text-sm font-medium text-slate-700 mb-1.5">
                    Experience Tier
                  </span>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                    {EXPERIENCE_LEVELS.map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() =>
                          onChangeConfig((prev) => ({ ...prev, level: lvl }))
                        }
                        className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          config.level === lvl
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {config.role === 'Other' && (
              <div>
                <span className="block text-sm font-medium text-slate-700 mb-1.5">
                  Experience Tier
                </span>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg max-w-md">
                  {EXPERIENCE_LEVELS.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() =>
                        onChangeConfig((prev) => ({ ...prev, level: lvl }))
                      }
                      className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        config.level === lvl
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <span className="block text-sm font-medium text-slate-700 mb-1.5">
                  Interview Mode
                </span>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                  {INTERVIEW_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        onChangeConfig((prev) => ({ ...prev, mode: m }))
                      }
                      className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        config.mode === m
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-sm font-medium text-slate-700 mb-1.5">
                  Question Volume
                </span>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                  {QUESTION_VOLUMES.map((vol) => (
                    <button
                      key={vol}
                      type="button"
                      onClick={() =>
                        onChangeConfig((prev) => ({
                          ...prev,
                          questionCount: vol,
                        }))
                      }
                      className={`py-2 px-2 text-xs font-medium rounded-md transition-colors tabular-nums whitespace-nowrap cursor-pointer ${
                        config.questionCount === vol
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {vol} Questions
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Interviewer Persona */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                02. Interviewer Persona
              </h2>
              <span className="text-xs text-slate-500">
                Live video-call portrait, rigor &amp; speech pacing
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(Object.keys(PERSONAS) as PersonaId[]).map((pid) => {
                const p = PERSONAS[pid];
                const selected = config.persona === pid;
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() =>
                      onChangeConfig((prev) => ({ ...prev, persona: pid }))
                    }
                    className={`text-left p-4 rounded-xl border transition-all cursor-pointer flex flex-col gap-3 ${
                      selected
                        ? 'border-blue-600 bg-blue-50/40 ring-1 ring-blue-600'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <PersonaAvatar personaId={pid} size="sm" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {p.name} · {p.title}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {p.difficultyBand}
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {p.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Collapsible Personalization Panel (Resume PDF + JD) */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setPersonalizationOpen((v) => !v)}
              className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors cursor-pointer"
              aria-expanded={personalizationOpen}
            >
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  03. Resume &amp; Job Description Personalization
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {config.resume
                    ? `Resume loaded (${config.resume.wordCount} words · ${config.resume.skills.length} skills)`
                    : 'Optional · Upload PDF/TXT resume & paste JD for >=40% tailored questions'}
                </p>
              </div>
              {personalizationOpen ? (
                <ChevronUp className="w-5 h-5 text-slate-500 shrink-0" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-500 shrink-0" />
              )}
            </button>

            {personalizationOpen && (
              <div className="px-6 pb-6 pt-2 border-t border-slate-100 space-y-6">
                {/* Resume dropzone */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">
                      Candidate Resume (PDF or TXT)
                    </label>
                    {config.resume && (
                      <button
                        type="button"
                        onClick={() =>
                          onChangeConfig((prev) => ({ ...prev, resume: null }))
                        }
                        className="text-xs text-red-600 hover:underline cursor-pointer"
                      >
                        Remove resume
                      </button>
                    )}
                  </div>

                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const dropped = e.dataTransfer.files?.[0];
                      if (dropped) void handleResumeUpload(dropped);
                    }}
                    className={`border border-dashed rounded-xl p-5 text-center transition-colors ${
                      isDragging
                        ? 'border-blue-600 bg-blue-50/50'
                        : 'border-slate-300 bg-slate-50/50'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt,.md,application/pdf,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleResumeUpload(file);
                      }}
                    />

                    {resumeParsing ? (
                      <p className="text-sm text-slate-600">
                        Extracting text and skills via PDF.js worker...
                      </p>
                    ) : config.resume ? (
                      <div className="text-left space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                            <span className="truncate">{config.resume.fileName}</span>
                          </div>
                          <span className="text-xs font-mono text-slate-500 tabular-nums shrink-0">
                            {config.resume.wordCount} words
                          </span>
                        </div>
                        {config.resume.skills.length > 0 && (
                          <p className="text-xs text-slate-600">
                            <span className="font-medium text-slate-800">
                              Detected skills:{' '}
                            </span>
                            {config.resume.skills.join(' · ')}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Upload className="w-5 h-5 text-slate-400 mx-auto" />
                        <p className="text-sm text-slate-600">
                          Drag and drop your PDF resume here, or{' '}
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="text-blue-600 font-medium hover:underline cursor-pointer"
                          >
                            browse file
                          </button>
                        </p>
                        <p className="text-xs text-slate-500">
                          Parsed strictly in-browser using PDF.js. Nothing is stored externally.
                        </p>
                      </div>
                    )}
                  </div>
                  {resumeError && (
                    <p className="mt-2 text-xs text-red-600">{resumeError}</p>
                  )}
                </div>

                {/* Job description */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="jd-textarea"
                      className="text-sm font-medium text-slate-700"
                    >
                      Target Job Description
                    </label>
                    {(config.jd.targetTitle || config.jd.companyName) && (
                      <span className="text-xs text-slate-500">
                        {[config.jd.targetTitle, config.jd.companyName]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </div>
                  <textarea
                    id="jd-textarea"
                    rows={4}
                    value={config.jd.rawText}
                    onChange={(e) => {
                      const parsed = parseJobDescriptionText(e.target.value);
                      onChangeConfig((prev) => ({ ...prev, jd: parsed }));
                    }}
                    placeholder="Paste job posting responsibilities, required skills, and company details..."
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {config.jd.extractedSkills.length > 0 && (
                    <p className="mt-1.5 text-xs text-slate-600">
                      <span className="font-medium text-slate-800">
                        Extracted JD requirements:{' '}
                      </span>
                      {config.jd.extractedSkills.join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Recent Practice History */}
          {history.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
                  <Clock className="w-4 h-4 text-slate-500" />
                  Recent Practice Sessions
                </div>
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear history
                </button>
              </div>

              <div className="divide-y divide-slate-100">
                {history.slice(0, 4).map((item, idx) => (
                  <div
                    key={`${item.completedAt}-${idx}`}
                    className="py-3 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {item.effectiveRole} · {item.config.level}
                      </div>
                      <div className="text-xs text-slate-500">
                        {PERSONAS[item.config.persona].name} · {item.summary.verdict} ·{' '}
                        {new Date(item.completedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-bold font-mono tabular-nums text-slate-900">
                        {item.overallScore}/100
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenHistorySession(item)}
                        className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer"
                      >
                        View Report
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Controls & Launch Column */}
        <aside className="lg:col-span-4 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <h2 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-3">
              Engine &amp; Coaching Controls
            </h2>

            {/* Follow-up toggle */}
            <label className="flex items-start justify-between gap-4 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-slate-900">
                  Adaptive Follow-ups
                </div>
                <div className="text-xs text-slate-500">
                  Probes vague answers (max 1 follow-up per prompt)
                </div>
              </div>
              <input
                type="checkbox"
                checked={config.followUpsEnabled}
                onChange={(e) =>
                  onChangeConfig((prev) => ({
                    ...prev,
                    followUpsEnabled: e.target.checked,
                  }))
                }
                className="mt-1 h-4 w-4 accent-blue-600 rounded cursor-pointer"
              />
            </label>

            {/* Webcam Coach toggle + live preview option */}
            <div className="space-y-2.5">
              <label className="flex items-start justify-between gap-4 cursor-pointer">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Webcam Vision Coach
                  </div>
                  <div className="text-xs text-slate-500">
                    Tracks eye contact (±15°), smile &amp; head stability locally
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={config.webcamCoachEnabled}
                  onChange={(e) =>
                    onChangeConfig((prev) => ({
                      ...prev,
                      webcamCoachEnabled: e.target.checked,
                    }))
                  }
                  className="mt-1 h-4 w-4 accent-blue-600 rounded cursor-pointer"
                />
              </label>

              {config.webcamCoachEnabled && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-600">
                      100% private browser camera processing
                    </span>
                    <button
                      type="button"
                      onClick={() => void toggleMiniPreview()}
                      className="text-[11px] font-medium text-blue-600 hover:underline cursor-pointer"
                    >
                      {miniPreviewActive ? 'Hide preview' : 'Preview camera'}
                    </button>
                  </div>
                  {miniPreviewActive && (
                    <div className="aspect-[16/9] w-full rounded-md bg-slate-900 overflow-hidden">
                      <video
                        ref={miniPreviewVideoRef}
                        muted
                        playsInline
                        className="w-full h-full object-cover -scale-x-100"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Voice selector */}
            <div>
              <label
                htmlFor="voice-select"
                className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5"
              >
                <Volume2 className="w-4 h-4 text-slate-500" />
                Fallback Browser Voice
              </label>
              <select
                id="voice-select"
                value={config.selectedVoiceURI}
                onChange={(e) =>
                  onChangeConfig((prev) => ({
                    ...prev,
                    selectedVoiceURI: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {voices.length === 0 ? (
                  <option value="">Auto-Select Clearest Voice</option>
                ) : (
                  voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))
                )}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                Uses Gemini HD studio voices in Live mode; falls back here in Demo Mode.
              </p>
            </div>

            <hr className="border-slate-100" />

            {/* Demo Mode Toggle */}
            <label className="flex items-start justify-between gap-4 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-slate-900">
                  Demo Mode (Offline Engine)
                </div>
                <div className="text-xs text-slate-500">
                  Run full scoring, follow-ups &amp; analytics without an API key
                </div>
              </div>
              <input
                type="checkbox"
                checked={config.demoMode}
                onChange={(e) =>
                  onChangeConfig((prev) => ({
                    ...prev,
                    demoMode: e.target.checked,
                  }))
                }
                className="mt-1 h-4 w-4 accent-blue-600 rounded cursor-pointer"
              />
            </label>

            {/* API Key Manager */}
            <div className={config.demoMode ? 'opacity-50' : ''}>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="gemini-api-key"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700"
                >
                  <KeyRound className="w-4 h-4 text-slate-500" />
                  Gemini API Key
                </label>
                {hasServerKey && !config.apiKey.trim() && (
                  <span className="text-xs text-emerald-700 font-medium">
                    Environment key ready
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  id="gemini-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  disabled={config.demoMode}
                  value={config.apiKey}
                  onChange={(e) =>
                    onChangeConfig((prev) => ({
                      ...prev,
                      apiKey: e.target.value,
                    }))
                  }
                  placeholder={
                    hasServerKey
                      ? 'Optional (server key configured)'
                      : 'AIza... (stored in localStorage)'
                  }
                  className="w-full pr-10 pl-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={config.demoMode}
                  checked={config.rememberApiKey}
                  onChange={(e) =>
                    onChangeConfig((prev) => ({
                      ...prev,
                      rememberApiKey: e.target.checked,
                    }))
                  }
                  className="h-3.5 w-3.5 accent-blue-600 rounded cursor-pointer"
                />
                Remember key in this browser (localStorage)
              </label>
            </div>

            {startError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 space-y-2"
              >
                <p>{startError}</p>
                <button
                  type="button"
                  onClick={() =>
                    onChangeConfig((prev) => ({ ...prev, demoMode: true }))
                  }
                  className="font-semibold underline cursor-pointer"
                >
                  Switch to Demo Mode instead
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={!canStart || isStarting}
              onClick={() => {
                stopPreflightChecks();
                stopMiniPreview();
                onStartInterview();
              }}
              className="w-full py-3 px-5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              {isStarting
                ? 'Generating Interview...'
                : config.demoMode
                ? 'Start Interview (Demo Mode)'
                : 'Start Live Interview'}
            </button>

            {!canStart && (
              <p className="text-xs text-amber-700">
                Enter a Gemini API key or toggle Demo Mode above to begin.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
