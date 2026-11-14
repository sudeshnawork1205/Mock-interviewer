import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type {
  AppScreen,
  InterviewQuestion,
  InterviewSessionResult,
  InterviewSetupConfig,
  QuestionAttempt,
} from './types/interview';
import {
  checkServerKeyStatus,
  fetchFinalCoachingSummary,
  fetchInterviewQuestions,
  loadStoredApiKey,
  persistApiKey,
} from './services/geminiClient';
import {
  clearSessionHistory,
  loadSessionHistory,
  saveSessionToHistory,
} from './services/sessionHistory';
import {
  prefetchSpeechAudio,
  unlockAudioPlayback,
} from './services/speechService';
import { SetupScreen } from './components/SetupScreen';

const LiveInterviewScreen = lazy(() =>
  import('./components/LiveInterviewScreen').then((m) => ({
    default: m.LiveInterviewScreen,
  }))
);

const DashboardScreen = lazy(() =>
  import('./components/DashboardScreen').then((m) => ({
    default: m.DashboardScreen,
  }))
);

function createInitialConfig(): InterviewSetupConfig {
  const storedKey = loadStoredApiKey();
  return {
    role: 'Software Engineer',
    customRole: '',
    level: 'Mid-level',
    mode: 'Mixed',
    questionCount: 5,
    persona: 'strict_tech',
    followUpsEnabled: true,
    webcamCoachEnabled: true,
    selectedVoiceURI: '',
    apiKey: storedKey,
    rememberApiKey: Boolean(storedKey),
    demoMode: false,
    resume: null,
    jd: {
      rawText: '',
      targetTitle: null,
      companyName: null,
      extractedSkills: [],
    },
  };
}

export default function App() {
  const shouldReduceMotion = useReducedMotion();
  const [screen, setScreen] = useState<AppScreen>('setup');
  const [config, setConfig] = useState<InterviewSetupConfig>(createInitialConfig);
  const [hasServerKey, setHasServerKey] = useState(false);

  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [jdSkills, setJdSkills] = useState<string[]>([]);
  const [candidateName, setCandidateName] = useState<string | null>(null);
  const [initFallbackCount, setInitFallbackCount] = useState(0);

  const [sessionResult, setSessionResult] =
    useState<InterviewSessionResult | null>(null);
  const [history, setHistory] = useState<InterviewSessionResult[]>(() =>
    loadSessionHistory()
  );
  const [isSummarizing, setIsSummarizing] = useState(false);

  useEffect(() => {
    void checkServerKeyStatus().then((res) => {
      setHasServerKey(res.hasServerKey);
    });
  }, []);

  useEffect(() => {
    persistApiKey(config.apiKey, config.rememberApiKey);
  }, [config.apiKey, config.rememberApiKey]);

  const handleStartInterview = useCallback(async () => {
    setIsStarting(true);
    setStartError(null);
    unlockAudioPlayback();

    // Preload LiveInterviewScreen chunk and MediaPipe FaceLandmarker in parallel with Call A
    void import('./components/LiveInterviewScreen');
    if (config.webcamCoachEnabled) {
      void import('./services/visionCoach')
        .then((v) => v.getFaceLandmarker())
        .catch(() => {});
    }

    try {
      const res = await fetchInterviewQuestions(config, {
        allowFallbackOnError: config.demoMode,
      });

      const firstQ = res.data.questions[0]?.question;
      if (firstQ) {
        prefetchSpeechAudio(firstQ, {
          personaId: config.persona,
          apiKey: config.apiKey,
          demoMode: config.demoMode,
        });
      }

      setQuestions(res.data.questions);
      setJdSkills(
        res.data.jd_skills?.length > 0
          ? res.data.jd_skills
          : config.jd.extractedSkills
      );
      setCandidateName(
        res.data.candidate_name ?? config.resume?.candidateName ?? null
      );
      setInitFallbackCount(res.usedFallback ? 1 : 0);
      setSessionResult(null);
      setScreen('live');
    } catch (err) {
      setStartError(
        err instanceof Error
          ? err.message
          : 'Failed to initialize interview questions.'
      );
    } finally {
      setIsStarting(false);
    }
  }, [config]);

  const handleCompleteSession = useCallback(
    async (attempts: QuestionAttempt[], evalFallbackCount: number) => {
      setIsSummarizing(true);
      void import('./components/DashboardScreen');

      const scoredAttempts = attempts.filter((a) => !a.skipped && a.evaluation);
      const overallScore =
        scoredAttempts.length > 0
          ? Math.round(
              scoredAttempts.reduce((sum, a) => sum + a.compositeScore, 0) /
                scoredAttempts.length
            )
          : 0;

      const visionAttempts = attempts.filter(
        (a) => a.visionSummary && a.visionSummary.faceDetectedCount > 0
      );

      const overallPresenceScore =
        visionAttempts.length > 0
          ? Math.round(
              visionAttempts.reduce(
                (s, a) => s + (a.visionSummary?.presenceScore ?? 0),
                0
              ) / visionAttempts.length
            )
          : null;

      const overallEyeContactPct =
        visionAttempts.length > 0
          ? Math.round(
              visionAttempts.reduce(
                (s, a) => s + (a.visionSummary?.eyeContactPct ?? 0),
                0
              ) / visionAttempts.length
            )
          : null;

      const overallSmilePct =
        visionAttempts.length > 0
          ? Math.round(
              visionAttempts.reduce(
                (s, a) => s + (a.visionSummary?.smilePct ?? 0),
                0
              ) / visionAttempts.length
            )
          : null;

      const overallHeadStability =
        visionAttempts.length > 0
          ? Math.round(
              visionAttempts.reduce(
                (s, a) => s + (a.visionSummary?.headStabilityScore ?? 0),
                0
              ) / visionAttempts.length
            )
          : null;

      const summaryRes = await fetchFinalCoachingSummary(
        config,
        attempts,
        jdSkills,
        overallPresenceScore
      );

      const effectiveRole =
        config.role === 'Other'
          ? config.customRole.trim() || 'Generalist'
          : config.role;

      const finalResult: InterviewSessionResult = {
        config,
        effectiveRole,
        candidateName,
        jdSkills,
        attempts,
        overallScore,
        overallPresenceScore,
        overallEyeContactPct,
        overallSmilePct,
        overallHeadStability,
        summary: summaryRes.data,
        usedFallbackCount:
          initFallbackCount + evalFallbackCount + (summaryRes.usedFallback ? 1 : 0),
        completedAt: new Date().toISOString(),
      };

      setSessionResult(finalResult);
      setHistory(saveSessionToHistory(finalResult));
      setIsSummarizing(false);
      setScreen('dashboard');
    },
    [candidateName, config, initFallbackCount, jdSkills]
  );

  const handleRetrySame = useCallback(() => {
    setSessionResult(null);
    setScreen('live');
  }, []);

  const handleNewInterview = useCallback(() => {
    setSessionResult(null);
    setQuestions([]);
    setScreen('setup');
  }, []);

  const handlePracticeDrillPrompt = useCallback((promptText: string) => {
    const drillQuestion: InterviewQuestion = {
      id: 'drill-1',
      question: promptText,
      category: 'Focused Drill',
      competency: 'Targeted Practice',
      difficulty: 'Medium',
      source: 'general',
      rubric: [
        'States clear context and personal ownership',
        'Includes concrete actions and evaluated trade-offs',
        'Closes with quantified impact or lesson learned',
      ],
      ideal_duration_seconds: 90,
    };
    setQuestions([drillQuestion]);
    setSessionResult(null);
    setScreen('live');
  }, []);

  const handleOpenHistorySession = useCallback(
    (past: InterviewSessionResult) => {
      setSessionResult(past);
      setScreen('dashboard');
    },
    []
  );

  const handleClearHistory = useCallback(() => {
    clearSessionHistory();
    setHistory([]);
  }, []);

  const transitionProps = shouldReduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
        transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const },
      };

  const screenFallback = (
    <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-3">
      <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
      <p className="text-sm text-slate-500">Loading view...</p>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Three-Zone Top Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 no-print">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => {
              if (screen !== 'live') setScreen('setup');
            }}
            className="text-lg font-bold font-display tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            InterviewAce
          </button>

          <nav
            aria-label="Interview Stages"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            <button
              type="button"
              onClick={() => setScreen('setup')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                screen === 'setup'
                  ? 'border-blue-600 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              Setup
            </button>
            <button
              type="button"
              disabled={questions.length === 0}
              onClick={() => {
                if (questions.length > 0) setScreen('live');
              }}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                questions.length === 0
                  ? 'border-transparent text-slate-300 cursor-not-allowed'
                  : screen === 'live'
                  ? 'border-blue-600 text-slate-900 cursor-pointer'
                  : 'border-transparent text-slate-500 hover:text-slate-900 cursor-pointer'
              }`}
            >
              Live Interview
            </button>
            <button
              type="button"
              disabled={!sessionResult}
              onClick={() => {
                if (sessionResult) setScreen('dashboard');
              }}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                !sessionResult
                  ? 'border-transparent text-slate-300 cursor-not-allowed'
                  : screen === 'dashboard'
                  ? 'border-blue-600 text-slate-900 cursor-pointer'
                  : 'border-transparent text-slate-500 hover:text-slate-900 cursor-pointer'
              }`}
            >
              Analytics
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            {screen === 'setup' ? (
              <button
                type="button"
                disabled={
                  isStarting ||
                  (!config.demoMode && !config.apiKey.trim() && !hasServerKey)
                }
                onClick={() => void handleStartInterview()}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isStarting ? 'Starting...' : 'Start Interview'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNewInterview}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                New Session
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {isSummarizing ? (
          <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-3">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <h2 className="text-lg font-semibold text-slate-900">
              Compiling Performance &amp; Coaching Analytics...
            </h2>
            <p className="text-sm text-slate-500">
              Aggregating rubric scores, vocal pacing, STAR alignment, and MediaPipe presence metrics.
            </p>
          </div>
        ) : (
          <Suspense fallback={screenFallback}>
            <AnimatePresence mode="wait">
              {screen === 'setup' && (
                <motion.div key="setup" {...transitionProps}>
                  <SetupScreen
                    config={config}
                    hasServerKey={hasServerKey}
                    isStarting={isStarting}
                    startError={startError}
                    history={history}
                    onChangeConfig={setConfig}
                    onStartInterview={() => void handleStartInterview()}
                    onOpenHistorySession={handleOpenHistorySession}
                    onClearHistory={handleClearHistory}
                  />
                </motion.div>
              )}

              {screen === 'live' && questions.length > 0 && (
                <motion.div key="live" {...transitionProps}>
                  <LiveInterviewScreen
                    config={config}
                    questions={questions}
                    jdSkills={jdSkills}
                    onCompleteSession={(attempts, count) =>
                      void handleCompleteSession(attempts, count)
                    }
                    onAbortToSetup={handleNewInterview}
                  />
                </motion.div>
              )}

              {screen === 'dashboard' && sessionResult && (
                <motion.div key="dashboard" {...transitionProps}>
                  <DashboardScreen
                    result={sessionResult}
                    onRetrySame={handleRetrySame}
                    onNewInterview={handleNewInterview}
                    onPracticeDrillPrompt={handlePracticeDrillPrompt}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </Suspense>
        )}
      </main>
    </div>
  );
}
