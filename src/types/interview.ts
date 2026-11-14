export type AppScreen = 'setup' | 'live' | 'dashboard';

export type RoleOption =
  | 'Software Engineer'
  | 'Product Manager'
  | 'Data Analyst'
  | 'QA Engineer'
  | 'UI/UX Designer'
  | 'HR'
  | 'Sales'
  | 'Marketing'
  | 'Other';

export type ExperienceLevel = 'Fresher' | 'Mid-level' | 'Senior';
export type InterviewMode = 'Technical' | 'Behavioral' | 'Mixed';
export type QuestionVolume = 3 | 5 | 7;
export type PersonaId = 'friendly_hr' | 'strict_tech' | 'pressure_ceo';

export interface PersonaConfig {
  id: PersonaId;
  name: string;
  title: string;
  subtitle: string;
  difficultyBand: string;
  description: string;
  voicePitch: number;
  voiceRate: number;
  bridgePhrases: string[];
  systemDirective: string;
}

export const PERSONAS: Record<PersonaId, PersonaConfig> = {
  friendly_hr: {
    id: 'friendly_hr',
    name: 'Priya',
    title: 'Friendly HR',
    subtitle: 'Warm & Encouraging',
    difficultyBand: 'Easy – Medium',
    description: 'Supportive pacing, gentle follow-ups, and constructive feedback that leads with what went well.',
    voicePitch: 1.08,
    voiceRate: 0.96,
    bridgePhrases: [
      'Thank you for sharing that — could I ask one quick follow-up to understand a bit more?',
      'That gives me good context. Let me ask one clarifying question before we move on.',
    ],
    systemDirective:
      'You are Priya, a warm HR manager. Encouraging, patient, uses the candidate\'s name. Questions Easy–Medium. Feedback starts with what went well.',
  },
  strict_tech: {
    id: 'strict_tech',
    name: 'Arjun',
    title: 'Strict Tech Lead',
    subtitle: 'Precise & Depth-Focused',
    difficultyBand: 'Medium – Hard',
    description: 'Probes for system trade-offs, edge cases, and root-cause reasoning with blunt, fair critiques.',
    voicePitch: 0.94,
    voiceRate: 1.02,
    bridgePhrases: [
      'Interesting, let me dig into that. Walk me through the exact trade-off there.',
      'Hold on — I want to press on the technical details of that decision.',
    ],
    systemDirective:
      'You are Arjun, a no-nonsense tech lead. Precise and direct, probes for depth, trade-offs and \'why\'. Questions Medium–Hard. Feedback is blunt but fair.',
  },
  pressure_ceo: {
    id: 'pressure_ceo',
    name: 'Meera',
    title: 'Pressure CEO',
    subtitle: 'Fast-Paced & Executive',
    difficultyBand: 'Hard',
    description: 'Challenges assumptions, demands measurable business impact, and flags vague claims immediately.',
    voicePitch: 1.0,
    voiceRate: 1.12,
    bridgePhrases: [
      'Stop right there — give me the concrete outcome and what you personally owned.',
      'That sounds high-level. Narrow it down: what changed because of your action?',
    ],
    systemDirective:
      'You are Meera, a busy startup CEO. Fast-paced, challenges assumptions, interrupts vague answers with sharp follow-ups, asks about impact and ownership. Questions Hard.',
  },
};

export interface ResumeData {
  fileName: string;
  rawText: string;
  wordCount: number;
  skills: string[];
  highlights: string[];
  candidateName: string | null;
}

export interface JobDescriptionData {
  rawText: string;
  targetTitle: string | null;
  companyName: string | null;
  extractedSkills: string[];
}

export interface InterviewSetupConfig {
  role: RoleOption;
  customRole: string;
  level: ExperienceLevel;
  mode: InterviewMode;
  questionCount: QuestionVolume;
  persona: PersonaId;
  followUpsEnabled: boolean;
  webcamCoachEnabled: boolean;
  selectedVoiceURI: string;
  apiKey: string;
  rememberApiKey: boolean;
  demoMode: boolean;
  resume: ResumeData | null;
  jd: JobDescriptionData;
}

export type QuestionSource = 'general' | 'resume' | 'jd';
export type DifficultyLevel = 'Easy' | 'Medium' | 'Hard';

export interface InterviewQuestion {
  id: string;
  question: string;
  category: string;
  competency: string;
  difficulty: DifficultyLevel;
  source: QuestionSource;
  rubric: string[];
  ideal_duration_seconds: number;
}

export interface CallAResponse {
  candidate_name: string | null;
  jd_skills: string[];
  questions: InterviewQuestion[];
}

export interface ScoreBreakdown {
  relevance: number;
  depth: number;
  clarity: number;
  structure: number;
  confidence: number;
}

export interface RubricCoverageItem {
  point: string;
  covered: boolean;
}

export interface StarAnalysis {
  applicable: boolean;
  situation: boolean;
  task: boolean;
  action: boolean;
  result: boolean;
}

export interface CallBResponse {
  scores: ScoreBreakdown;
  rubric_coverage: RubricCoverageItem[];
  star: StarAnalysis;
  strengths: string[];
  improvements: string[];
  needs_follow_up: boolean;
  follow_up_question: string | null;
  follow_up_reason: string | null;
  jd_skills_demonstrated: string[];
  spoken_feedback: string;
  ideal_answer: string;
}

export type VerdictLabel =
  | 'Interview Ready'
  | 'Almost There'
  | 'Needs Practice'
  | 'Keep Building';

export interface ImprovementStep {
  step: string;
  exercise: string;
}

export interface CallCResponse {
  verdict: VerdictLabel;
  headline: string;
  top_strengths: string[];
  top_weaknesses: string[];
  improvement_plan: ImprovementStep[];
  practice_questions: string[];
  resume_highlights_to_mention: string[];
  body_language_tip: string | null;
  closing_line: string;
}

export interface VoiceMetrics {
  durationSeconds: number;
  wordCount: number;
  wpm: number;
  fillerCounts: Record<string, number>;
  totalFillers: number;
  voiceWordCount: number;
  typedWordCount: number;
}

export type EyeContactState = 'good' | 'fair' | 'poor' | 'no_face';

export interface VisionFrameSample {
  timestamp: number;
  faceDetected: boolean;
  yawDeg: number;
  pitchDeg: number;
  eyeContact: boolean;
  smileScore: number;
  noseX: number;
  noseY: number;
}

export interface QuestionVisionSummary {
  questionId: string;
  sampleCount: number;
  faceDetectedCount: number;
  eyeContactPct: number;
  smilePct: number;
  headStabilityScore: number;
  presenceScore: number;
}

export interface QuestionAttempt {
  question: InterviewQuestion;
  skipped: boolean;
  primaryAnswer: string;
  followUpQuestion: string | null;
  followUpReason: string | null;
  followUpAnswer: string | null;
  combinedAnswer: string;
  evaluation: CallBResponse | null;
  compositeScore: number;
  voiceMetrics: VoiceMetrics;
  visionSummary: QuestionVisionSummary | null;
}

export interface InterviewSessionResult {
  config: InterviewSetupConfig;
  effectiveRole: string;
  candidateName: string | null;
  jdSkills: string[];
  attempts: QuestionAttempt[];
  overallScore: number;
  overallPresenceScore: number | null;
  overallEyeContactPct: number | null;
  overallSmilePct: number | null;
  overallHeadStability: number | null;
  summary: CallCResponse;
  usedFallbackCount: number;
  completedAt: string;
}

export const FILLER_WORDS = [
  'you know',
  'kind of',
  'sort of',
  'so yeah',
  'basically',
  'actually',
  'literally',
  'like',
  'um',
  'uh',
];

export function computeCompositeScore(scores: ScoreBreakdown): number {
  const raw =
    (scores.relevance * 0.25 +
      scores.depth * 0.25 +
      scores.clarity * 0.2 +
      scores.structure * 0.15 +
      scores.confidence * 0.15) *
    10;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export function getVerdictFromScore(score: number): VerdictLabel {
  if (score >= 80) return 'Interview Ready';
  if (score >= 65) return 'Almost There';
  if (score >= 50) return 'Needs Practice';
  return 'Keep Building';
}

export function analyzeFillerWords(text: string): {
  counts: Record<string, number>;
  total: number;
} {
  const lower = text.toLowerCase();
  const counts: Record<string, number> = {};
  let total = 0;

  for (const filler of FILLER_WORDS) {
    const escaped = filler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = lower.match(regex);
    if (matches && matches.length > 0) {
      counts[filler] = matches.length;
      total += matches.length;
    }
  }
  return { counts, total };
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
