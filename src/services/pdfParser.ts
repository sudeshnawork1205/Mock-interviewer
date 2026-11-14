import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { JobDescriptionData, ResumeData } from '../types/interview';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const KNOWN_SKILLS = [
  'TypeScript',
  'JavaScript',
  'React',
  'Next.js',
  'Node.js',
  'Python',
  'Java',
  'Go',
  'Rust',
  'C++',
  'SQL',
  'PostgreSQL',
  'MongoDB',
  'Redis',
  'GraphQL',
  'REST API',
  'Docker',
  'Kubernetes',
  'AWS',
  'GCP',
  'Azure',
  'Terraform',
  'CI/CD',
  'Git',
  'Tailwind CSS',
  'Figma',
  'User Research',
  'Design Systems',
  'Prototyping',
  'Accessibility',
  'A/B Testing',
  'Product Strategy',
  'Roadmapping',
  'Agile',
  'Scrum',
  'JIRA',
  'Tableau',
  'Power BI',
  'Excel',
  'Pandas',
  'Machine Learning',
  'PyTorch',
  'TensorFlow',
  'Data Modeling',
  'ETL',
  'Selenium',
  'Playwright',
  'Cypress',
  'Jest',
  'Test Automation',
  'Performance Testing',
  'Salesforce',
  'HubSpot',
  'B2B Sales',
  'Pipeline Management',
  'Negotiation',
  'SEO',
  'Content Strategy',
  'Paid Acquisition',
  'Google Analytics',
  'CRM',
  'Talent Acquisition',
  'Onboarding',
  'Employee Relations',
  'Compensation',
  'Microservices',
  'System Design',
  'Distributed Systems',
  'WebSockets',
  'Leadership',
  'Cross-functional',
  'Stakeholder Management',
];

export function extractSkillsFromText(text: string): string[] {
  if (!text.trim()) return [];
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const skill of KNOWN_SKILLS) {
    const escaped = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    if (regex.test(lower)) {
      matched.push(skill);
    }
  }
  return matched.slice(0, 14);
}

function extractHighlightsFromText(text: string): string[] {
  const lines = text
    .split(/\r?\n|•|▪|◦/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 24 && l.length <= 180);

  const metricOrActionLines = lines.filter((line) =>
    /(\d+%|\$\d+|\d+x|built|led|designed|launched|reduced|increased|improved|architected|managed|automated|delivered)/i.test(
      line
    )
  );

  const source = metricOrActionLines.length > 0 ? metricOrActionLines : lines;
  return source.slice(0, 6);
}

function extractCandidateName(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);

  for (const line of lines) {
    if (
      line.length >= 3 &&
      line.length <= 40 &&
      !/(@|http|resume|curriculum|phone|email|linkedin|github|\d{3})/i.test(line)
    ) {
      const words = line.split(/\s+/);
      if (words.length >= 2 && words.length <= 3 && words.every((w) => /^[A-Za-z.\-']+$/.test(w))) {
        return line;
      }
    }
  }
  return null;
}

export async function parseResumeFile(file: File): Promise<ResumeData> {
  let rawText = '';

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(pageText);
    }
    rawText = pages.join('\n').replace(/\s{2,}/g, ' ').trim();
  } else {
    rawText = (await file.text()).trim();
  }

  if (!rawText) {
    throw new Error('No readable text could be extracted from this file. Try a text-based PDF or .txt file.');
  }

  const words = rawText.split(/\s+/).filter(Boolean);
  return {
    fileName: file.name,
    rawText: rawText.slice(0, 12000),
    wordCount: words.length,
    skills: extractSkillsFromText(rawText),
    highlights: extractHighlightsFromText(rawText),
    candidateName: extractCandidateName(rawText),
  };
}

export function parseJobDescriptionText(rawText: string): JobDescriptionData {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      rawText: '',
      targetTitle: null,
      companyName: null,
      extractedSkills: [],
    };
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let targetTitle: string | null = null;
  let companyName: string | null = null;

  const titleMatch = trimmed.match(
    /(?:role|position|job title|title)\s*[:\-]\s*([^\n\r,.]{3,60})/i
  );
  if (titleMatch) {
    targetTitle = titleMatch[1].trim();
  } else if (lines[0] && lines[0].length <= 65) {
    targetTitle = lines[0].replace(/^(job description|hiring|we are hiring)\s*[:\-]?\s*/i, '').trim() || null;
  }

  const companyMatch = trimmed.match(
    /(?:company|organization|at|join)\s*[:\-]?\s+([A-Z][A-Za-z0-9&.\- ]{1,35})/
  );
  if (companyMatch) {
    companyName = companyMatch[1].trim();
  }

  return {
    rawText: trimmed.slice(0, 10000),
    targetTitle,
    companyName,
    extractedSkills: extractSkillsFromText(trimmed),
  };
}
