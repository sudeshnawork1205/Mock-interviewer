import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_ID = 'gemini-4-hydrogen';

const PERSONA_DIRECTIVES: Record<string, string> = {
  friendly_hr:
    "You are Priya, a warm HR manager. Encouraging, patient, uses the candidate's name. Questions Easy–Medium. Feedback starts with what went well.",
  strict_tech:
    "You are Arjun, a no-nonsense tech lead. Precise and direct, probes for depth, trade-offs and 'why'. Questions Medium–Hard. Feedback is blunt but fair.",
  pressure_ceo:
    'You are Meera, a busy startup CEO. Fast-paced, challenges assumptions, interrupts vague answers with sharp follow-ups, asks about impact and ownership. Questions Hard.',
};

function getClient(req: express.Request): GoogleGenAI {
  const headerKey = req.header('x-gemini-api-key')?.trim();
  const apiKey = headerKey || process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      'No Gemini API key provided. Enter your Gemini API key in Setup or switch on Demo Mode.'
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function stripMarkdownFences(raw: string): string {
  let text = raw.trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (match) {
    text = match[1].trim();
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
  return text;
}

function formatApiError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('No Gemini API key')) {
    return { status: 400, message: msg };
  }
  if (/API_KEY_INVALID|400|invalid.*key/i.test(msg)) {
    return {
      status: 400,
      message: 'The Gemini API key appears invalid. Verify your key or enable Demo Mode.',
    };
  }
  if (/PERMISSION_DENIED|403/i.test(msg)) {
    return {
      status: 403,
      message: 'Permission denied by Gemini API. Check API key permissions or billing.',
    };
  }
  if (/RESOURCE_EXHAUSTED|429/i.test(msg)) {
    return {
      status: 429,
      message: 'Gemini API rate limit or quota exceeded. Wait briefly, retry, or use Demo Mode.',
    };
  }
  return { status: 500, message: msg || 'Unexpected error calling Gemini API.' };
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasServerKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
    });
  });

  // Call A: Question Generation
  app.post('/api/gemini/questions', async (req, res) => {
    try {
      const ai = getClient(req);
      const {
        role,
        level,
        mode,
        questionCount,
        persona,
        resumeText,
        resumeSkills,
        jdText,
        jdSkills,
      } = req.body as {
        role: string;
        level: string;
        mode: string;
        questionCount: number;
        persona: string;
        resumeText: string;
        resumeSkills: string[];
        jdText: string;
        jdSkills: string[];
      };

      const personaDirective =
        PERSONA_DIRECTIVES[persona] ?? PERSONA_DIRECTIVES.strict_tech;

      const hasResume = Boolean(resumeText && resumeText.trim().length > 20);
      const hasJd = Boolean(jdText && jdText.trim().length > 20);

      const prompt = `Generate exactly ${questionCount} realistic mock interview questions for a ${level} ${role} candidate in ${mode} interview mode.

Rules:
1. ${
        hasResume
          ? 'At least 40% of questions MUST target specific projects, skills, or experience from the provided resume and be tagged source="resume".'
          : 'No resume was provided; do not use source="resume".'
      }
2. ${
        hasJd
          ? 'At least 40% of questions MUST test core requirements from the job description and be tagged source="jd". Extract 6-8 core required skills into jd_skills.'
          : 'Extract 6 core industry skills for this role into jd_skills.'
      }
3. Keep each spoken question under 35 words (optimized for text-to-speech). No bullet points or code blocks.
4. Provide 3-4 concise hidden evaluation rubric points per question.
5. Tag each question source as "general", "resume", or "jd", and difficulty as "Easy", "Medium", or "Hard".

Candidate Resume Context:
${hasResume ? resumeText.slice(0, 5000) : 'None provided.'}
Detected Resume Skills: ${(resumeSkills || []).join(', ') || 'None'}

Job Description Context:
${hasJd ? jdText.slice(0, 4000) : 'None provided.'}
Detected JD Skills: ${(jdSkills || []).join(', ') || 'None'}`;

      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: prompt,
        config: {
          systemInstruction: `${personaDirective}\nYou are a senior hiring manager designing structured interview questions. Return strictly valid JSON matching the schema.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              candidate_name: { type: Type.STRING, nullable: true },
              jd_skills: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    question: { type: Type.STRING },
                    category: { type: Type.STRING },
                    competency: { type: Type.STRING },
                    difficulty: { type: Type.STRING },
                    source: { type: Type.STRING },
                    rubric: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    ideal_duration_seconds: { type: Type.INTEGER },
                  },
                  required: [
                    'id',
                    'question',
                    'category',
                    'competency',
                    'difficulty',
                    'source',
                    'rubric',
                    'ideal_duration_seconds',
                  ],
                },
              },
            },
            required: ['jd_skills', 'questions'],
          },
        },
      });

      const rawText = response.text ?? '';
      const parsed = JSON.parse(stripMarkdownFences(rawText));
      res.json(parsed);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Call B: Answer Evaluation & Adaptive Follow-Up Gate
  app.post('/api/gemini/evaluate', async (req, res) => {
    try {
      const ai = getClient(req);
      const {
        role,
        level,
        persona,
        followUpsEnabled,
        question,
        answerText,
        jdSkills,
      } = req.body as {
        role: string;
        level: string;
        persona: string;
        followUpsEnabled: boolean;
        question: {
          id: string;
          question: string;
          category: string;
          competency: string;
          rubric: string[];
        };
        answerText: string;
        jdSkills: string[];
      };

      const personaDirective =
        PERSONA_DIRECTIVES[persona] ?? PERSONA_DIRECTIVES.strict_tech;

      const prompt = `Evaluate this ${level} ${role} candidate's interview response.

Question (${question.category} · ${question.competency}):
"${question.question}"

Evaluation Rubric Points:
${question.rubric.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Target JD Skills: ${(jdSkills || []).join(', ') || role}

Candidate Answer Transcript:
"${answerText}"

Evaluation Rules:
- Judge meaning and substance; NEVER penalize speech-to-text typos or minor grammar artifacts.
- Score each metric from 0 to 10 (Anchors: 2=Poor, 5=Average, 8=Strong, 10=Exceptional).
- ${
        followUpsEnabled
          ? 'Set needs_follow_up=true if the answer is vague, lacks concrete evidence, misses key rubric points, or omits a STAR Result on behavioral questions. If true, write a sharp follow_up_question under 25 words in your persona voice.'
          : 'Follow-ups are disabled for this turn: set needs_follow_up=false, follow_up_question=null, follow_up_reason=null.'
      }
- Write spoken_feedback under 30 words in your persona voice.
- Write ideal_answer in first-person ("I...") between 90 and 130 words showing a model response.`;

      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: prompt,
        config: {
          systemInstruction: `${personaDirective}\nYou are a fair, experienced interview coach evaluating a candidate response. Return strictly valid JSON matching the schema.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scores: {
                type: Type.OBJECT,
                properties: {
                  relevance: { type: Type.NUMBER },
                  depth: { type: Type.NUMBER },
                  clarity: { type: Type.NUMBER },
                  structure: { type: Type.NUMBER },
                  confidence: { type: Type.NUMBER },
                },
                required: ['relevance', 'depth', 'clarity', 'structure', 'confidence'],
              },
              rubric_coverage: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    point: { type: Type.STRING },
                    covered: { type: Type.BOOLEAN },
                  },
                  required: ['point', 'covered'],
                },
              },
              star: {
                type: Type.OBJECT,
                properties: {
                  applicable: { type: Type.BOOLEAN },
                  situation: { type: Type.BOOLEAN },
                  task: { type: Type.BOOLEAN },
                  action: { type: Type.BOOLEAN },
                  result: { type: Type.BOOLEAN },
                },
                required: ['applicable', 'situation', 'task', 'action', 'result'],
              },
              strengths: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              improvements: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              needs_follow_up: { type: Type.BOOLEAN },
              follow_up_question: { type: Type.STRING, nullable: true },
              follow_up_reason: { type: Type.STRING, nullable: true },
              jd_skills_demonstrated: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              spoken_feedback: { type: Type.STRING },
              ideal_answer: { type: Type.STRING },
            },
            required: [
              'scores',
              'rubric_coverage',
              'star',
              'strengths',
              'improvements',
              'needs_follow_up',
              'jd_skills_demonstrated',
              'spoken_feedback',
              'ideal_answer',
            ],
          },
        },
      });

      const rawText = response.text ?? '';
      const parsed = JSON.parse(stripMarkdownFences(rawText));
      res.json(parsed);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Call C: Final Coaching Summary
  app.post('/api/gemini/summary', async (req, res) => {
    try {
      const ai = getClient(req);
      const {
        role,
        level,
        mode,
        persona,
        jdSkills,
        resumeHighlights,
        overallPresenceScore,
        attempts,
      } = req.body as {
        role: string;
        level: string;
        mode: string;
        persona: string;
        jdSkills: string[];
        resumeHighlights: string[];
        overallPresenceScore: number | null;
        attempts: Array<{
          question: string;
          category: string;
          source: string;
          skipped: boolean;
          answer: string;
          compositeScore: number;
          wpm: number;
          totalFillers: number;
          eyeContactPct: number | null;
          presenceScore: number | null;
        }>;
      };

      const personaDirective =
        PERSONA_DIRECTIVES[persona] ?? PERSONA_DIRECTIVES.strict_tech;

      const avgScore =
        attempts.length > 0
          ? Math.round(
              attempts.reduce((s, a) => s + a.compositeScore, 0) / attempts.length
            )
          : 0;

      const verdictHint =
        avgScore >= 80
          ? 'Interview Ready'
          : avgScore >= 65
          ? 'Almost There'
          : avgScore >= 50
          ? 'Needs Practice'
          : 'Keep Building';

      const prompt = `Synthesize a final executive coaching dossier for a ${level} ${role} (${mode}) mock interview.

Computed Overall Score: ${avgScore}/100 (Expected Verdict: "${verdictHint}")
Overall Webcam Presence Score: ${overallPresenceScore !== null ? `${overallPresenceScore}/100` : 'Webcam disabled'}
Target JD Skills: ${(jdSkills || []).join(', ') || 'None specified'}
Resume Highlights: ${(resumeHighlights || []).join(' | ') || 'None provided'}

Question-by-Question Telemetry:
${attempts
  .map(
    (a, idx) =>
      `Q${idx + 1} (${a.category}, source=${a.source}, skipped=${a.skipped}, score=${a.compositeScore}/100, WPM=${a.wpm}, fillers=${a.totalFillers}, eyeContact=${a.eyeContactPct ?? 'N/A'}%):
Prompt: ${a.question}
Answer: ${a.answer || '[Skipped]'}`
  )
  .join('\n\n')}

Provide:
- verdict: one of "Interview Ready", "Almost There", "Needs Practice", "Keep Building"
- headline: crisp 1-sentence executive summary
- top_strengths: 2-3 specific patterns observed across answers
- top_weaknesses: 2-3 specific gaps observed across answers
- improvement_plan: exactly 3 concrete steps with actionable practice exercises
- practice_questions: 2 targeted follow-up practice prompts
- resume_highlights_to_mention: 1-3 strong resume points the candidate forgot to surface (or strategic proof points to bring up)
- body_language_tip: 1 concise coaching note if webcam presence telemetry is available, else null
- closing_line: motivating 1-sentence sign-off in persona tone`;

      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: prompt,
        config: {
          systemInstruction: `${personaDirective}\nYou are an executive career coach synthesizing cross-interview patterns. Return strictly valid JSON matching the schema.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              verdict: { type: Type.STRING },
              headline: { type: Type.STRING },
              top_strengths: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              top_weaknesses: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              improvement_plan: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    step: { type: Type.STRING },
                    exercise: { type: Type.STRING },
                  },
                  required: ['step', 'exercise'],
                },
              },
              practice_questions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              resume_highlights_to_mention: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              body_language_tip: { type: Type.STRING, nullable: true },
              closing_line: { type: Type.STRING },
            },
            required: [
              'verdict',
              'headline',
              'top_strengths',
              'top_weaknesses',
              'improvement_plan',
              'practice_questions',
              'resume_highlights_to_mention',
              'closing_line',
            ],
          },
        },
      });

      const rawText = response.text ?? '';
      const parsed = JSON.parse(stripMarkdownFences(rawText));
      res.json(parsed);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`InterviewAce server listening on http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start InterviewAce server:', err);
  process.exit(1);
});
