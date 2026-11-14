import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Camera,
  CameraOff,
  CheckCircle2,
  Eye,
  Flag,
  Mic,
  MicOff,
  RefreshCw,
  RotateCcw,
  Send,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  analyzeFillerWords,
  computeCompositeScore,
  countWords,
  PERSONAS,
  type CallBResponse,
  type EyeContactState,
  type InterviewQuestion,
  type InterviewSetupConfig,
  type QuestionAttempt,
  type QuestionVisionSummary,
  type VisionFrameSample,
} from '../types/interview';
import { createZeroEvaluation } from '../services/demoEngine';
import { evaluateCandidateAnswer } from '../services/geminiClient';
import {
  getSpeechRecognitionConstructor,
  isSpeechRecognitionSupported,
  prefetchSpeechAudio,
  speakText,
  startMicAudioMonitor,
  stopSpeaking,
  unlockAudioPlayback,
  type SpeechRecognitionInstance,
} from '../services/speechService';
import {
  computeHeadStability,
  evaluateVisionFrame,
  getFaceLandmarker,
  summarizeQuestionVision,
} from '../services/visionCoach';
import { DigitalHumanAvatar } from './DigitalHumanAvatar';

type QuestionPhase =
  | 'answering'
  | 'evaluating'
  | 'follow_up_answering'
  | 'feedback'
  | 'error'
  | 'finishing';

interface LiveInterviewScreenProps {
  config: InterviewSetupConfig;
  questions: InterviewQuestion[];
  jdSkills: string[];
  onCompleteSession: (
    attempts: QuestionAttempt[],
    usedFallbackCount: number
  ) => void;
  onAbortToSetup: () => void;
}

export function LiveInterviewScreen({
  config,
  questions,
  jdSkills,
  onCompleteSession,
  onAbortToSetup,
}: LiveInterviewScreenProps) {
  const persona = PERSONAS[config.persona];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<QuestionPhase>('answering');
  const [attempts, setAttempts] = useState<QuestionAttempt[]>([]);
  const [fallbackCount, setFallbackCount] = useState(0);

  // Answer state
  const [answerText, setAnswerText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [voiceWordCount, setVoiceWordCount] = useState(0);
  const [typedWordCount, setTypedWordCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Follow-up state
  const [primaryAnswerSaved, setPrimaryAnswerSaved] = useState('');
  const [followUpQuestion, setFollowUpQuestion] = useState<string | null>(null);
  const [followUpReason, setFollowUpReason] = useState<string | null>(null);
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);

  // Evaluation & error state
  const [latestEvaluation, setLatestEvaluation] = useState<CallBResponse | null>(
    null
  );
  const [evalError, setEvalError] = useState<string | null>(null);

  // Speech recognition & TTS state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsMuted, setTtsMuted] = useState(false);
  const [spokenCharIndex, setSpokenCharIndex] = useState<number | null>(null);
  const [userMicLevel, setUserMicLevel] = useState(0);
  const [isMicActive, setIsMicActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const micDesiredRef = useRef(false);
  const aiAudioLevelRef = useRef<number | null>(null);

  // MediaPipe Vision Coach state
  const [visionStatus, setVisionStatus] = useState<
    'off' | 'loading' | 'active' | 'error'
  >(config.webcamCoachEnabled ? 'loading' : 'off');
  const [visionError, setVisionError] = useState<string | null>(null);
  const [liveEyeState, setLiveEyeState] = useState<EyeContactState>('no_face');
  const [liveEyePct, setLiveEyePct] = useState(100);
  const [liveSmilePct, setLiveSmilePct] = useState(0);
  const [liveStability, setLiveStability] = useState(100);
  const [liveYaw, setLiveYaw] = useState(0);
  const [livePitch, setLivePitch] = useState(0);
  const [showEyeNudge, setShowEyeNudge] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof getFaceLandmarker>> | null>(
    null
  );
  const visionSamplesRef = useRef<VisionFrameSample[]>([]);
  const lowEyeStartRef = useRef<number | null>(null);
  const phaseRef = useRef<QuestionPhase>(phase);
  phaseRef.current = phase;

  const currentQuestion = questions[currentIndex];
  const combinedLiveText = interimText
    ? `${answerText}${answerText && !answerText.endsWith(' ') ? ' ' : ''}${interimText}`
    : answerText;

  const liveWordCount = useMemo(
    () => countWords(combinedLiveText),
    [combinedLiveText]
  );
  const liveWpm = useMemo(() => {
    if (elapsedSeconds < 4 || liveWordCount === 0) return 0;
    return Math.round((liveWordCount / elapsedSeconds) * 60);
  }, [elapsedSeconds, liveWordCount]);
  const liveFillers = useMemo(
    () => analyzeFillerWords(combinedLiveText),
    [combinedLiveText]
  );

  // Active spoken prompt text (for live caption progress)
  const activePromptText = followUpQuestion
    ? followUpQuestion
    : currentQuestion.question;

  // Speak helper (uses Gemini Neural TTS when live, with seamless speechSynthesis fallback)
  const speakQuestion = useCallback(
    (text: string) => {
      setSpokenCharIndex(0);
      speakText(text, {
        voiceURI: config.selectedVoiceURI,
        pitch: persona.voicePitch,
        rate: persona.voiceRate,
        muted: ttsMuted,
        personaId: config.persona,
        apiKey: config.apiKey,
        demoMode: config.demoMode,
        onStart: () => {
          setIsSpeaking(true);
        },
        onBoundaryChar: (idx) => {
          setSpokenCharIndex(idx);
        },
        onAudioLevel: (level) => {
          aiAudioLevelRef.current = level;
        },
        onEnd: () => {
          aiAudioLevelRef.current = 0;
          setIsSpeaking(false);
          setSpokenCharIndex(null);
        },
      });
    },
    [
      config.apiKey,
      config.demoMode,
      config.persona,
      config.selectedVoiceURI,
      persona.voicePitch,
      persona.voiceRate,
      ttsMuted,
    ]
  );

  // Real-time microphone Web Audio AnalyserNode volume monitor when mic is active
  useEffect(() => {
    if (!isMicActive) {
      setUserMicLevel(0);
      return;
    }

    let active = true;
    let cleanup: (() => void) | undefined;

    void startMicAudioMonitor((level) => {
      if (active) setUserMicLevel(level);
    }).then((stopFn) => {
      if (!active) {
        stopFn();
      } else {
        cleanup = stopFn;
      }
    });

    return () => {
      active = false;
      cleanup?.();
      setUserMicLevel(0);
    };
  }, [isMicActive]);

  // Speak question whenever index changes and prefetch next question's neural audio
  useEffect(() => {
    if (!currentQuestion) return;
    visionSamplesRef.current = [];
    lowEyeStartRef.current = null;
    setShowEyeNudge(false);
    speakQuestion(currentQuestion.question);

    const nextQ = questions[currentIndex + 1];
    if (nextQ && !ttsMuted) {
      prefetchSpeechAudio(nextQ.question, {
        personaId: config.persona,
        apiKey: config.apiKey,
        demoMode: config.demoMode,
      });
    }

    return () => {
      stopSpeaking();
    };
  }, [
    config.apiKey,
    config.demoMode,
    config.persona,
    currentIndex,
    currentQuestion,
    questions,
    speakQuestion,
    ttsMuted,
  ]);

  // Timer during answering phases
  useEffect(() => {
    if (phase !== 'answering' && phase !== 'follow_up_answering') return;
    const id = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // Stop microphone helper
  const stopMic = useCallback(() => {
    micDesiredRef.current = false;
    setIsMicActive(false);
    setInterimText('');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, []);

  // Start / toggle microphone
  const toggleMic = useCallback(() => {
    if (phaseRef.current !== 'answering' && phaseRef.current !== 'follow_up_answering') {
      return;
    }

    if (isMicActive) {
      stopMic();
      return;
    }

    setMicError(null);
    if (!isSpeechRecognitionSupported()) {
      setMicError('Speech recognition is not supported in this browser. Type your answer below.');
      return;
    }

    const RecognitionCtor = getSpeechRecognitionConstructor();
    if (!RecognitionCtor) return;

    // Pause TTS if still speaking when candidate begins answering
    stopSpeaking();
    setIsSpeaking(false);
    setSpokenCharIndex(null);

    const rec = new RecognitionCtor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    micDesiredRef.current = true;

    rec.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          finalChunk += res[0].transcript + ' ';
        } else {
          interimChunk += res[0].transcript;
        }
      }

      if (finalChunk.trim()) {
        const addedWords = countWords(finalChunk);
        setVoiceWordCount((c) => c + addedWords);
        setAnswerText((prev) => {
          const spacer = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
          return `${prev}${spacer}${finalChunk.trim()} `;
        });
      }
      setInterimText(interimChunk.trim());
    };

    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicError('Microphone permission denied. Please type your response below.');
        micDesiredRef.current = false;
        setIsMicActive(false);
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setMicError(`Mic notice: ${event.error}`);
      }
    };

    rec.onend = () => {
      if (
        micDesiredRef.current &&
        (phaseRef.current === 'answering' || phaseRef.current === 'follow_up_answering')
      ) {
        try {
          rec.start();
        } catch {
          setIsMicActive(false);
          micDesiredRef.current = false;
        }
      } else {
        setIsMicActive(false);
        setInterimText('');
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setIsMicActive(true);
    } catch {
      setMicError('Could not start speech recognition. Type your answer below.');
      setIsMicActive(false);
      micDesiredRef.current = false;
    }
  }, [isMicActive, stopMic]);

  // Initialize MediaPipe Webcam Coach (~5 FPS during answering)
  useEffect(() => {
    if (!config.webcamCoachEnabled) {
      setVisionStatus('off');
      return;
    }

    let cancelled = false;
    let rafId: number | null = null;
    let lastSampleAt = 0;

    const setupVision = async () => {
      try {
        setVisionStatus('loading');
        setVisionError(null);

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const landmarker = await getFaceLandmarker();
        if (cancelled) return;
        landmarkerRef.current = landmarker;
        setVisionStatus('active');

        const loop = (now: number) => {
          if (cancelled) return;

          const activeAnswering =
            phaseRef.current === 'answering' ||
            phaseRef.current === 'follow_up_answering';

          if (
            activeAnswering &&
            now - lastSampleAt >= 200 &&
            videoRef.current &&
            videoRef.current.readyState >= 2 &&
            landmarkerRef.current
          ) {
            lastSampleAt = now;
            try {
              const sample = evaluateVisionFrame(
                landmarkerRef.current,
                videoRef.current,
                performance.now()
              );
              visionSamplesRef.current.push(sample);

              setLiveYaw(sample.yawDeg);
              setLivePitch(sample.pitchDeg);

              const recent = visionSamplesRef.current.slice(-25);
              const detectedRecent = recent.filter((s) => s.faceDetected);
              const eyeContactRatio =
                recent.length > 0
                  ? recent.filter((s) => s.eyeContact).length / recent.length
                  : 1;
              const pct = Math.round(eyeContactRatio * 100);
              setLiveEyePct(pct);

              if (!sample.faceDetected) {
                setLiveEyeState('no_face');
              } else if (sample.eyeContact) {
                setLiveEyeState('good');
              } else if (Math.abs(sample.yawDeg) <= 22 && Math.abs(sample.pitchDeg) <= 22) {
                setLiveEyeState('fair');
              } else {
                setLiveEyeState('poor');
              }

              // Low eye contact >5s nudge
              if (!sample.faceDetected || !sample.eyeContact) {
                if (lowEyeStartRef.current === null) {
                  lowEyeStartRef.current = now;
                } else if (now - lowEyeStartRef.current > 5000) {
                  setShowEyeNudge(true);
                }
              } else {
                lowEyeStartRef.current = null;
                setShowEyeNudge(false);
              }

              if (detectedRecent.length > 0) {
                const smiling = detectedRecent.filter(
                  (s) => s.smileScore >= 0.22
                ).length;
                setLiveSmilePct(
                  Math.round((smiling / detectedRecent.length) * 100)
                );
                setLiveStability(computeHeadStability(detectedRecent));
              }
            } catch {
              // ignore transient frame read errors
            }
          }

          rafId = requestAnimationFrame(loop);
        };

        rafId = requestAnimationFrame(loop);
      } catch (err) {
        if (!cancelled) {
          setVisionStatus('error');
          setVisionError(
            err instanceof Error
              ? err.message
              : 'Webcam or MediaPipe FaceLandmarker unavailable.'
          );
        }
      }
    };

    void setupVision();

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [config.webcamCoachEnabled]);

  // Cleanup mic & TTS on unmount
  useEffect(() => {
    return () => {
      stopMic();
      stopSpeaking();
    };
  }, [stopMic]);

  const buildAttemptObject = (
    evaluation: CallBResponse,
    skipped: boolean,
    finalPrimary: string,
    finalFollowUpQ: string | null,
    finalFollowUpR: string | null,
    finalFollowUpA: string | null
  ): QuestionAttempt => {
    const combined = finalFollowUpA
      ? `${finalPrimary}\n\n[Follow-up response]: ${finalFollowUpA}`
      : finalPrimary;
    const totalWords = countWords(combined);
    const fillers = analyzeFillerWords(combined);
    const wpm =
      elapsedSeconds > 3 && totalWords > 0
        ? Math.round((totalWords / elapsedSeconds) * 60)
        : 0;

    const visionSummary: QuestionVisionSummary | null = config.webcamCoachEnabled
      ? summarizeQuestionVision(currentQuestion.id, visionSamplesRef.current)
      : null;

    return {
      question: currentQuestion,
      skipped,
      primaryAnswer: finalPrimary,
      followUpQuestion: finalFollowUpQ,
      followUpReason: finalFollowUpR,
      followUpAnswer: finalFollowUpA,
      combinedAnswer: combined,
      evaluation,
      compositeScore: skipped ? 0 : computeCompositeScore(evaluation.scores),
      voiceMetrics: {
        durationSeconds: elapsedSeconds,
        wordCount: totalWords,
        wpm,
        fillerCounts: fillers.counts,
        totalFillers: fillers.total,
        voiceWordCount,
        typedWordCount,
      },
      visionSummary,
    };
  };

  const advanceToNextQuestion = (updatedAttempts: QuestionAttempt[], totalFallbacks: number) => {
    stopMic();
    stopSpeaking();

    if (currentIndex + 1 >= questions.length) {
      setPhase('finishing');
      onCompleteSession(updatedAttempts, totalFallbacks);
      return;
    }

    setCurrentIndex((i) => i + 1);
    setPhase('answering');
    setAnswerText('');
    setInterimText('');
    setVoiceWordCount(0);
    setTypedWordCount(0);
    setElapsedSeconds(0);
    setPrimaryAnswerSaved('');
    setFollowUpQuestion(null);
    setFollowUpReason(null);
    setBridgeMessage(null);
    setLatestEvaluation(null);
    setEvalError(null);
  };

  const runEvaluation = useCallback(
    async (allowFallback: boolean) => {
      const cleanedCurrent = combinedLiveText.trim();
      if (!cleanedCurrent) return;

      stopMic();
      stopSpeaking();
      const isFollowUpTurn = phaseRef.current === 'follow_up_answering';

      // Preserve user answers before async request
      const finalPrimary = isFollowUpTurn ? primaryAnswerSaved : cleanedCurrent;
      const finalFollowUpA = isFollowUpTurn ? cleanedCurrent : null;
      if (!isFollowUpTurn) {
        setPrimaryAnswerSaved(cleanedCurrent);
      }

      const answerForEvaluation = isFollowUpTurn
        ? `Primary answer: ${finalPrimary}\n\nFollow-up question: ${followUpQuestion}\nFollow-up answer: ${finalFollowUpA}`
        : finalPrimary;

      setPhase('evaluating');
      setEvalError(null);

      try {
        const res = await evaluateCandidateAnswer(
          config,
          currentQuestion,
          answerForEvaluation,
          jdSkills,
          isFollowUpTurn,
          { allowFallbackOnError: allowFallback }
        );

        const nextFallbackCount = res.usedFallback ? fallbackCount + 1 : fallbackCount;
        if (res.usedFallback) {
          setFallbackCount(nextFallbackCount);
        }

        const evalData = res.data;

        if (
          !isFollowUpTurn &&
          config.followUpsEnabled &&
          evalData.needs_follow_up &&
          evalData.follow_up_question
        ) {
          const bridge =
            persona.bridgePhrases[
              currentIndex % persona.bridgePhrases.length
            ];
          setBridgeMessage(bridge);
          setFollowUpQuestion(evalData.follow_up_question);
          setFollowUpReason(evalData.follow_up_reason);
          setAnswerText('');
          setInterimText('');
          setPhase('follow_up_answering');
          speakQuestion(`${bridge} ${evalData.follow_up_question}`);
          return;
        }

        setLatestEvaluation(evalData);
        setPhase('feedback');
        speakQuestion(evalData.spoken_feedback);
      } catch (err) {
        setEvalError(
          err instanceof Error
            ? err.message
            : 'Unable to evaluate answer. Retry or use Demo Fallback.'
        );
        setPhase('error');
      }
    },
    [
      combinedLiveText,
      config,
      currentIndex,
      currentQuestion,
      fallbackCount,
      followUpQuestion,
      jdSkills,
      persona.bridgePhrases,
      primaryAnswerSaved,
      speakQuestion,
      stopMic,
    ]
  );

  const handleConfirmFeedbackAndNext = () => {
    if (!latestEvaluation) return;
    const isFollowUpTurn = Boolean(followUpQuestion);
    const finalPrimary = isFollowUpTurn ? primaryAnswerSaved : combinedLiveText.trim();
    const finalFollowUpA = isFollowUpTurn ? combinedLiveText.trim() : null;

    const attempt = buildAttemptObject(
      latestEvaluation,
      false,
      finalPrimary,
      followUpQuestion,
      followUpReason,
      finalFollowUpA
    );
    const updated = [...attempts, attempt];
    setAttempts(updated);
    advanceToNextQuestion(updated, fallbackCount);
  };

  const handleSkipQuestion = () => {
    stopMic();
    stopSpeaking();
    const attempt = buildAttemptObject(
      createZeroEvaluation(),
      true,
      '',
      null,
      null,
      null
    );
    const updated = [...attempts, attempt];
    setAttempts(updated);
    advanceToNextQuestion(updated, fallbackCount);
  };

  const handleEndEarly = () => {
    stopMic();
    stopSpeaking();
    setPhase('finishing');
    onCompleteSession(attempts, fallbackCount);
  };

  // Global keyboard shortcuts: Space for mic, Enter for submit
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'SELECT';

      if (e.code === 'Space' && !isTyping) {
        if (phaseRef.current === 'answering' || phaseRef.current === 'follow_up_answering') {
          e.preventDefault();
          toggleMic();
        }
      } else if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !isTyping &&
        (phaseRef.current === 'answering' || phaseRef.current === 'follow_up_answering') &&
        combinedLiveText.trim().length > 0
      ) {
        e.preventDefault();
        void runEvaluation(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [combinedLiveText, runEvaluation, toggleMic]);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const sourceLabel =
    currentQuestion.source === 'resume'
      ? 'From your resume'
      : currentQuestion.source === 'jd'
      ? 'From the job description'
      : 'Core competency';

  const eyeBadgeConfig =
    liveEyeState === 'good'
      ? { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: 'Strong Eye Contact' }
      : liveEyeState === 'fair'
      ? { color: 'text-amber-700 bg-amber-50 border-amber-200', label: 'Brief Glance Away' }
      : liveEyeState === 'poor'
      ? { color: 'text-red-700 bg-red-50 border-red-200', label: 'Look Toward Camera' }
      : { color: 'text-slate-600 bg-slate-100 border-slate-200', label: 'No Face Detected' };

  const fillerBreakdownEntries = Object.entries(liveFillers.counts);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Progress & Telemetry Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-200">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span className="text-slate-900 font-semibold tabular-nums">
              Question {currentIndex + 1} of {questions.length}
            </span>
            <span aria-hidden="true">·</span>
            <span>{currentQuestion.category}</span>
            <span aria-hidden="true">·</span>
            <span>{currentQuestion.difficulty}</span>
            <span aria-hidden="true">·</span>
            <span className="text-blue-700 font-medium">{sourceLabel}</span>
          </div>
          <div className="w-full sm:w-80 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{
                width: `${((currentIndex + 1) / questions.length) * 100}%`,
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              const nextMuted = !ttsMuted;
              setTtsMuted(nextMuted);
              if (nextMuted) {
                stopSpeaking();
                setIsSpeaking(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
          >
            {ttsMuted ? (
              <>
                <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                Voice Muted
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-blue-600" />
                Voice On
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleEndEarly}
            disabled={phase === 'evaluating' || phase === 'finishing'}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Flag className="w-3.5 h-3.5" />
            End Interview Early
          </button>
          <button
            type="button"
            onClick={onAbortToSetup}
            className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap cursor-pointer"
          >
            Exit
          </button>
        </div>
      </div>

      {/* Video Call Stage: Live Interviewer Face + Candidate Webcam Vision Coach */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch mb-6">
        {/* AI-Driven Audio-Reactive Digital Human Avatar */}
        <section
          aria-label="Digital Human Interviewer"
          className={`${
            config.webcamCoachEnabled ? 'lg:col-span-7' : 'lg:col-span-12'
          } bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col`}
        >
          <DigitalHumanAvatar
            personaId={config.persona}
            isSpeaking={isSpeaking}
            isListening={isMicActive}
            userMicLevel={userMicLevel}
            aiAudioLevelRef={aiAudioLevelRef}
            captionText={activePromptText}
            spokenCharIndex={spokenCharIndex}
            competencyLabel={currentQuestion.competency}
            onRepeatQuestion={() => {
              unlockAudioPlayback();
              speakQuestion(
                followUpQuestion
                  ? `${bridgeMessage ?? ''} ${followUpQuestion}`
                  : currentQuestion.question
              );
            }}
          />

          {/* Threaded Adaptive Follow-up Detail Bar */}
          {followUpQuestion && (
            <div className="px-5 py-4 bg-amber-50/70 border-t border-amber-200 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-amber-900">
                <span>Adaptive Follow-Up Triggered</span>
                {followUpReason && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-normal text-amber-800">
                      {followUpReason}
                    </span>
                  </>
                )}
              </div>
              {bridgeMessage && (
                <p className="text-xs italic text-slate-600">
                  “{bridgeMessage}”
                </p>
              )}
              {primaryAnswerSaved && (
                <p className="text-xs text-slate-600 bg-white border border-amber-200/80 rounded-lg p-2.5">
                  <span className="font-semibold text-slate-800">
                    Initial response:{' '}
                  </span>
                  {primaryAnswerSaved}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Candidate Webcam Vision Coach */}
        {config.webcamCoachEnabled && (
          <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Eye className="w-4 h-4 text-blue-600" />
                  Your Camera &amp; Vision Coach
                </div>
                <span className="text-xs text-slate-500">MediaPipe · 5 FPS</span>
              </div>

              <div className="relative aspect-[16/10] w-full rounded-lg bg-slate-950 overflow-hidden border border-slate-800">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="w-full h-full object-cover -scale-x-100"
                />
                {visionStatus === 'loading' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-white text-xs gap-2 p-4 text-center">
                    <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
                    <span>Loading MediaPipe FaceLandmarker...</span>
                  </div>
                )}
                {visionStatus === 'error' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-slate-300 text-xs gap-2 p-4 text-center">
                    <CameraOff className="w-5 h-5 text-amber-400" />
                    <span>{visionError}</span>
                  </div>
                )}
              </div>

              {showEyeNudge && (
                <div
                  role="status"
                  className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900"
                >
                  Gentle cue: bring your gaze back toward the camera lens (±15°).
                </div>
              )}

              {visionStatus === 'active' && (
                <div className="space-y-2.5">
                  <div
                    className={`px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-between ${eyeBadgeConfig.color}`}
                  >
                    <span>{eyeBadgeConfig.label}</span>
                    <span className="font-mono tabular-nums">{liveEyePct}%</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                      <div className="text-slate-500 text-[11px]">Smile</div>
                      <div className="text-sm font-semibold font-mono tabular-nums text-slate-900">
                        {liveSmilePct}%
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                      <div className="text-slate-500 text-[11px]">Stability</div>
                      <div className="text-sm font-semibold font-mono tabular-nums text-slate-900">
                        {liveStability}/100
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                      <div className="text-slate-500 text-[11px]">Yaw / Pitch</div>
                      <div className="text-xs font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                        {liveYaw}° / {livePitch}°
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              On-device FaceLandmarker processing only — video never leaves your browser.
            </p>
          </aside>
        )}
      </div>

      {/* Answer Studio / Evaluating / Feedback */}
      <div className="space-y-6">
        {(phase === 'answering' || phase === 'follow_up_answering') && (
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative flex items-center justify-center">
                  {isMicActive && (
                    <span
                      className="absolute inset-0 rounded-full bg-red-500/30 mic-pulse-ring"
                      aria-hidden="true"
                    />
                  )}
                  <button
                    type="button"
                    onClick={toggleMic}
                    aria-label={isMicActive ? 'Stop microphone' : 'Start microphone'}
                    className={`relative z-10 w-14 h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                      isMicActive
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                  >
                    {isMicActive ? (
                      <MicOff className="w-6 h-6" />
                    ) : (
                      <Mic className="w-6 h-6" />
                    )}
                  </button>
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {isMicActive
                      ? 'Listening — speak naturally'
                      : followUpQuestion
                      ? 'Answer the follow-up prompt'
                      : 'Click mic or type your answer'}
                  </div>
                  <div className="text-xs text-slate-500">
                    Shortcuts: Space (toggle mic) · Enter (submit) · Shift+Enter (newline)
                  </div>
                </div>
              </div>

              {/* Live Telemetry Strip */}
              <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums text-slate-600">
                <div>
                  <span className="text-slate-400">Time </span>
                  <span className="font-semibold text-slate-900">
                    {formatTimer(elapsedSeconds)}
                  </span>
                  <span className="text-slate-400">
                    {' '}
                    / {formatTimer(currentQuestion.ideal_duration_seconds)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Words </span>
                  <span className="font-semibold text-slate-900">
                    {liveWordCount}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">WPM </span>
                  <span className="font-semibold text-slate-900">
                    {liveWpm}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Fillers </span>
                  <span
                    className={`font-semibold ${
                      liveFillers.total >= 4 ? 'text-amber-700' : 'text-slate-900'
                    }`}
                  >
                    {liveFillers.total}
                  </span>
                </div>
              </div>
            </div>

            {fillerBreakdownEntries.length > 0 && (
              <div className="text-xs text-amber-800 bg-amber-50/70 border border-amber-200 rounded-lg px-3 py-2">
                <span className="font-semibold">Detected fillers: </span>
                {fillerBreakdownEntries
                  .map(([word, count]) => `"${word}" (${count}x)`)
                  .join(' · ')}
              </div>
            )}

            {micError && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {micError}
              </p>
            )}

            <div>
              <label htmlFor="answer-transcript" className="sr-only">
                Your interview answer transcript
              </label>
              <textarea
                id="answer-transcript"
                rows={5}
                value={combinedLiveText}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  const diff = Math.max(0, countWords(nextVal) - countWords(answerText));
                  if (diff > 0) setTypedWordCount((c) => c + diff);
                  setInterimText('');
                  setAnswerText(nextVal);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    if (combinedLiveText.trim().length > 0) {
                      e.preventDefault();
                      void runEvaluation(false);
                    }
                  }
                }}
                placeholder="Your spoken transcript appears here in real time. You can also type or edit directly..."
                className="w-full px-4 py-3 text-sm leading-relaxed bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={handleSkipQuestion}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Skip question
              </button>

              <button
                type="button"
                disabled={combinedLiveText.trim().length === 0}
                onClick={() => void runEvaluation(false)}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
              >
                <Send className="w-4 h-4" />
                Submit answer
              </button>
            </div>
          </section>
        )}

        {/* Evaluating Skeleton */}
        {(phase === 'evaluating' || phase === 'finishing') && (
          <section
            aria-live="polite"
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />
              <h3 className="text-base font-semibold text-slate-900">
                {phase === 'finishing'
                  ? 'Synthesizing final coaching dossier...'
                  : 'Evaluating your answer against the rubric...'}
              </h3>
            </div>
            <div className="space-y-2.5 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-3/4" />
              <div className="h-4 bg-slate-200 rounded w-1/2" />
              <div className="h-20 bg-slate-100 rounded w-full" />
            </div>
          </section>
        )}

        {/* API Error Retry State (Answer Preserved) */}
        {phase === 'error' && (
          <section
            role="alert"
            className="bg-white border border-red-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-900">
                  Evaluation request encountered an error
                </h3>
                <p className="text-sm text-red-700">{evalError}</p>
                <p className="text-xs text-slate-500">
                  Your answer ({countWords(combinedLiveText)} words) has been safely preserved.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 max-h-28 overflow-y-auto">
              {combinedLiveText}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void runEvaluation(false)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Retry Evaluation
              </button>
              <button
                type="button"
                onClick={() => void runEvaluation(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                Continue with Demo Fallback
              </button>
            </div>
          </section>
        )}

        {/* Compact Feedback Card Before Advancing */}
        {phase === 'feedback' && latestEvaluation && (
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <div className="text-xs font-medium text-slate-500">
                  Immediate Rubric Assessment from {persona.name}
                </div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">
                  {latestEvaluation.spoken_feedback}
                </div>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="text-2xl font-bold text-blue-600">
                  {computeCompositeScore(latestEvaluation.scores)}
                  <span className="text-sm font-normal text-slate-400">/100</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="p-4 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-1">
                <div className="text-xs font-semibold text-emerald-800 inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Key Strength
                </div>
                <p className="text-slate-800 text-xs leading-relaxed">
                  {latestEvaluation.strengths[0] ?? 'Clear response aligned to the prompt.'}
                </p>
              </div>

              <div className="p-4 rounded-lg bg-amber-50/70 border border-amber-200 space-y-1">
                <div className="text-xs font-semibold text-amber-800 inline-flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Next-Time Upgrade
                </div>
                <p className="text-slate-800 text-xs leading-relaxed">
                  {latestEvaluation.improvements[0] ??
                    'Add specific metrics to further sharpen impact.'}
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleConfirmFeedbackAndNext}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                {currentIndex + 1 >= questions.length
                  ? 'Generate Final Analytics'
                  : 'Next Question'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}

        {!config.webcamCoachEnabled && (
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <Camera className="w-3.5 h-3.5" />
            <span>
              Webcam Vision Coach is currently off. Audio &amp; transcript scoring remain active.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
