import {
  computeCompositeScore,
  type CallAResponse,
  type CallBResponse,
  type CallCResponse,
  type InterviewQuestion,
  type InterviewSetupConfig,
  type QuestionAttempt,
} from '../types/interview';
import {
  evaluateDemoAnswer,
  generateDemoQuestions,
  generateDemoSummary,
} from './demoEngine';

export const API_KEY_STORAGE_KEY = 'interviewace_gemini_api_key';

export function loadStoredApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function persistApiKey(key: string, remember: boolean): void {
  try {
    if (remember && key.trim()) {
      localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function stripMarkdownCodeblocks(raw: string): string {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

export function safeParseJson<T>(rawText: string): T {
  const cleaned = stripMarkdownCodeblocks(rawText);
  return JSON.parse(cleaned) as T;
}

async function postWithRetry<T>(
  url: string,
  payload: unknown,
  apiKey: string,
  retries = 1
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 14500);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey.trim()) {
        headers['x-gemini-api-key'] = apiKey.trim();
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok) {
        const msg =
          typeof data?.error === 'string'
            ? data.error
            : `Server responded with status ${res.status}`;
        const err = new Error(msg) as Error & { noRetry?: boolean };
        if (res.status >= 400 && res.status < 500) {
          err.noRetry = true;
        }
        throw err;
      }

      if (typeof data?.rawText === 'string') {
        return safeParseJson<T>(data.rawText);
      }
      return data as T;
    } catch (err) {
      lastError =
        err instanceof Error && err.name === 'AbortError'
          ? new Error('Request timed out. Retry or use Demo Mode.')
          : err instanceof Error
          ? err
          : new Error(String(err));
      const noRetry = (err as Error & { noRetry?: boolean })?.noRetry;
      if (noRetry || attempt >= retries) {
        break;
      }
      const delayMs = 450 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('Gemini API request failed');
}

export async function checkServerKeyStatus(): Promise<{ hasServerKey: boolean }> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { hasServerKey: false };
    return (await res.json()) as { hasServerKey: boolean };
  } catch {
    return { hasServerKey: false };
  }
}

export interface ApiResult<T> {
  data: T;
  usedFallback: boolean;
  errorMessage?: string;
}

export async function fetchInterviewQuestions(
  config: InterviewSetupConfig,
  options: { allowFallbackOnError?: boolean } = {}
): Promise<ApiResult<CallAResponse>> {
  if (config.demoMode) {
    return { data: generateDemoQuestions(config), usedFallback: true };
  }

  try {
    const effectiveRole =
      config.role === 'Other' ? config.customRole.trim() || 'Generalist' : config.role;

    const data = await postWithRetry<CallAResponse>(
      '/api/gemini/questions',
      {
        role: effectiveRole,
        level: config.level,
        mode: config.mode,
        questionCount: config.questionCount,
        persona: config.persona,
        resumeText: config.resume?.rawText ?? '',
        resumeSkills: config.resume?.skills ?? [],
        jdText: config.jd.rawText,
        jdSkills: config.jd.extractedSkills,
      },
      config.apiKey,
      0
    );

    if (!data?.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('Invalid question array returned by Gemini.');
    }

    return { data, usedFallback: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to generate questions.';
    if (options.allowFallbackOnError) {
      return {
        data: generateDemoQuestions(config),
        usedFallback: true,
        errorMessage,
      };
    }
    throw err;
  }
}

export async function evaluateCandidateAnswer(
  config: InterviewSetupConfig,
  question: InterviewQuestion,
  answerText: string,
  jdSkills: string[],
  isFollowUpEvaluation: boolean,
  options: { allowFallbackOnError?: boolean } = {}
): Promise<ApiResult<CallBResponse>> {
  if (config.demoMode) {
    return {
      data: evaluateDemoAnswer(config, question, answerText, jdSkills, isFollowUpEvaluation),
      usedFallback: true,
    };
  }

  try {
    const effectiveRole =
      config.role === 'Other' ? config.customRole.trim() || 'Generalist' : config.role;

    const data = await postWithRetry<CallBResponse>(
      '/api/gemini/evaluate',
      {
        role: effectiveRole,
        level: config.level,
        persona: config.persona,
        followUpsEnabled: config.followUpsEnabled && !isFollowUpEvaluation,
        question,
        answerText,
        jdSkills,
      },
      config.apiKey,
      1
    );

    if (!data?.scores || typeof data.scores.relevance !== 'number') {
      throw new Error('Malformed evaluation schema returned by Gemini.');
    }

    // Ensure composite calculation integrity & follow-up gate constraints
    if (isFollowUpEvaluation || !config.followUpsEnabled) {
      data.needs_follow_up = false;
      data.follow_up_question = null;
    }

    return { data, usedFallback: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to evaluate answer.';
    if (options.allowFallbackOnError) {
      return {
        data: evaluateDemoAnswer(config, question, answerText, jdSkills, isFollowUpEvaluation),
        usedFallback: true,
        errorMessage,
      };
    }
    throw err;
  }
}

export async function fetchFinalCoachingSummary(
  config: InterviewSetupConfig,
  attempts: QuestionAttempt[],
  jdSkills: string[],
  overallPresenceScore: number | null
): Promise<ApiResult<CallCResponse>> {
  if (config.demoMode) {
    return {
      data: generateDemoSummary(config, attempts, jdSkills, overallPresenceScore),
      usedFallback: true,
    };
  }

  try {
    const effectiveRole =
      config.role === 'Other' ? config.customRole.trim() || 'Generalist' : config.role;

    const scoredAttempts = attempts.map((a) => ({
      question: a.question.question,
      category: a.question.category,
      source: a.question.source,
      skipped: a.skipped,
      answer: a.combinedAnswer,
      compositeScore: a.compositeScore,
      scores: a.evaluation?.scores ?? null,
      star: a.evaluation?.star ?? null,
      wpm: a.voiceMetrics.wpm,
      totalFillers: a.voiceMetrics.totalFillers,
      eyeContactPct: a.visionSummary?.eyeContactPct ?? null,
      presenceScore: a.visionSummary?.presenceScore ?? null,
    }));

    const data = await postWithRetry<CallCResponse>(
      '/api/gemini/summary',
      {
        role: effectiveRole,
        level: config.level,
        mode: config.mode,
        persona: config.persona,
        jdSkills,
        resumeHighlights: config.resume?.highlights ?? [],
        overallPresenceScore,
        attempts: scoredAttempts,
      },
      config.apiKey,
      1
    );

    if (!data?.verdict || !Array.isArray(data.improvement_plan)) {
      throw new Error('Malformed coaching summary schema returned by Gemini.');
    }

    return { data, usedFallback: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to synthesize summary.';
    return {
      data: generateDemoSummary(config, attempts, jdSkills, overallPresenceScore),
      usedFallback: true,
      errorMessage,
    };
  }
}

export { computeCompositeScore };
