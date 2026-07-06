const OpenAI = require("openai");
require("dotenv").config();

const groqKey = process.env.GROQ_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

const client = groqKey
  ? new OpenAI({
      apiKey: groqKey,
      baseURL: "https://api.groq.com/openai/v1",
    })
  : openaiKey
    ? new OpenAI({ apiKey: openaiKey })
    : null;

async function askInterviewer(resumeText, jobDesc, userText, options = {}) {
  if (!client) {
    throw new Error(
      "Missing AI API key. Set GROQ_API_KEY or OPENAI_API_KEY in .env."
    );
  }

  const model = groqKey ? "llama-3.3-70b-versatile" : "gpt-4o-mini";
  const difficultyLevel = Number(options.difficultyLevel) || 3;
  const difficultyLabel = options.difficultyLabel || "medium";
  const difficultyGuide = options.difficultyGuide || "Ask a balanced interview question.";

  const systemPrompt = `
You are a professional technical interviewer.
Your job is to run a realistic mock interview based on the candidate's resume and the target role.

Instructions:
- Ask or answer like a real interviewer, not like a chatbot assistant.
- Keep responses concise, clear, and interview-focused.
- Use the resume and job description as context.
- If the candidate gives a weak or partial answer, ask a short follow-up.
- Focus on skills, projects, problem solving, backend engineering, APIs, Java, and DSA when relevant.
- Do not invent resume details that are not present.
- Current adaptive difficulty level is ${difficultyLevel}/5 (${difficultyLabel}).
- Difficulty guidance: ${difficultyGuide}
`.trim();

  const userPrompt = `
Candidate Resume:
${resumeText || "No resume provided."}

Target Job Description:
${jobDesc || "No job description provided."}

Candidate's latest message:
${userText || ""}

Respond as the interviewer. If appropriate, either:
1. evaluate the candidate's answer briefly and ask the next interview question, or
2. ask a clarifying follow-up question.
`.trim();

  const response = await client.chat.completions.create({
    model,
    temperature: 0.7,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return (
    response.choices?.[0]?.message?.content?.trim() ||
    "Let's continue. Can you walk me through one of your recent projects?"
  );
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function safeParseJsonObject(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return null;
    }
  }
}

async function scoreCandidateAnswer(resumeText, jobDesc, userText, interviewerReply) {
  if (!client) {
    throw new Error(
      "Missing AI API key. Set GROQ_API_KEY or OPENAI_API_KEY in .env."
    );
  }

  const model = groqKey ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

  const systemPrompt = `
You are an interview answer evaluator.
Score only the candidate's latest answer on a 1-10 scale for:
- clarity
- correctness
- depth
- communication

Return strict JSON only with this schema:
{
  "clarity": number,
  "correctness": number,
  "depth": number,
  "communication": number,
  "feedback": "one short sentence"
}
`.trim();

  const userPrompt = `
Candidate Resume:
${resumeText || "No resume provided."}

Target Job Description:
${jobDesc || "No job description provided."}

Candidate's latest answer:
${userText || ""}

Interviewer response after this answer:
${interviewerReply || ""}
`.trim();

  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content?.trim() || "";
  const parsed = safeParseJsonObject(raw) || {};

  const clarity = clampScore(parsed.clarity);
  const correctness = clampScore(parsed.correctness);
  const depth = clampScore(parsed.depth);
  const communication = clampScore(parsed.communication);
  const feedback =
    typeof parsed.feedback === "string" && parsed.feedback.trim()
      ? parsed.feedback.trim()
      : "Good attempt. Keep answers more specific and structured for better impact.";

  return {
    clarity,
    correctness,
    depth,
    communication,
    feedback,
    overall: Number(((clarity + correctness + depth + communication) / 4).toFixed(2)),
  };
}

async function analyzeResumeGaps(resumeText, jobDesc) {
  if (!client) {
    throw new Error(
      "Missing AI API key. Set GROQ_API_KEY or OPENAI_API_KEY in .env."
    );
  }

  const model = groqKey ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

  const systemPrompt = `
You are a resume-vs-job-description analyzer.
Compare the candidate resume against the target job description.
Only use evidence present in the input text.

Return strict JSON only with this schema:
{
  "matchScore": number,
  "summary": "short summary",
  "missingSkills": ["..."],
  "weakAreas": ["..."],
  "improvementSuggestions": ["..."],
  "resumeBulletSuggestions": ["..."]
}

Rules:
- matchScore must be 1-10.
- Keep each list concise (3-8 items each).
- Suggestions must be practical and specific.
`.trim();

  const userPrompt = `
Candidate Resume:
${resumeText || "No resume provided."}

Target Job Description:
${jobDesc || "No job description provided."}
`.trim();

  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content?.trim() || "";
  const parsed = safeParseJsonObject(raw) || {};

  const toStringArray = (value) =>
    Array.isArray(value)
      ? value
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [];

  return {
    matchScore: clampScore(parsed.matchScore),
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : "Resume partially matches the role, but key skills and evidence can be improved.",
    missingSkills: toStringArray(parsed.missingSkills),
    weakAreas: toStringArray(parsed.weakAreas),
    improvementSuggestions: toStringArray(parsed.improvementSuggestions),
    resumeBulletSuggestions: toStringArray(parsed.resumeBulletSuggestions),
  };
}

async function generateCodingRoundPrompt(resumeText, jobDesc, difficultyLevel = 3) {
  if (!client) {
    throw new Error(
      "Missing AI API key. Set GROQ_API_KEY or OPENAI_API_KEY in .env."
    );
  }

  const model = groqKey ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

  const systemPrompt = `
You are a DSA coding interviewer.
Generate one coding problem tailored to the role and candidate context.
Return strict JSON:
{
  "title": "string",
  "difficulty": "Easy|Medium|Hard",
  "problem": "string",
  "constraints": ["..."],
  "functionSignature": "string",
  "examples": ["..."],
  "testCases": [{"input":"...","expected":"..."}],
  "hints": ["..."]
}

Rules:
- Provide exactly 4 test cases.
- Keep problem practical and interview-grade.
- Use difficulty based on level 1-5 (1 very easy, 5 very hard).
`.trim();

  const userPrompt = `
Difficulty level: ${difficultyLevel}/5

Candidate Resume:
${resumeText || "No resume provided."}

Target Job Description:
${jobDesc || "No job description provided."}
`.trim();

  const response = await client.chat.completions.create({
    model,
    temperature: 0.5,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content?.trim() || "";
  const parsed = safeParseJsonObject(raw) || {};
  const toArr = (v) => (Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : []);
  const tests = Array.isArray(parsed.testCases) ? parsed.testCases : [];

  return {
    title: String(parsed.title || "Coding Round Problem"),
    difficulty: String(parsed.difficulty || "Medium"),
    problem: String(parsed.problem || "Solve the problem using an efficient algorithm."),
    constraints: toArr(parsed.constraints),
    functionSignature: String(parsed.functionSignature || "function solve(input) { }"),
    examples: toArr(parsed.examples),
    testCases: tests.slice(0, 4).map((t) => ({
      input: String(t?.input || ""),
      expected: String(t?.expected || ""),
    })),
    hints: toArr(parsed.hints),
  };
}

async function evaluateCodingRoundSolution(problem, solution, language = "javascript") {
  if (!client) {
    throw new Error(
      "Missing AI API key. Set GROQ_API_KEY or OPENAI_API_KEY in .env."
    );
  }

  const model = groqKey ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

  const systemPrompt = `
You are a DSA code reviewer.
Evaluate the submitted solution against the provided coding prompt and test cases.
Return strict JSON:
{
  "score": number,
  "verdict": "Strong|Good|Needs Improvement",
  "passedCount": number,
  "totalCount": number,
  "testCaseResults":[{"input":"...","expected":"...","status":"pass|fail","reason":"..."}],
  "timeComplexity":"string",
  "spaceComplexity":"string",
  "feedback":["..."],
  "improvedApproach":"string"
}

Rules:
- score is 1-10.
- Be strict but fair.
- If code is incomplete, fail relevant tests.
`.trim();

  const userPrompt = `
Language: ${language}
Problem JSON:
${JSON.stringify(problem)}

Candidate Solution:
${solution || ""}
`.trim();

  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content?.trim() || "";
  const parsed = safeParseJsonObject(raw) || {};
  const testCaseResults = Array.isArray(parsed.testCaseResults) ? parsed.testCaseResults : [];
  const feedback = Array.isArray(parsed.feedback)
    ? parsed.feedback.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  const score = clampScore(parsed.score);
  const passedCount = Math.max(0, Math.min(4, Number(parsed.passedCount) || 0));
  const totalCount = Math.max(passedCount, Math.min(4, Number(parsed.totalCount) || 4));

  return {
    score,
    verdict: String(parsed.verdict || "Needs Improvement"),
    passedCount,
    totalCount,
    testCaseResults: testCaseResults.slice(0, 4).map((tc) => ({
      input: String(tc?.input || ""),
      expected: String(tc?.expected || ""),
      status: tc?.status === "pass" ? "pass" : "fail",
      reason: String(tc?.reason || ""),
    })),
    timeComplexity: String(parsed.timeComplexity || "Not clearly stated"),
    spaceComplexity: String(parsed.spaceComplexity || "Not clearly stated"),
    feedback,
    improvedApproach: String(parsed.improvedApproach || "Refine the approach and handle edge cases."),
  };
}

async function generateCompanyRound(company, resumeText, jobDesc, difficultyLevel = 3) {
  if (!client) {
    throw new Error(
      "Missing AI API key. Set GROQ_API_KEY or OPENAI_API_KEY in .env."
    );
  }

  const model = groqKey ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

  const systemPrompt = `
You design company-style mock interview rounds.
Generate one round for the target company with these sections:
1) behavior
2) coding
3) system_design

Return strict JSON:
{
  "company":"Google|Amazon|TCS",
  "roundTitle":"string",
  "behavior":{"question":"string","whatToAssess":["..."]},
  "coding":{"question":"string","testCases":[{"input":"...","expected":"..."}]},
  "systemDesign":{"question":"string","focusAreas":["..."]},
  "tips":["..."]
}

Rules:
- Match the style of the requested company.
- Keep coding testCases to exactly 3.
- Keep content realistic and interview-focused.
`.trim();

  const userPrompt = `
Target company: ${company}
Difficulty level: ${difficultyLevel}/5

Candidate Resume:
${resumeText || "No resume provided."}

Target Job Description:
${jobDesc || "No job description provided."}
`.trim();

  const response = await client.chat.completions.create({
    model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content?.trim() || "";
  const parsed = safeParseJsonObject(raw) || {};
  const toArr = (v) =>
    Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];

  const testCases = Array.isArray(parsed?.coding?.testCases)
    ? parsed.coding.testCases
    : [];

  return {
    company: String(parsed.company || company || "Google"),
    roundTitle: String(parsed.roundTitle || `${company} Mock Interview Round`),
    behavior: {
      question: String(parsed?.behavior?.question || "Tell me about a challenging project and how you handled tradeoffs."),
      whatToAssess: toArr(parsed?.behavior?.whatToAssess),
    },
    coding: {
      question: String(parsed?.coding?.question || "Solve an interview coding problem and explain your approach."),
      testCases: testCases.slice(0, 3).map((tc) => ({
        input: String(tc?.input || ""),
        expected: String(tc?.expected || ""),
      })),
    },
    systemDesign: {
      question: String(parsed?.systemDesign?.question || "Design a scalable service for interview practice sessions."),
      focusAreas: toArr(parsed?.systemDesign?.focusAreas),
    },
    tips: toArr(parsed.tips),
  };
}

async function evaluateCompanyRoundAnswer(company, section, question, answer) {
  if (!client) {
    throw new Error(
      "Missing AI API key. Set GROQ_API_KEY or OPENAI_API_KEY in .env."
    );
  }

  const model = groqKey ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

  const systemPrompt = `
You evaluate interview answers in company-style rounds.
Return strict JSON:
{
  "score": number,
  "feedback":"string",
  "improvements":["..."],
  "nextQuestion":"string"
}

Rules:
- score must be 1-10.
- feedback should be concise and practical.
- nextQuestion must fit the same section.
`.trim();

  const userPrompt = `
Company: ${company}
Section: ${section}
Question: ${question}
Candidate answer:
${answer || ""}
`.trim();

  const response = await client.chat.completions.create({
    model,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content?.trim() || "";
  const parsed = safeParseJsonObject(raw) || {};
  const improvements = Array.isArray(parsed.improvements)
    ? parsed.improvements.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  return {
    score: clampScore(parsed.score),
    feedback: String(parsed.feedback || "Decent start. Add more structure, specifics, and measurable outcomes."),
    improvements,
    nextQuestion: String(parsed.nextQuestion || "Can you go deeper with a concrete example and tradeoff discussion?"),
  };
}

async function generatePersonalizedRecommendations(resumeText, jobDesc, scoreSummary, gapAnalysis) {
  if (!client) {
    throw new Error(
      "Missing AI API key. Set GROQ_API_KEY or OPENAI_API_KEY in .env."
    );
  }

  const model = groqKey ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

  const systemPrompt = `
You are an interview coach generating personalized recommendations.
Return strict JSON:
{
  "summary":"string",
  "priorityActions":["..."],
  "practicePlan":["..."],
  "resumeImprovements":["..."],
  "next7DaysPlan":["..."]
}

Rules:
- Keep each list concise (3-6 items).
- Make recommendations specific and practical.
- Use score and gap context if available.
`.trim();

  const userPrompt = `
Candidate Resume:
${resumeText || "No resume provided."}

Target Job Description:
${jobDesc || "No job description provided."}

Score Summary JSON:
${JSON.stringify(scoreSummary || {}, null, 2)}

Gap Analysis JSON:
${JSON.stringify(gapAnalysis || {}, null, 2)}
`.trim();

  const response = await client.chat.completions.create({
    model,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content?.trim() || "";
  const parsed = safeParseJsonObject(raw) || {};
  const toArr = (v) =>
    Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];

  return {
    summary: String(parsed.summary || "You are making progress, and focused iteration will improve your interview readiness."),
    priorityActions: toArr(parsed.priorityActions),
    practicePlan: toArr(parsed.practicePlan),
    resumeImprovements: toArr(parsed.resumeImprovements),
    next7DaysPlan: toArr(parsed.next7DaysPlan),
  };
}

module.exports = {
  askInterviewer,
  scoreCandidateAnswer,
  analyzeResumeGaps,
  generateCodingRoundPrompt,
  evaluateCodingRoundSolution,
  generateCompanyRound,
  evaluateCompanyRoundAnswer,
  generatePersonalizedRecommendations,
};
