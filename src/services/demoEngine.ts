import {
  analyzeFillerWords,
  computeCompositeScore,
  countWords,
  getVerdictFromScore,
  PERSONAS,
  type CallAResponse,
  type CallBResponse,
  type CallCResponse,
  type InterviewQuestion,
  type InterviewSetupConfig,
  type QuestionAttempt,
} from '../types/interview';

function getEffectiveRole(config: InterviewSetupConfig): string {
  if (config.role === 'Other') {
    return config.customRole.trim() || 'General Specialist';
  }
  return config.role;
}

export function generateDemoQuestions(config: InterviewSetupConfig): CallAResponse {
  const role = getEffectiveRole(config);
  const resumeSkills = config.resume?.skills ?? [];
  const resumeHighlights = config.resume?.highlights ?? [];
  const jdSkills =
    config.jd.extractedSkills.length > 0
      ? config.jd.extractedSkills.slice(0, 8)
      : getDefaultRoleSkills(role);

  const defaultDifficulty =
    config.persona === 'pressure_ceo'
      ? 'Hard'
      : config.persona === 'strict_tech'
      ? 'Medium'
      : 'Easy';

  const pool: InterviewQuestion[] = [];
  const count = config.questionCount;

  // Determine how many resume and JD questions to weave in (>=40% each when provided)
  const hasResume = Boolean(config.resume && config.resume.rawText.trim().length > 20);
  const hasJd = config.jd.rawText.trim().length > 20;

  const targetResumeCount = hasResume ? Math.ceil(count * 0.4) : 0;
  const targetJdCount = hasJd ? Math.ceil(count * 0.4) : 0;

  for (let i = 0; i < count; i++) {
    const id = `q${i + 1}`;
    const isBehavioral =
      config.mode === 'Behavioral' || (config.mode === 'Mixed' && i % 2 === 1);

    let source: 'general' | 'resume' | 'jd' = 'general';
    if (hasResume && i < targetResumeCount) {
      source = 'resume';
    } else if (hasJd && i >= targetResumeCount && i < targetResumeCount + targetJdCount) {
      source = 'jd';
    } else if (hasResume && !hasJd && i % 2 === 0) {
      source = 'resume';
    } else if (hasJd && !hasResume && i % 2 === 0) {
      source = 'jd';
    }

    const skillA = resumeSkills[i % Math.max(1, resumeSkills.length)] || role;
    const jdSkillA = jdSkills[i % Math.max(1, jdSkills.length)] || role;
    const highlightSnippet =
      resumeHighlights[i % Math.max(1, resumeHighlights.length)]?.slice(0, 55) || '';

    let question = '';
    let category = isBehavioral ? 'Behavioral' : 'Technical';
    let competency = isBehavioral ? 'Ownership & Collaboration' : 'System & Domain Depth';
    let rubric: string[] = [];

    if (source === 'resume') {
      if (isBehavioral) {
        question = highlightSnippet
          ? `Looking at your background with ${skillA}, tell me about a tough trade-off you faced when delivering that work.`
          : `Walk me through a project on your resume where ${skillA} was central and what you personally owned.`;
        competency = 'Resume Ownership & Impact';
        rubric = [
          `Clearly describes context and personal role using ${skillA}`,
          'Explains concrete actions and engineering or execution trade-offs',
          'Quantifies measurable outcome or lesson learned',
        ];
      } else {
        question = `Your resume highlights ${skillA}. How would you diagnose a sudden production bottleneck involving it?`;
        category = 'Technical Deep-Dive';
        competency = `${skillA} Applied Mastery`;
        rubric = [
          `Identifies observability and isolation steps for ${skillA}`,
          'Discusses root-cause hypotheses and trade-offs',
          'Proposes preventive safeguards or validation tests',
        ];
      }
    } else if (source === 'jd') {
      if (isBehavioral) {
        question = `This role prioritizes ${jdSkillA}. Describe a time you aligned stakeholders around a difficult ${jdSkillA} decision.`;
        competency = `${jdSkillA} Alignment`;
        rubric = [
          'Sets clear situation and conflicting priorities',
          'Explains communication and alignment tactics',
          'Shares measurable business or team outcome',
        ];
      } else {
        question = `For our ${role} team, ${jdSkillA} is critical. How do you evaluate design trade-offs when scaling ${jdSkillA}?`;
        category = 'Role Architecture';
        competency = `${jdSkillA} Scalability`;
        rubric = [
          `Addresses core constraints and bottlenecks in ${jdSkillA}`,
          'Compares at least two viable approaches with pros and cons',
          'Ties technical choice back to user or business reliability',
        ];
      }
    } else {
      const generalTemplates = getGeneralQuestions(role, config.level, isBehavioral);
      const chosen = generalTemplates[i % generalTemplates.length];
      question = chosen.question;
      category = chosen.category;
      competency = chosen.competency;
      rubric = chosen.rubric;
    }

    const difficulty =
      i === count - 1 && config.persona !== 'friendly_hr'
        ? 'Hard'
        : i === 0 && config.persona === 'friendly_hr'
        ? 'Easy'
        : defaultDifficulty;

    pool.push({
      id,
      question,
      category,
      competency,
      difficulty,
      source,
      rubric,
      ideal_duration_seconds: isBehavioral ? 105 : 90,
    });
  }

  return {
    candidate_name: config.resume?.candidateName ?? null,
    jd_skills: jdSkills,
    questions: pool,
  };
}

export function evaluateDemoAnswer(
  config: InterviewSetupConfig,
  question: InterviewQuestion,
  answerText: string,
  jdSkills: string[],
  isFollowUpEvaluation: boolean
): CallBResponse {
  const words = countWords(answerText);
  const lower = answerText.toLowerCase();
  const { total: fillerCount } = analyzeFillerWords(answerText);
  const persona = PERSONAS[config.persona];

  const hasMetrics = /(\d+%|\$\d+|\d+x|\d+\s*(ms|sec|users|hours|days|weeks|months))/i.test(
    answerText
  );
  const hasStructureSignals =
    /(first|second|then|finally|because|therefore|result|outcome|situation|action|trade-off|tradeoff)/i.test(
      lower
    );
  const hasDepthSignals =
    /(latency|scale|trade-off|metric|stakeholder|test|edge case|bottleneck|architecture|impact|ownership|prioritize)/i.test(
      lower
    );

  // Check rubric keyword overlap
  const rubricCoverage = question.rubric.map((point) => {
    const keywords = point
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 4 && !['with', 'that', 'this', 'from', 'your', 'about'].includes(w));
    const matches = keywords.filter((kw) => lower.includes(kw)).length;
    return {
      point,
      covered: matches >= 1 && words >= 18,
    };
  });
  const coveredRatio =
    rubricCoverage.filter((r) => r.covered).length / Math.max(1, rubricCoverage.length);

  // Base scoring curve calibrated realistically by answer richness
  const lengthScore =
    words >= 85 ? 8.5 : words >= 50 ? 7.2 : words >= 28 ? 5.6 : words >= 12 ? 4.0 : 2.2;

  const relevance = clampScore(lengthScore * 0.65 + coveredRatio * 3.5);
  const depth = clampScore(
    lengthScore * 0.55 + (hasMetrics ? 2.0 : 0.4) + (hasDepthSignals ? 1.8 : 0.3)
  );
  const fillerRatio = words > 0 ? fillerCount / words : 0;
  const clarity = clampScore(
    (words >= 20 ? 7.8 : 4.5) - Math.min(3.0, fillerRatio * 28) + (hasStructureSignals ? 1.0 : 0)
  );
  const structure = clampScore(
    (hasStructureSignals ? 7.6 : 4.8) + (words >= 45 ? 1.2 : 0)
  );
  const confidence = clampScore(
    (words >= 30 ? 7.4 : 4.6) - Math.min(2.2, fillerRatio * 20) + (hasMetrics ? 1.0 : 0)
  );

  const isBehavioral = question.category.toLowerCase().includes('behavioral');
  const star = {
    applicable: isBehavioral,
    situation: isBehavioral ? /(when|during|at my|last year|project|team|while)/i.test(lower) : false,
    task: isBehavioral ? /(needed to|goal|responsible|task|challenge|problem)/i.test(lower) : false,
    action: isBehavioral ? /(i built|i led|i created|i decided|i implemented|i worked|i analyzed)/i.test(lower) : false,
    result: isBehavioral ? hasMetrics || /(resulted|improved|reduced|launched|outcome|learned)/i.test(lower) : false,
  };

  const demonstratedSkills = jdSkills.filter((skill) =>
    lower.includes(skill.toLowerCase())
  );

  const strengths: string[] = [];
  if (words >= 45) strengths.push('Provided clear context and substantive detail.');
  if (hasMetrics) strengths.push('Anchored claims with concrete, measurable impact.');
  if (hasStructureSignals) strengths.push('Used logical sequencing to organize the response.');
  if (strengths.length === 0) strengths.push('Addressed the core prompt directly.');

  const improvements: string[] = [];
  if (!hasMetrics) improvements.push('Quantify the outcome with specific numbers, latency, or business impact.');
  if (coveredRatio < 0.65) {
    const missed = rubricCoverage.find((r) => !r.covered);
    if (missed) improvements.push(`Explicitly cover: ${missed.point.toLowerCase()}.`);
  }
  if (fillerCount >= 3) improvements.push('Trim filler words ("like", "um", "basically") by pausing briefly between points.');
  if (isBehavioral && !star.result) improvements.push('Close behavioral stories with a sharper STAR Result statement.');
  if (improvements.length === 0) improvements.push('Compare an alternative trade-off to demonstrate senior-level judgment.');

  const needsFollowUp =
    !isFollowUpEvaluation &&
    config.followUpsEnabled &&
    (words < 45 || !hasMetrics || coveredRatio < 0.6 || (isBehavioral && !star.result));

  let followUpQuestion: string | null = null;
  let followUpReason: string | null = null;

  if (needsFollowUp) {
    if (config.persona === 'pressure_ceo') {
      followUpQuestion =
        'Give me the exact measurable impact and what you personally owned versus your team.';
      followUpReason = 'Answer lacked quantified ownership and measurable outcome.';
    } else if (config.persona === 'strict_tech') {
      followUpQuestion =
        'What specific trade-off or failure mode did you evaluate, and why did you reject the alternative?';
      followUpReason = 'Needed deeper technical trade-off and edge-case reasoning.';
    } else {
      followUpQuestion =
        'Could you share a specific outcome or metric that shows how your approach worked in practice?';
      followUpReason = 'Helpful to reinforce the story with a concrete result.';
    }
  }

  const spokenFeedback =
    persona.id === 'friendly_hr'
      ? `Nice start! ${strengths[0]} Next time, ${improvements[0].toLowerCase()}`
      : persona.id === 'pressure_ceo'
      ? `Direct read: ${improvements[0]} Keep your opening tighter and lead with impact.`
      : `Solid baseline, though ${improvements[0].toLowerCase()}`;

  const idealAnswer = buildIdealAnswer(getEffectiveRole(config), question);

  return {
    scores: {
      relevance,
      depth,
      clarity,
      structure,
      confidence,
    },
    rubric_coverage: rubricCoverage,
    star,
    strengths: strengths.slice(0, 2),
    improvements: improvements.slice(0, 2),
    needs_follow_up: needsFollowUp,
    follow_up_question: followUpQuestion,
    follow_up_reason: followUpReason,
    jd_skills_demonstrated: demonstratedSkills,
    spoken_feedback: spokenFeedback,
    ideal_answer: idealAnswer,
  };
}

export function generateDemoSummary(
  config: InterviewSetupConfig,
  attempts: QuestionAttempt[],
  jdSkills: string[],
  overallPresenceScore: number | null
): CallCResponse {
  const scoredAttempts = attempts.filter((a) => !a.skipped && a.evaluation);
  const avgScore =
    scoredAttempts.length > 0
      ? Math.round(
          scoredAttempts.reduce((sum, a) => sum + a.compositeScore, 0) /
            scoredAttempts.length
        )
      : 0;

  const verdict = getVerdictFromScore(avgScore);
  const role = getEffectiveRole(config);

  const avgAxis = (key: keyof CallBResponse['scores']) => {
    if (scoredAttempts.length === 0) return 0;
    return (
      scoredAttempts.reduce((sum, a) => sum + (a.evaluation?.scores[key] ?? 0), 0) /
      scoredAttempts.length
    );
  };

  const axes: Array<{ label: string; value: number }> = [
    { label: 'Relevance', value: avgAxis('relevance') },
    { label: 'Depth', value: avgAxis('depth') },
    { label: 'Clarity', value: avgAxis('clarity') },
    { label: 'Structure', value: avgAxis('structure') },
    { label: 'Confidence', value: avgAxis('confidence') },
  ];
  const sortedAxes = [...axes].sort((a, b) => b.value - a.value);

  const demonstratedSet = new Set<string>();
  for (const a of scoredAttempts) {
    a.evaluation?.jd_skills_demonstrated.forEach((s) => demonstratedSet.add(s));
  }
  const missedSkills = jdSkills.filter((s) => !demonstratedSet.has(s)).slice(0, 3);

  const resumeHighlights = (config.resume?.highlights ?? [])
    .filter((h) => {
      const keywords = h.toLowerCase().split(/\W+/).filter((w) => w.length > 5);
      const allAnswers = scoredAttempts.map((a) => a.combinedAnswer.toLowerCase()).join(' ');
      return !keywords.some((kw) => allAnswers.includes(kw));
    })
    .slice(0, 3);

  return {
    verdict,
    headline:
      avgScore >= 80
        ? `Strong command of ${role} fundamentals with crisp, structured delivery.`
        : avgScore >= 65
        ? `Solid ${role} foundation — sharper metrics and trade-off framing will push you over the bar.`
        : `Promising baseline; focus on structured STAR storytelling and concrete evidence.`,
    top_strengths: [
      `Highest rubric performance in ${sortedAxes[0].label} (${sortedAxes[0].value.toFixed(1)}/10).`,
      `Maintained focus across ${scoredAttempts.length} of ${attempts.length} ${config.mode.toLowerCase()} prompts.`,
    ],
    top_weaknesses: [
      `Lowest scoring dimension was ${sortedAxes[sortedAxes.length - 1].label} (${sortedAxes[sortedAxes.length - 1].value.toFixed(1)}/10).`,
      missedSkills.length > 0
        ? `Missed opportunities to reference target job skills: ${missedSkills.join(', ')}.`
        : 'Answers can benefit from tighter opening headlines and quantified results.',
    ],
    improvement_plan: [
      {
        step: 'Lead with a 1-sentence executive thesis',
        exercise:
          'Record 60-second answers to 3 core prompts where your very first sentence states your conclusion and key metric.',
      },
      {
        step: 'Quantify every STAR Result',
        exercise:
          'Rewrite your top 3 resume projects using the formula: Action + Constraint + Before/After Metric.',
      },
      {
        step: 'Articulate trade-offs proactively',
        exercise:
          'For every technical or product choice you mention, practice naming one rejected alternative and why.',
      },
    ],
    practice_questions: [
      `Tell me about a time a ${role} decision you made failed in production or with users — what changed afterward?`,
      `How would you prioritize competing stakeholder requests when resources are cut by 30%?`,
    ],
    resume_highlights_to_mention:
      resumeHighlights.length > 0
        ? resumeHighlights
        : ['Highlight a cross-functional initiative with measurable timeline or revenue impact.'],
    body_language_tip:
      overallPresenceScore !== null
        ? overallPresenceScore >= 75
          ? 'Steady eye-line and composed posture reinforced credibility; keep anchoring pauses toward the camera lens.'
          : 'Try positioning your notes directly below the camera lens to keep yaw/pitch within ±15° during complex explanations.'
        : null,
    closing_line: `Keep refining your proof points for ${role} — consistency on metrics and trade-offs turns good answers into offers.`,
  };
}

function clampScore(val: number): number {
  return Math.round(Math.max(1, Math.min(10, val)) * 10) / 10;
}

function getDefaultRoleSkills(role: string): string[] {
  const map: Record<string, string[]> = {
    'Software Engineer': ['System Design', 'TypeScript', 'API Design', 'Testing', 'Debugging', 'SQL'],
    'Product Manager': ['Product Strategy', 'Prioritization', 'Metrics', 'User Research', 'Roadmapping', 'Stakeholder Alignment'],
    'Data Analyst': ['SQL', 'Data Modeling', 'Visualization', 'Statistical Analysis', 'ETL', 'Stakeholder Storytelling'],
    'QA Engineer': ['Test Automation', 'Playwright', 'CI/CD', 'Edge-Case Analysis', 'Regression Strategy', 'Performance Testing'],
    'UI/UX Designer': ['Design Systems', 'User Research', 'Prototyping', 'Accessibility', 'Information Architecture', 'Usability Testing'],
    HR: ['Talent Acquisition', 'Conflict Resolution', 'Onboarding', 'Policy Design', 'Retention', 'Coaching'],
    Sales: ['Discovery', 'Objection Handling', 'Pipeline Management', 'Forecasting', 'Negotiation', 'Account Expansion'],
    Marketing: ['Positioning', 'Funnel Analytics', 'Attribution', 'Content Strategy', 'Experimentation', 'Lifecycle'],
  };
  return map[role] ?? ['Problem Solving', 'Execution', 'Communication', 'Ownership', 'Analytics', 'Collaboration'];
}

function getGeneralQuestions(
  role: string,
  level: string,
  isBehavioral: boolean
): Array<{
  question: string;
  category: string;
  competency: string;
  rubric: string[];
}> {
  if (isBehavioral) {
    return [
      {
        question: `Tell me about a time you disagreed with a teammate or manager on a ${role} decision. How did you resolve it?`,
        category: 'Behavioral',
        competency: 'Conflict Resolution & Influence',
        rubric: [
          'Describes the specific disagreement objectively',
          'Shows active listening and data-backed persuasion',
          'States the final resolution and team impact',
        ],
      },
      {
        question: `Describe a high-stakes project where requirements changed mid-flight. How did you adapt and deliver?`,
        category: 'Behavioral',
        competency: 'Adaptability & Ownership',
        rubric: [
          'Explains the shifting constraint clearly',
          'Details reprioritization and stakeholder communication',
          'Quantifies successful delivery outcome',
        ],
      },
      {
        question: `Share an example of a mistake or missed target in your ${role} work and what system you changed afterward.`,
        category: 'Behavioral',
        competency: 'Accountability & Growth',
        rubric: [
          'Takes clear personal ownership without blaming others',
          'Identifies root cause accurately',
          'Demonstrates a durable process or technical improvement',
        ],
      },
    ];
  }

  return [
    {
      question: `At a ${level} ${role} level, how do you break down an ambiguous problem before committing to a solution?`,
      category: 'Technical Problem Solving',
      competency: 'Structured Decomposition',
      rubric: [
        'Clarifies goals, constraints, and success metrics first',
        'Breaks problem into testable components or hypotheses',
        'Balances speed of delivery with long-term maintainability',
      ],
    },
    {
      question: `Walk me through how you measure quality and reliability in your ${role} deliverables before shipping.`,
      category: 'Execution & Quality',
      competency: 'Operational Rigor',
      rubric: [
        'Defines concrete quality gates or acceptance criteria',
        'Covers edge cases, monitoring, or rollback readiness',
        'Connects quality practices to user or business outcomes',
      ],
    },
    {
      question: `What is a common bottleneck you see in ${role} workflows, and how would you redesign it from scratch?`,
      category: 'System Thinking',
      competency: 'Process & Architecture Optimization',
      rubric: [
        'Pinpoints a specific, realistic bottleneck',
        'Proposes a pragmatic redesign with clear trade-offs',
        'Explains how impact would be measured',
      ],
    },
  ];
}

function buildIdealAnswer(role: string, question: InterviewQuestion): string {
  return `In my recent ${role} work, I approached a closely related challenge around ${question.competency.toLowerCase()} by first aligning on measurable success criteria and constraints. Specifically, I isolated the core bottleneck—reconciling speed with reliability—and evaluated two options before implementing a phased rollout. By instrumenting clear metrics from day one and running structured edge-case checks with cross-functional partners, I reduced cycle time by roughly 28% while eliminating recurring regressions. The biggest takeaway was validating assumptions early with real data and documenting the trade-offs so the whole team could scale the pattern afterward.`;
}

export function createZeroEvaluation(): CallBResponse {
  return {
    scores: {
      relevance: 0,
      depth: 0,
      clarity: 0,
      structure: 0,
      confidence: 0,
    },
    rubric_coverage: [],
    star: {
      applicable: false,
      situation: false,
      task: false,
      action: false,
      result: false,
    },
    strengths: [],
    improvements: ['Question was skipped.'],
    needs_follow_up: false,
    follow_up_question: null,
    follow_up_reason: null,
    jd_skills_demonstrated: [],
    spoken_feedback: 'Question skipped.',
    ideal_answer: 'No ideal answer generated for skipped question.',
  };
}

export { computeCompositeScore };
