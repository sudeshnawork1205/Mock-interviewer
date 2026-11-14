import type { InterviewSessionResult } from '../types/interview';

const HISTORY_STORAGE_KEY = 'interviewace_session_history';
const MAX_SESSIONS = 8;

export function loadSessionHistory(): InterviewSessionResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InterviewSessionResult[]) : [];
  } catch {
    return [];
  }
}

export function saveSessionToHistory(
  session: InterviewSessionResult
): InterviewSessionResult[] {
  const existing = loadSessionHistory();
  // Store lightweight copy without huge raw resume text
  const sanitized: InterviewSessionResult = {
    ...session,
    config: {
      ...session.config,
      apiKey: '',
      resume: session.config.resume
        ? { ...session.config.resume, rawText: '' }
        : null,
      jd: { ...session.config.jd, rawText: '' },
    },
  };
  const updated = [sanitized, ...existing].slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore quota errors
  }
  return updated;
}

export function clearSessionHistory(): void {
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // ignore
  }
}
