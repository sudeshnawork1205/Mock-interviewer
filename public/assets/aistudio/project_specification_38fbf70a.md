# InterviewAce — AI Mock Interviewer: Project Specification

## 1. Executive Summary & Architecture Overview

**InterviewAce — AI Mock Interviewer** is a client-side, single-page web application designed for job seekers and students to practice realistic, high-stakes interviews. The platform simulates an end-to-end interview loop with audio/text input, adaptive questioning, role-specific personas, resume and job description (JD) contextualization, browser-based computer vision (for real-time body language tracking), and an interactive analytics dashboard.

### Core Architectural Principles
* **Client-Side First:** All document parsing (PDF.js), speech recognition (Web Speech API), speech synthesis (`window.speechSynthesis`), and computer vision tracking (MediaPipe FaceLandmarker via CDN) execute locally in the browser. No video frames, audio blobs, or private resumes ever touch a remote server.
* **BYOK (Bring Your Own Key) & Demo Mode:** LLM calls interact directly with user-supplied API keys (stored exclusively in `localStorage`) or fall back to a robust built-in heuristic/rule-based engine for offline/demo operation.
* **Strict Schema Contracts:** All AI generations adhere to rigid JSON data contracts parsed via resilient try/catch blocks with graceful fallbacks.

---

## 2. Comprehensive System Architecture & Data Flow

```
┌────────────────────────────────────────────────────────┐
│                     Screen 1: SETUP                    │
│  - Role / Level / Type / Question Count / Persona      │
│  - Resume Parser (PDF.js) & Job Description Input      │
│  - API Key Manager / LocalStorage / Demo Mode Switch   │
└───────────────────────────┬────────────────────────────┘
                            │ Start Interview (MIC / CAM permissions requested)
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Call A: INITIALIZER                  │
│  - Generates N questions with rubric & metadata        │
│  - Embeds Resume & JD citations (>=40% targeting)      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Screen 2: LIVE LOOP                  │
│  - Persona Avatar & Soundwave Voice Synthesis          │
│  - MediaPipe Vision Coach (Eye Contact, Smile, Yaw/Pitch)│
│  - Web Speech API (Live Transcript) + Manual Text Box   │
│  - Timer & Live Telemetry (WPM, Filler Words)          │
└───────────────────────────┬────────────────────────────┘
                            │ Submit Answer
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Call B: EVALUATOR                    │
│  - Rubric Scoring & 5 Core Metrics (Relevance, etc.)   │
│  - Dynamic Follow-Up Gate (needs_follow_up: boolean)   │
└────────────┬───────────────────────────────┬───────────┘
             │                               │
    [If Follow-Up Triggered]        [If No Follow-Up]
             ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ Ask Follow-Up   │             │ Compact Card &  │
    │ & Re-Evaluate   │             │ Spoken Feedback │
    └────────┬────────┘             └────────┬────────┘
             │                               │
             └───────────────┬───────────────┘
                             │ Final Question Reached
                             ▼
┌────────────────────────────────────────────────────────┐
│                   Call C: AGGREGATOR                   │
│  - Cross-Interview Pattern Analysis                    │
│  - 3-Step Action Plan & JD Skill Match Computation     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                  Screen 3: DASHBOARD                   │
│  - Doughnut Score Gauge & Verdict Badge                │
│  - Chart.js Radar & Bar Visualizations                 │
│  - Presence Card & STAR Method Tracker                 │
│  - Printable Report Stylesheet                         │
└────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component & Module Specifications

### A. Screen 1: Setup & Configuration
* **Role Selection:** Dropdown (`Software Engineer`, `Product Manager`, `Data Analyst`, `QA Engineer`, `UI/UX Designer`, `HR`, `Sales`, `Marketing`, `Other` + custom text input).
* **Experience Tier:** `Fresher` | `Mid-level` | `Senior`.
* **Interview Mode:** `Technical` | `Behavioral` | `Mixed`.
* **Question Volume:** `3` | `5` | `7` (Default: `5`).
* **Interviewer Personas:**
  * **😊 Friendly HR:** Warm, encouraging, gentle follow-ups, Easy–Medium difficulty. Voice pitch/rate: Moderate/Warm.
  * **🧐 Strict Tech Lead:** Precise, probes for depth and trade-offs, Medium–Hard difficulty. Voice pitch/rate: Direct/Measured.
  * **⚡ Pressure CEO:** Fast-paced, challenges assumptions, hard-hitting, Hard difficulty. Voice pitch/rate: Fast/Authoritative.
* **Personalization Panel (Collapsible):**
  * **Resume Upload:** Drag-and-drop or file picker for PDF (parsed via `pdfjs-dist` worker) or plain text. Displays extracted word count and detected skill chips.
  * **Job Description:** Textarea for job posting. Automatically extracts target job title, company name, and key requirements.
* **Toggles & Advanced Controls:**
  * **Follow-up Questions:** Toggle (Default: `ON`, max 1 per question).
  * **Webcam Coach:** Toggle (Default: `ON`). Renders a live preview pill with privacy disclaimer.
  * **Voice Selector:** Dropdown populated by `window.speechSynthesis.getVoices()`.
  * **API Key Manager:** Password input with secure `localStorage` persistence and "Remember key" checkbox.
  * **Demo Mode:** Toggle enabling offline heuristic mock data.
* **Microphone & Camera Pre-flight Check:** Permission prompt with a live test ("Say hello" -> speech transcript check + "Face detected ✓" MediaPipe indicator).

### B. Screen 2: Live Interview Engine
* **Header & Telemetry:** Progress tracker (`Question X of Y`), category badge, difficulty indicator, and source tags (`📄 From your resume` / `💼 From the job description`).
* **Interviewer Avatar & Audio:** Animated persona icon with real-time CSS soundwave pulsing during `speechSynthesis` playback. Includes a "Repeat question" button.
* **Threaded Follow-Ups:** Appends adaptive follow-up prompts under the main question bubble with a distinctive badge.
* **Webcam Vision Coach (Browser-Side):**
  * Powered by MediaPipe `FaceLandmarker` running at ~5 FPS on active answering states.
  * Extracts transformation matrices (`yaw`, `pitch`) and facial blendshapes (`eyeLookOut`, `eyeLookIn`, `eyeLookUp`, `eyeLookDown`, `mouthSmileLeft`, `mouthSmileRight`).
  * Real-time metrics: Eye-contact health (Green/Amber/Red), smile tracking, and head stability (nose-tip standard deviation). Triggers gentle visual nudges if eye contact drops below threshold for $>5$ seconds.
* **Answer Studio:**
  * **Microphone Button:** Large circular button with glowing red pulse animation. Toggles Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) in continuous mode with interim results.
  * **Editable Transcript:** Real-time text area allowing dual voice/type input.
  * **Live Telemetry:** Timer (mm:ss) with ideal duration hints, live word count, WPM, and filler-word counter (`um`, `uh`, `like`, `basically`, `actually`, `you know`, `kind of`, `sort of`, `literally`, `so yeah`).
  * **Action Controls:** `Submit answer`, `Skip question`, `End interview early`.
* **Evaluation & Bridge State:** Loading skeleton ("Evaluating your answer..."). Conditionally branches to a persona-specific bridge statement ("Interesting, let me dig into that...") if a follow-up is triggered, or presents an immediate score card, 1 strength, 1 improvement, and spoken feedback before advancing.

### C. Screen 3: Performance & Analytics Dashboard
* **Overall Score Gauge:** Doughnut gauge (0–100) with dynamic verdict badge:
  * $80+$: `Interview Ready` (Green)
  * $65–79$: `Almost There` (Blue)
  * $50–64$: `Needs Practice` (Amber)
  * $<50$: `Keep Building` (Red)
* **Chart.js Visualizations:**
  * **Radar Chart:** Evaluates axis averages across `Relevance`, `Depth`, `Clarity`, `Structure`, and `Confidence`.
  * **Bar Chart:** Individual scores per question ($Q1 - Q5$) color-coded by score bands.
* **Delivery & Behavioral Cards:**
  * **Voice Delivery Card:** WPM analysis (ideal range 120–160), top 3 filler words, average answer length, and voice vs. typed distribution.
  * **STAR Method Tracker:** Breakdown of behavioral question coverage (`Situation`, `Task`, `Action`, `Result`).
  * **Presence Card:** Overall presence score out of 100, eye-contact %, smile %, head stability rating, and a line chart of eye contact across question intervals.
  * **Job-Fit Card:** JD Match % ring, demonstrated skills (green chips), missed skills (grey chips), and unmentioned resume highlights.
* **Coaching & Review Section:**
  * **Follow-up Insight:** Frequency and diagnostic rationale.
  * **Strengths vs. Weaknesses:** Two-column analysis cards.
  * **3-Step Improvement Plan:** Concrete exercises with targeted practice drills.
  * **Question-by-Question Accordion:** Full transcript review, rubric breakdowns, and an "Ideal Answer" player with `🔊` speech synthesis.
  * **Action Bar:** `Retry same interview`, `New interview`, `Download report` (clean print stylesheet using `window.print()`).

---

## 4. AI Prompt Engineering & Data Contracts

### Global Persona Injection Rules
Prepend the following persona directives to every LLM request based on user selection:
* **Friendly HR:** `"You are Priya, a warm HR manager. Encouraging, patient, uses the candidate's name. Questions Easy–Medium. Feedback starts with what went well."`
* **Strict Tech Lead:** `"You are Arjun, a no-nonsense tech lead. Precise and direct, probes for depth, trade-offs and 'why'. Questions Medium–Hard. Feedback is blunt but fair."`
* **Pressure CEO:** `"You are Meera, a busy startup CEO. Fast-paced, challenges assumptions, interrupts vague answers with sharp follow-ups, asks about impact and ownership. Questions Hard."`

---

### Call A: Question Generation Contract
* **Role:** Senior hiring manager matching role, level, and persona constraints.
* **Rules:**
  * If resume provided: $\ge 40\%$ of questions must target specific resume entities (projects, skills, employment gaps), tagged source: `"resume"`.
  * If job description provided: $\ge 40\%$ of questions must test core job requirements, tagged source: `"jd"`. Extract top 6–8 required skills into `jd_skills`.
  * Keep questions under 35 words (optimized for speech synthesis). No bullet points or code snippets.
  * Provide a hidden rubric of 3–5 evaluation points per question.
* **JSON Output Schema:**
```json
{
  "candidate_name": "string or null",
  "jd_skills": ["string"],
  "questions": [
    {
      "id": "q1",
      "question": "string",
      "category": "string",
      "competency": "string",
      "difficulty": "Easy | Medium | Hard",
      "source": "general | resume | jd",
      "rubric": ["string"],
      "ideal_duration_seconds": 90
    }
  ]
}
```

---

### Call B: Answer Evaluation Contract
* **Role:** Fair, experienced interview coach.
* **Rules:**
  * Judge meaning; never penalize speech-to-text artifacts or grammatical errors.
  * Score 0–10 on: `relevance`, `depth`, `clarity`, `structure`, `confidence`. (Anchors: 2=Poor, 5=Average, 8=Strong, 10=Exceptional).
  * Set `needs_follow_up = true` if the answer is vague, lacks evidence, misses rubric criteria, or lacks a STAR result (behavioral). Provide a concise follow-up prompt ($<25$ words) in persona style.
  * Formulate `spoken_feedback` ($<30$ words) and an `ideal_answer` (first-person, 90–130 words).
* **JSON Output Schema:**
```json
{
  "scores": {
    "relevance": 0,
    "depth": 0,
    "clarity": 0,
    "structure": 0,
    "confidence": 0
  },
  "rubric_coverage": [
    { "point": "string", "covered": true }
  ],
  "star": {
    "applicable": true,
    "situation": true,
    "task": true,
    "action": true,
    "result": true
  },
  "strengths": ["string"],
  "improvements": ["string"],
  "needs_follow_up": false,
  "follow_up_question": "string or null",
  "follow_up_reason": "string or null",
  "jd_skills_demonstrated": ["string"],
  "spoken_feedback": "string",
  "ideal_answer": "string"
}
```
* **Client-Side Composite Score Calculation:**
$$\text{Score} = (\text{relevance}\times0.25 + \text{depth}\times0.25 + \text{clarity}\times0.20 + \text{structure}\times0.15 + \text{confidence}\times0.15) \times 10$$

---

### Call C: Final Coaching Summary Contract
* **Role:** Executive career coach synthesizing multi-question patterns, biometric telemetry, and skill coverage gaps.
* **JSON Output Schema:**
```json
{
  "verdict": "Interview Ready | Almost There | Needs Practice | Keep Building",
  "headline": "string",
  "top_strengths": ["string"],
  "top_weaknesses": ["string"],
  "improvement_plan": [
    { "step": "string", "exercise": "string" }
  ],
  "practice_questions": ["string"],
  "resume_highlights_to_mention": ["string"],
  "body_language_tip": "string or null",
  "closing_line": "string"
}
```