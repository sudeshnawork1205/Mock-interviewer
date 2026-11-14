import { useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileDown,
  Mic,
  Plus,
  RotateCcw,
  Target,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import {
  PERSONAS,
  type InterviewSessionResult,
  type VerdictLabel,
} from '../types/interview';
import { speakText, stopSpeaking } from '../services/speechService';

interface DashboardScreenProps {
  result: InterviewSessionResult;
  onRetrySame: () => void;
  onNewInterview: () => void;
}

function getVerdictStyle(verdict: VerdictLabel): {
  bg: string;
  text: string;
  border: string;
  accentHex: string;
} {
  switch (verdict) {
    case 'Interview Ready':
      return {
        bg: 'bg-emerald-50',
        text: 'text-emerald-800',
        border: 'border-emerald-200',
        accentHex: '#16A34A',
      };
    case 'Almost There':
      return {
        bg: 'bg-blue-50',
        text: 'text-blue-800',
        border: 'border-blue-200',
        accentHex: '#2563EB',
      };
    case 'Needs Practice':
      return {
        bg: 'bg-amber-50',
        text: 'text-amber-800',
        border: 'border-amber-200',
        accentHex: '#D97706',
      };
    default:
      return {
        bg: 'bg-red-50',
        text: 'text-red-800',
        border: 'border-red-200',
        accentHex: '#DC2626',
      };
  }
}

export function DashboardScreen({
  result,
  onRetrySame,
  onNewInterview,
}: DashboardScreenProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>(() => {
    const firstId = result.attempts[0]?.question.id;
    return firstId ? { [firstId]: true } : {};
  });
  const [speakingQuestionId, setSpeakingQuestionId] = useState<string | null>(
    null
  );

  const gaugeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const barCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eyeLineCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const verdictStyle = getVerdictStyle(result.summary.verdict);
  const persona = PERSONAS[result.config.persona];

  const scoredAttempts = useMemo(
    () => result.attempts.filter((a) => !a.skipped && a.evaluation),
    [result.attempts]
  );

  // Aggregate axis averages
  const axisAverages = useMemo(() => {
    if (scoredAttempts.length === 0) {
      return { relevance: 0, depth: 0, clarity: 0, structure: 0, confidence: 0 };
    }
    const sum = scoredAttempts.reduce(
      (acc, a) => {
        const s = a.evaluation!.scores;
        return {
          relevance: acc.relevance + s.relevance,
          depth: acc.depth + s.depth,
          clarity: acc.clarity + s.clarity,
          structure: acc.structure + s.structure,
          confidence: acc.confidence + s.confidence,
        };
      },
      { relevance: 0, depth: 0, clarity: 0, structure: 0, confidence: 0 }
    );
    const n = scoredAttempts.length;
    return {
      relevance: Number((sum.relevance / n).toFixed(1)),
      depth: Number((sum.depth / n).toFixed(1)),
      clarity: Number((sum.clarity / n).toFixed(1)),
      structure: Number((sum.structure / n).toFixed(1)),
      confidence: Number((sum.confidence / n).toFixed(1)),
    };
  }, [scoredAttempts]);

  // Aggregate Voice Delivery metrics
  const voiceStats = useMemo(() => {
    const answered = scoredAttempts;
    if (answered.length === 0) {
      return {
        avgWpm: 0,
        avgDuration: 0,
        avgWords: 0,
        topFillers: [] as Array<[string, number]>,
        voicePct: 0,
        typedPct: 0,
      };
    }

    const totalWpm = answered.reduce((s, a) => s + a.voiceMetrics.wpm, 0);
    const totalDur = answered.reduce(
      (s, a) => s + a.voiceMetrics.durationSeconds,
      0
    );
    const totalWords = answered.reduce(
      (s, a) => s + a.voiceMetrics.wordCount,
      0
    );

    const fillerAgg: Record<string, number> = {};
    let voiceWords = 0;
    let typedWords = 0;

    for (const a of answered) {
      voiceWords += a.voiceMetrics.voiceWordCount;
      typedWords += a.voiceMetrics.typedWordCount;
      for (const [word, count] of Object.entries(a.voiceMetrics.fillerCounts)) {
        fillerAgg[word] = (fillerAgg[word] ?? 0) + count;
      }
    }

    const topFillers = Object.entries(fillerAgg)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const inputTotal = Math.max(1, voiceWords + typedWords);
    const voicePct =
      voiceWords + typedWords > 0
        ? Math.round((voiceWords / inputTotal) * 100)
        : 0;

    return {
      avgWpm: Math.round(totalWpm / answered.length),
      avgDuration: Math.round(totalDur / answered.length),
      avgWords: Math.round(totalWords / answered.length),
      topFillers,
      voicePct,
      typedPct: voiceWords + typedWords > 0 ? 100 - voicePct : 100,
    };
  }, [scoredAttempts]);

  // STAR Method Tracker
  const starStats = useMemo(() => {
    const behavioral = scoredAttempts.filter((a) => a.evaluation?.star.applicable);
    if (behavioral.length === 0) {
      return { count: 0, situation: 0, task: 0, action: 0, result: 0 };
    }
    const pct = (key: 'situation' | 'task' | 'action' | 'result') =>
      Math.round(
        (behavioral.filter((a) => a.evaluation?.star[key]).length /
          behavioral.length) *
          100
      );
    return {
      count: behavioral.length,
      situation: pct('situation'),
      task: pct('task'),
      action: pct('action'),
      result: pct('result'),
    };
  }, [scoredAttempts]);

  // Job-Fit Skills Coverage
  const jobFit = useMemo(() => {
    const demonstrated = new Set<string>();
    for (const a of scoredAttempts) {
      a.evaluation?.jd_skills_demonstrated.forEach((s) => demonstrated.add(s));
    }

    const targetSkills = result.jdSkills;
    const demonstratedList = targetSkills.filter((s) =>
      Array.from(demonstrated).some(
        (d) => d.toLowerCase() === s.toLowerCase()
      )
    );
    const missedList = targetSkills.filter(
      (s) => !demonstratedList.includes(s)
    );

    const matchPct =
      targetSkills.length > 0
        ? Math.round((demonstratedList.length / targetSkills.length) * 100)
        : 0;

    return {
      matchPct,
      demonstratedList,
      missedList,
    };
  }, [result.jdSkills, scoredAttempts]);

  // Follow-up Insights
  const followUpAttempts = useMemo(
    () => result.attempts.filter((a) => a.followUpQuestion),
    [result.attempts]
  );

  // Vision interval samples
  const visionAttempts = useMemo(
    () => result.attempts.filter((a) => a.visionSummary && a.visionSummary.sampleCount > 0),
    [result.attempts]
  );

  // Render Chart.js visualizations
  useEffect(() => {
    const charts: Chart[] = [];

    if (gaugeCanvasRef.current) {
      charts.push(
        new Chart(gaugeCanvasRef.current, {
          type: 'doughnut',
          data: {
            labels: ['Score', 'Remaining'],
            datasets: [
              {
                data: [result.overallScore, Math.max(0, 100 - result.overallScore)],
                backgroundColor: [verdictStyle.accentHex, '#E2E8F0'],
                borderWidth: 0,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '76%',
            plugins: {
              legend: { display: false },
              tooltip: { enabled: false },
            },
          },
        })
      );
    }

    if (radarCanvasRef.current) {
      charts.push(
        new Chart(radarCanvasRef.current, {
          type: 'radar',
          data: {
            labels: ['Relevance', 'Depth', 'Clarity', 'Structure', 'Confidence'],
            datasets: [
              {
                label: 'Average Rating (0–10)',
                data: [
                  axisAverages.relevance,
                  axisAverages.depth,
                  axisAverages.clarity,
                  axisAverages.structure,
                  axisAverages.confidence,
                ],
                backgroundColor: 'rgba(37, 99, 235, 0.14)',
                borderColor: '#2563EB',
                borderWidth: 2,
                pointBackgroundColor: '#2563EB',
                pointRadius: 3.5,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              r: {
                min: 0,
                max: 10,
                ticks: { stepSize: 2, backdropColor: 'transparent' },
                grid: { color: '#E2E8F0' },
                angleLines: { color: '#E2E8F0' },
                pointLabels: {
                  color: '#334155',
                  font: { size: 12, weight: 600 },
                },
              },
            },
            plugins: {
              legend: { display: false },
            },
          },
        })
      );
    }

    if (barCanvasRef.current) {
      const labels = result.attempts.map((_, i) => `Q${i + 1}`);
      const values = result.attempts.map((a) => a.compositeScore);
      const colors = result.attempts.map((a) => {
        if (a.skipped) return '#CBD5E1';
        if (a.compositeScore >= 80) return '#16A34A';
        if (a.compositeScore >= 65) return '#2563EB';
        if (a.compositeScore >= 50) return '#D97706';
        return '#DC2626';
      });

      charts.push(
        new Chart(barCanvasRef.current, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              {
                label: 'Question Score',
                data: values,
                backgroundColor: colors,
                borderRadius: 6,
                maxBarThickness: 42,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                min: 0,
                max: 100,
                grid: { color: '#F1F5F9' },
              },
              x: {
                grid: { display: false },
              },
            },
            plugins: {
              legend: { display: false },
            },
          },
        })
      );
    }

    if (eyeLineCanvasRef.current && visionAttempts.length > 0) {
      charts.push(
        new Chart(eyeLineCanvasRef.current, {
          type: 'line',
          data: {
            labels: visionAttempts.map((_, idx) => `Q${idx + 1}`),
            datasets: [
              {
                label: 'Eye Contact %',
                data: visionAttempts.map(
                  (a) => a.visionSummary?.eyeContactPct ?? 0
                ),
                borderColor: '#2563EB',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                fill: true,
                tension: 0.3,
                pointRadius: 4,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: { min: 0, max: 100, grid: { color: '#F1F5F9' } },
              x: { grid: { display: false } },
            },
            plugins: {
              legend: { display: false },
            },
          },
        })
      );
    }

    return () => {
      charts.forEach((c) => c.destroy());
      stopSpeaking();
    };
  }, [
    axisAverages,
    result.attempts,
    result.overallScore,
    verdictStyle.accentHex,
    visionAttempts,
  ]);

  const toggleIdealAudio = (questionId: string, text: string) => {
    if (speakingQuestionId === questionId) {
      stopSpeaking();
      setSpeakingQuestionId(null);
      return;
    }
    speakText(text, {
      voiceURI: result.config.selectedVoiceURI,
      pitch: persona.voicePitch,
      rate: persona.voiceRate,
      onStart: () => setSpeakingQuestionId(questionId),
      onEnd: () => setSpeakingQuestionId(null),
    });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Summary Hero & Action Bar */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 print-flat-card">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            {/* Doughnut Gauge */}
            <div className="relative w-32 h-32 shrink-0">
              <canvas ref={gaugeCanvasRef} aria-label={`Overall score ${result.overallScore} out of 100`} />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                  {result.overallScore}
                </span>
                <span className="text-[11px] text-slate-500 font-medium">
                  out of 100
                </span>
              </div>
            </div>

            <div className="space-y-2 max-w-xl">
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 font-semibold border rounded-md ${verdictStyle.bg} ${verdictStyle.text} ${verdictStyle.border}`}
                >
                  {result.summary.verdict}
                </span>
                <span aria-hidden="true">·</span>
                <span>{result.effectiveRole}</span>
                <span aria-hidden="true">·</span>
                <span>{result.config.level}</span>
                <span aria-hidden="true">·</span>
                <span>{persona.name} ({persona.title})</span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight text-balance">
                {result.summary.headline}
              </h1>

              <p className="text-sm text-slate-600">
                {result.summary.closing_line}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0 no-print">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
              Download report
            </button>
            <button
              type="button"
              onClick={onRetrySame}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Retry same interview
            </button>
            <button
              type="button"
              onClick={onNewInterview}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New interview
            </button>
          </div>
        </div>
      </section>

      {/* Radar & Bar Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 print-break-inside-avoid print-flat-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              Competency Rubric Profile
            </h2>
            <span className="text-xs text-slate-500">Average 0–10 per axis</span>
          </div>
          <div className="h-64 w-full">
            <canvas ref={radarCanvasRef} />
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 print-break-inside-avoid print-flat-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              Question-by-Question Scores
            </h2>
            <span className="text-xs text-slate-500">
              Composite score (0–100)
            </span>
          </div>
          <div className="h-64 w-full">
            <canvas ref={barCanvasRef} />
          </div>
        </section>
      </div>

      {/* 4 Telemetry & Behavioral Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Voice Delivery Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 print-break-inside-avoid print-flat-card">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
              <Mic className="w-4 h-4 text-blue-600" />
              Voice &amp; Pacing Delivery
            </div>
            <span className="text-xs text-slate-500">Ideal: 120–160 WPM</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-slate-500">Speaking Pace</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {voiceStats.avgWpm} WPM
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-slate-500">Avg Length</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {voiceStats.avgDuration}s · {voiceStats.avgWords}w
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-slate-500">Voice vs Typed</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {voiceStats.voicePct}% / {voiceStats.typedPct}%
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Top filler words: </span>
            {voiceStats.topFillers.length > 0
              ? voiceStats.topFillers
                  .map(([w, c]) => `"${w}" (${c}x)`)
                  .join(' · ')
              : 'None detected — clean vocal delivery'}
          </div>
        </section>

        {/* STAR Method Tracker */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 print-break-inside-avoid print-flat-card">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-base font-semibold text-slate-900">
              STAR Method Coverage
            </h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {starStats.count} behavioral prompt{starStats.count === 1 ? '' : 's'}
            </span>
          </div>

          {starStats.count === 0 ? (
            <p className="text-xs text-slate-500 py-4">
              No behavioral questions were evaluated in this session. Select Behavioral or Mixed mode to track STAR coverage.
            </p>
          ) : (
            <div className="space-y-3">
              {(
                [
                  ['Situation', starStats.situation],
                  ['Task', starStats.task],
                  ['Action', starStats.action],
                  ['Result', starStats.result],
                ] as const
              ).map(([label, pct]) => (
                <div key={label} className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-700">{label}</span>
                    <span className="font-mono tabular-nums text-slate-900">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        pct >= 75
                          ? 'bg-emerald-600'
                          : pct >= 50
                          ? 'bg-blue-600'
                          : 'bg-amber-600'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* MediaPipe Presence Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 print-break-inside-avoid print-flat-card">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
              <Eye className="w-4 h-4 text-blue-600" />
              Body Language &amp; Presence
            </div>
            {result.overallPresenceScore !== null && (
              <span className="text-sm font-bold font-mono tabular-nums text-blue-600">
                {result.overallPresenceScore}/100
              </span>
            )}
          </div>

          {result.overallPresenceScore === null ? (
            <p className="text-xs text-slate-500 py-4">
              Webcam Vision Coach was disabled or camera frames were unavailable during this session.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Eye Contact</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {result.overallEyeContactPct ?? 0}%
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Smile Rate</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {result.overallSmilePct ?? 0}%
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Head Stability</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {result.overallHeadStability ?? 0}/100
                  </div>
                </div>
              </div>

              {visionAttempts.length > 0 && (
                <div className="h-32 w-full">
                  <canvas ref={eyeLineCanvasRef} />
                </div>
              )}

              {result.summary.body_language_tip && (
                <p className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">Coach tip: </span>
                  {result.summary.body_language_tip}
                </p>
              )}
            </>
          )}
        </section>

        {/* Job-Fit Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 print-break-inside-avoid print-flat-card">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
              <Target className="w-4 h-4 text-blue-600" />
              Role &amp; Job-Fit Coverage
            </div>
            <span className="text-sm font-bold font-mono tabular-nums text-slate-900">
              {jobFit.matchPct}% Match
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="font-semibold text-emerald-800 mb-1">
                Demonstrated Skills ({jobFit.demonstratedList.length})
              </div>
              <p className="text-slate-700">
                {jobFit.demonstratedList.length > 0
                  ? jobFit.demonstratedList.join(' · ')
                  : 'None explicitly surfaced in transcripts yet.'}
              </p>
            </div>

            <div>
              <div className="font-semibold text-slate-700 mb-1">
                Missed Target Skills ({jobFit.missedList.length})
              </div>
              <p className="text-slate-500">
                {jobFit.missedList.length > 0
                  ? jobFit.missedList.join(' · ')
                  : 'Covered all target skills!'}
              </p>
            </div>

            {result.summary.resume_highlights_to_mention.length > 0 && (
              <div className="pt-2 border-t border-slate-100">
                <div className="font-semibold text-slate-800 mb-1">
                  Resume Highlights Worth Surfacing
                </div>
                <ul className="list-disc pl-4 space-y-1 text-slate-600">
                  {result.summary.resume_highlights_to_mention.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Follow-up Insights + Strengths vs Weaknesses */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 print-break-inside-avoid print-flat-card">
          <h2 className="text-base font-semibold text-slate-900">
            Adaptive Follow-Up Insight
          </h2>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {followUpAttempts.length} Triggered
          </p>
          {followUpAttempts.length === 0 ? (
            <p className="text-xs text-slate-600">
              No follow-up probes were required—your primary responses met depth and evidence thresholds.
            </p>
          ) : (
            <ul className="space-y-2 text-xs text-slate-600">
              {followUpAttempts.map((a, idx) => (
                <li key={idx}>
                  <span className="font-semibold text-slate-800">
                    {a.question.id.toUpperCase()}:{' '}
                  </span>
                  {a.followUpReason || 'Probed for concrete evidence and metrics.'}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 print-break-inside-avoid print-flat-card">
          <h2 className="text-base font-semibold text-emerald-800">
            Top Strengths
          </h2>
          <ul className="space-y-2 text-sm text-slate-700 list-disc pl-4">
            {result.summary.top_strengths.map((s, idx) => (
              <li key={idx}>{s}</li>
            ))}
          </ul>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 print-break-inside-avoid print-flat-card">
          <h2 className="text-base font-semibold text-amber-800">
            Priority Gaps
          </h2>
          <ul className="space-y-2 text-sm text-slate-700 list-disc pl-4">
            {result.summary.top_weaknesses.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </section>
      </div>

      {/* 3-Step Improvement Plan & Practice Prompts */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 print-break-inside-avoid print-flat-card">
        <h2 className="text-lg font-semibold text-slate-900">
          3-Step Coaching Action Plan
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {result.summary.improvement_plan.map((item, idx) => (
            <div
              key={idx}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2"
            >
              <div className="text-xs font-mono font-semibold text-blue-700">
                Step 0{idx + 1}
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {item.step}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {item.exercise}
              </p>
            </div>
          ))}
        </div>

        {result.summary.practice_questions.length > 0 && (
          <div className="pt-4 border-t border-slate-100 space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Recommended Drill Prompts
            </h3>
            <ul className="list-disc pl-5 text-xs text-slate-700 space-y-1">
              {result.summary.practice_questions.map((pq, i) => (
                <li key={i}>{pq}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Question-by-Question Review Accordion */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Question-by-Question Transcript &amp; Rubric Review
        </h2>

        <div className="space-y-3">
          {result.attempts.map((attempt, idx) => {
            const isOpen = Boolean(expandedIds[attempt.question.id]);
            const isIdealSpeaking = speakingQuestionId === attempt.question.id;

            return (
              <div
                key={attempt.question.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden print-break-inside-avoid print-flat-card"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedIds((prev) => ({
                      ...prev,
                      [attempt.question.id]: !prev[attempt.question.id],
                    }))
                  }
                  aria-expanded={isOpen}
                  className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-50/70 transition-colors cursor-pointer"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-900">
                        Q{idx + 1}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{attempt.question.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{attempt.question.difficulty}</span>
                      {attempt.skipped && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-red-600 font-medium">Skipped</span>
                        </>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      {attempt.question.question}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-base font-bold font-mono tabular-nums text-slate-900">
                      {attempt.compositeScore}/100
                    </span>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-500 no-print" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500 no-print" />
                    )}
                  </div>
                </button>

                <div
                  className={`px-6 pb-6 pt-3 border-t border-slate-100 space-y-5 print-accordion-content ${
                    isOpen ? 'block' : 'hidden'
                  }`}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-700 mb-1">
                          Your Transcript
                        </div>
                        <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 leading-relaxed whitespace-pre-wrap">
                          {attempt.combinedAnswer || 'Question skipped.'}
                        </p>
                      </div>

                      {attempt.followUpQuestion && (
                        <div className="text-xs text-slate-600">
                          <span className="font-semibold text-amber-800">
                            Follow-up Asked:{' '}
                          </span>
                          {attempt.followUpQuestion}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      {attempt.evaluation &&
                        attempt.evaluation.rubric_coverage.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-slate-700 mb-1.5">
                              Rubric Coverage
                            </div>
                            <ul className="space-y-1.5 text-xs">
                              {attempt.evaluation.rubric_coverage.map((r, rIdx) => (
                                <li
                                  key={rIdx}
                                  className="flex items-start gap-2 text-slate-700"
                                >
                                  {r.covered ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                                  ) : (
                                    <XCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                                  )}
                                  <span>{r.point}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                    </div>
                  </div>

                  {attempt.evaluation && !attempt.skipped && (
                    <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-200 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-blue-900">
                          Model Ideal Answer
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            toggleIdealAudio(
                              attempt.question.id,
                              attempt.evaluation!.ideal_answer
                            )
                          }
                          className="no-print inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded-md hover:bg-blue-50 cursor-pointer"
                        >
                          {isIdealSpeaking ? (
                            <>
                              <VolumeX className="w-3.5 h-3.5" />
                              Stop Audio
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3.5 h-3.5" />
                              Play Ideal Answer
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-slate-800 leading-relaxed">
                        {attempt.evaluation.ideal_answer}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
