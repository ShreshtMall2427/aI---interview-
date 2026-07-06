require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const crypto = require('crypto');
const { SarvamAIClient } = require('sarvamai');

const { parsePDF, parseImage } = require('./resumeParser');
const {
  askInterviewer,
  scoreCandidateAnswer,
  analyzeResumeGaps,
  generateCodingRoundPrompt,
  evaluateCodingRoundSolution,
  generateCompanyRound,
  evaluateCompanyRoundAnswer,
  generatePersonalizedRecommendations,
} = require('./llm');

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const usersDbPath = path.join(dataDir, 'users.json');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname);
  }
});

const upload = multer({ storage });
const audioUpload = multer({ storage });

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));

const sarvamClient = process.env.SARVAM_API_KEY
  ? new SarvamAIClient({
      apiSubscriptionKey: process.env.SARVAM_API_KEY,
    })
  : null;

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

function loadUsersDb() {
  if (!fs.existsSync(usersDbPath)) {
    return { users: [], sessions: [] };
  }
  try {
    const raw = fs.readFileSync(usersDbPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
    };
  } catch (_) {
    return { users: [], sessions: [] };
  }
}

function saveUsersDb(db) {
  fs.writeFileSync(usersDbPath, JSON.stringify(db, null, 2), 'utf8');
}

function newUserState() {
  return {
    jobDescription: '',
    lastParsedResume: null,
    scoreHistory: [],
    currentDifficultyLevel: 3,
    latestGapAnalysis: null,
    codingRoundState: null,
    companyRoundState: null,
    conversation: [],
    recommendations: null,
    lastSessionAt: null,
    savedResumes: []
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    state: user.state
  };
}

function clampDifficulty(level) {
  return Math.max(1, Math.min(5, Math.round(level)));
}

function getDifficultyLabel(level) {
  if (level <= 1) return 'very easy';
  if (level === 2) return 'easy';
  if (level === 3) return 'medium';
  if (level === 4) return 'hard';
  return 'very hard';
}

function getDifficultyGuide(level) {
  if (level <= 1) {
    return 'Ask straightforward fundamentals, short definitions, and simple project explanations.';
  }
  if (level === 2) {
    return 'Ask beginner-to-intermediate conceptual questions with light follow-ups.';
  }
  if (level === 3) {
    return 'Ask balanced intermediate questions with practical reasoning and tradeoffs.';
  }
  if (level === 4) {
    return 'Ask deeper scenario-based questions requiring detailed design and decision-making.';
  }
  return 'Ask advanced system design, optimization, and edge-case questions with strict follow-ups.';
}

function recalculateDifficultyFromScores(scoreHistory) {
  if (!scoreHistory.length) return 3;

  const recent = scoreHistory.slice(-3);
  const avg =
    recent.reduce((sum, row) => sum + (Number(row.overall) || 0), 0) / recent.length;

  if (avg >= 9) return 5;
  if (avg >= 8) return 4;
  if (avg >= 6) return 3;
  if (avg >= 4.5) return 2;
  return 1;
}

function requireAuth(req, res, next) {
  const token = req.header('x-auth-token');
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing auth token' });
  }

  const db = loadUsersDb();
  const session = db.sessions.find((s) => s.token === token);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Invalid session' });
  }

  const user = db.users.find((u) => u.id === session.userId);
  if (!user) {
    return res.status(401).json({ ok: false, error: 'User not found for session' });
  }

  if (!user.state || typeof user.state !== 'object') {
    user.state = newUserState();
    saveUsersDb(db);
  }

  req.auth = { token, userId: user.id };
  req.db = db;
  req.user = user;
  next();
}

function persistAuthUser(req) {
  saveUsersDb(req.db);
}

function getJobDescriptionFromState(state) {
  return String(state?.jobDescription || '').trim();
}

app.post('/auth/register', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: 'name, email, and password are required' });
    }

    const db = loadUsersDb();
    if (db.users.some((u) => u.email === email)) {
      return res.status(400).json({ ok: false, error: 'Email already registered' });
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash: hashPassword(password),
      state: newUserState(),
      createdAt: new Date().toISOString()
    };

    db.users.push(user);
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    saveUsersDb(db);

    res.json({ ok: true, token, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/auth/login', (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'email and password are required' });
    }

    const db = loadUsersDb();
    const user = db.users.find((u) => u.email === email);
    if (!user || user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    saveUsersDb(db);

    res.json({ ok: true, token, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: sanitizeUser(req.user) });
});

app.post('/upload', requireAuth, upload.single('resume'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = '';
    if (ext === '.pdf') {
      text = await parsePDF(filePath);
    } else {
      text = await parseImage(filePath);
    }

    const state = req.user.state;
    state.lastParsedResume = text;
    state.scoreHistory = [];
    state.currentDifficultyLevel = 3;
    state.latestGapAnalysis = null;
    state.codingRoundState = null;
    state.companyRoundState = null;
    state.conversation = [];
    state.recommendations = null;
    state.savedResumes.unshift({
      id: Date.now() + '-' + Math.round(Math.random() * 1e6),
      fileName: req.file.originalname,
      uploadedAt: new Date().toISOString(),
      previewText: String(text || '').slice(0, 800)
    });
    state.savedResumes = state.savedResumes.slice(0, 10);

    persistAuthUser(req);
    res.json({ ok: true, text, savedResumes: state.savedResumes });
  } catch (err) {
    console.error('Upload error', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/ask', requireAuth, async (req, res) => {
  try {
    const { userText } = req.body;
    const state = req.user.state;
    const jobDescription = getJobDescriptionFromState(state);
    if (!state.lastParsedResume) {
      return res.status(400).json({ ok: false, error: 'No resume uploaded' });
    }
    if (!jobDescription) {
      return res.status(400).json({ ok: false, error: 'No job description set' });
    }

    state.currentDifficultyLevel = clampDifficulty(recalculateDifficultyFromScores(state.scoreHistory));
    const difficultyLabel = getDifficultyLabel(state.currentDifficultyLevel);
    const difficultyGuide = getDifficultyGuide(state.currentDifficultyLevel);

    const reply = await askInterviewer(state.lastParsedResume, jobDescription, userText || '', {
      difficultyLevel: state.currentDifficultyLevel,
      difficultyLabel,
      difficultyGuide
    });
    const score = await scoreCandidateAnswer(state.lastParsedResume, jobDescription, userText || '', reply);
    const scoreEntry = {
      id: Date.now() + '-' + Math.round(Math.random() * 1e6),
      timestamp: new Date().toISOString(),
      source: 'text',
      answer: userText || '',
      difficultyLevel: state.currentDifficultyLevel,
      difficultyLabel,
      ...score
    };
    state.scoreHistory.push(scoreEntry);
    state.currentDifficultyLevel = clampDifficulty(recalculateDifficultyFromScores(state.scoreHistory));
    state.conversation.push({ who: 'You', text: userText || '', timestamp: new Date().toISOString() });
    state.conversation.push({ who: 'Interviewer', text: reply, timestamp: new Date().toISOString() });
    state.lastSessionAt = new Date().toISOString();
    const audioBase64 = sarvamClient ? await synthesizeSpeech(reply) : null;

    persistAuthUser(req);
    res.json({
      ok: true,
      reply,
      audioBase64,
      scoreEntry,
      scoreHistory: state.scoreHistory,
      adaptiveDifficulty: {
        level: state.currentDifficultyLevel,
        label: getDifficultyLabel(state.currentDifficultyLevel),
        guide: getDifficultyGuide(state.currentDifficultyLevel)
      }
    });
  } catch (err) {
    console.error('Ask error', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/job', requireAuth, (req, res) => {
  try {
    const { jobDesc } = req.body;
    if (!jobDesc || typeof jobDesc !== 'string') {
      return res.status(400).json({ ok: false, error: 'Invalid jobDesc' });
    }

    const state = req.user.state;
    state.jobDescription = jobDesc.trim();
    state.latestGapAnalysis = null;
    state.codingRoundState = null;
    state.companyRoundState = null;
    state.recommendations = null;
    persistAuthUser(req);
    res.json({ ok: true, jobDescription: state.jobDescription });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/resume', requireAuth, (req, res) => {
  res.json({ ok: true, text: req.user.state.lastParsedResume });
});

app.get('/saved-resumes', requireAuth, (req, res) => {
  res.json({ ok: true, savedResumes: req.user.state.savedResumes || [] });
});

app.get('/sessions', requireAuth, (req, res) => {
  const state = req.user.state;
  const latestScore = state.scoreHistory.length ? state.scoreHistory[state.scoreHistory.length - 1] : null;
  const session = {
    lastSessionAt: state.lastSessionAt,
    totalTurns: state.scoreHistory.length,
    latestOverall: latestScore ? latestScore.overall : null,
    adaptiveDifficulty: {
      level: state.currentDifficultyLevel,
      label: getDifficultyLabel(state.currentDifficultyLevel),
      guide: getDifficultyGuide(state.currentDifficultyLevel)
    },
    recentConversation: (state.conversation || []).slice(-12)
  };
  res.json({ ok: true, session });
});

app.get('/history', requireAuth, (req, res) => {
  const db = loadUsersDb();
  const history = (db.users || []).map((user) => {
    const state = user.state || newUserState();
    const latestScore = state.scoreHistory?.length
      ? state.scoreHistory[state.scoreHistory.length - 1]
      : null;

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt || null,
      lastSessionAt: state.lastSessionAt || null,
      totalInterviewTurns: Array.isArray(state.scoreHistory) ? state.scoreHistory.length : 0,
      latestOverallScore: latestScore ? latestScore.overall : null,
      savedResumesCount: Array.isArray(state.savedResumes) ? state.savedResumes.length : 0,
      recentConversation: Array.isArray(state.conversation) ? state.conversation.slice(-6) : []
    };
  });

  res.json({ ok: true, history });
});

app.get('/scores', requireAuth, (req, res) => {
  const state = req.user.state;
  res.json({
    ok: true,
    scoreHistory: state.scoreHistory,
    adaptiveDifficulty: {
      level: state.currentDifficultyLevel,
      label: getDifficultyLabel(state.currentDifficultyLevel),
      guide: getDifficultyGuide(state.currentDifficultyLevel)
    }
  });
});

app.get('/resume-gap', requireAuth, async (req, res) => {
  try {
    const state = req.user.state;
    const jobDescription = getJobDescriptionFromState(state);
    if (!state.lastParsedResume) {
      return res.status(400).json({ ok: false, error: 'No resume uploaded' });
    }

    if (!jobDescription) {
      return res.status(400).json({ ok: false, error: 'No job description set' });
    }

    if (!state.latestGapAnalysis) {
      state.latestGapAnalysis = await analyzeResumeGaps(state.lastParsedResume, jobDescription);
      persistAuthUser(req);
    }

    res.json({ ok: true, gapAnalysis: state.latestGapAnalysis });
  } catch (err) {
    console.error('Resume gap analysis error', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to analyze resume gaps' });
  }
});

app.get('/recommendations', requireAuth, async (req, res) => {
  try {
    const state = req.user.state;
    const jobDescription = getJobDescriptionFromState(state);
    if (!state.lastParsedResume) {
      return res.status(400).json({ ok: false, error: 'No resume uploaded' });
    }
    if (!jobDescription) {
      return res.status(400).json({ ok: false, error: 'No job description set' });
    }

    const latestScore = state.scoreHistory.length ? state.scoreHistory[state.scoreHistory.length - 1] : null;
    const scoreSummary = latestScore
      ? {
          latestOverall: latestScore.overall,
          avgClarity: Number((state.scoreHistory.reduce((a, b) => a + (Number(b.clarity) || 0), 0) / state.scoreHistory.length).toFixed(2)),
          avgCorrectness: Number((state.scoreHistory.reduce((a, b) => a + (Number(b.correctness) || 0), 0) / state.scoreHistory.length).toFixed(2)),
          avgDepth: Number((state.scoreHistory.reduce((a, b) => a + (Number(b.depth) || 0), 0) / state.scoreHistory.length).toFixed(2)),
          avgCommunication: Number((state.scoreHistory.reduce((a, b) => a + (Number(b.communication) || 0), 0) / state.scoreHistory.length).toFixed(2)),
        }
      : null;

    state.recommendations = await generatePersonalizedRecommendations(
      state.lastParsedResume,
      jobDescription,
      scoreSummary,
      state.latestGapAnalysis
    );

    persistAuthUser(req);
    res.json({ ok: true, recommendations: state.recommendations });
  } catch (err) {
    console.error('Recommendation error', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to generate recommendations' });
  }
});

app.post('/coding/start', requireAuth, async (req, res) => {
  try {
    const state = req.user.state;
    const jobDescription = getJobDescriptionFromState(state);
    if (!state.lastParsedResume) {
      return res.status(400).json({ ok: false, error: 'No resume uploaded' });
    }
    if (!jobDescription) {
      return res.status(400).json({ ok: false, error: 'No job description set' });
    }

    const requestedMinutes = Number(req.body?.durationMinutes) || 25;
    const durationMinutes = Math.max(10, Math.min(90, Math.round(requestedMinutes)));
    const problem = await generateCodingRoundPrompt(state.lastParsedResume, jobDescription, state.currentDifficultyLevel);
    const now = Date.now();
    state.codingRoundState = {
      id: now + '-' + Math.round(Math.random() * 1e6),
      startedAt: now,
      durationMinutes,
      deadlineAt: now + durationMinutes * 60 * 1000,
      problem,
      submission: null
    };

    persistAuthUser(req);
    res.json({ ok: true, codingRound: state.codingRoundState });
  } catch (err) {
    console.error('Coding start error', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to start coding round' });
  }
});

app.get('/coding/state', requireAuth, (req, res) => {
  const state = req.user.state;
  if (!state.lastParsedResume) {
    state.codingRoundState = null;
    persistAuthUser(req);
    return res.json({ ok: true, codingRound: null });
  }

  if (!state.codingRoundState) {
    return res.json({ ok: true, codingRound: null });
  }

  const remainingMs = Math.max(0, state.codingRoundState.deadlineAt - Date.now());
  res.json({
    ok: true,
    codingRound: {
      ...state.codingRoundState,
      remainingMs,
      isExpired: remainingMs <= 0
    }
  });
});

app.post('/coding/stop', requireAuth, (req, res) => {
  req.user.state.codingRoundState = null;
  persistAuthUser(req);
  res.json({ ok: true, codingRound: null });
});

app.post('/company-round/start', requireAuth, async (req, res) => {
  try {
    const state = req.user.state;
    const jobDescription = getJobDescriptionFromState(state);
    if (!state.lastParsedResume) {
      return res.status(400).json({ ok: false, error: 'No resume uploaded' });
    }
    if (!jobDescription) {
      return res.status(400).json({ ok: false, error: 'No job description set' });
    }

    const companyInput = String(req.body?.company || 'Google').trim().toLowerCase();
    const company =
      companyInput === 'amazon'
        ? 'Amazon'
        : companyInput === 'tcs'
          ? 'TCS'
          : 'Google';

    const round = await generateCompanyRound(
      company,
      state.lastParsedResume,
      jobDescription,
      state.currentDifficultyLevel
    );

    state.companyRoundState = {
      id: Date.now() + '-' + Math.round(Math.random() * 1e6),
      company,
      round,
      history: []
    };

    persistAuthUser(req);
    res.json({ ok: true, companyRound: state.companyRoundState });
  } catch (err) {
    console.error('Company round start error', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to start company round' });
  }
});

app.get('/company-round/state', requireAuth, (req, res) => {
  const state = req.user.state;
  if (!state.lastParsedResume) {
    state.companyRoundState = null;
    persistAuthUser(req);
    return res.json({ ok: true, companyRound: null });
  }

  res.json({ ok: true, companyRound: state.companyRoundState });
});

app.post('/company-round/answer', requireAuth, async (req, res) => {
  try {
    const state = req.user.state;
    if (!state.lastParsedResume) {
      state.companyRoundState = null;
      persistAuthUser(req);
      return res.status(400).json({ ok: false, error: 'No resume uploaded' });
    }

    if (!state.companyRoundState) {
      return res.status(400).json({ ok: false, error: 'No active company round' });
    }

    const section = String(req.body?.section || '').trim();
    const answer = String(req.body?.answer || '').trim();
    const question = String(req.body?.question || '').trim();

    if (!section || !question || !answer) {
      return res.status(400).json({ ok: false, error: 'section, question, and answer are required' });
    }

    const evaluation = await evaluateCompanyRoundAnswer(
      state.companyRoundState.company,
      section,
      question,
      answer
    );

    state.companyRoundState.history.push({
      id: Date.now() + '-' + Math.round(Math.random() * 1e6),
      timestamp: new Date().toISOString(),
      section,
      question,
      answer,
      evaluation
    });

    persistAuthUser(req);
    res.json({ ok: true, evaluation, companyRound: state.companyRoundState });
  } catch (err) {
    console.error('Company round answer error', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to evaluate company round answer' });
  }
});

app.post('/coding/submit', requireAuth, async (req, res) => {
  try {
    const state = req.user.state;
    if (!state.lastParsedResume) {
      state.codingRoundState = null;
      persistAuthUser(req);
      return res.status(400).json({ ok: false, error: 'No resume uploaded' });
    }

    if (!state.codingRoundState) {
      return res.status(400).json({ ok: false, error: 'No active coding round' });
    }

    const solution = String(req.body?.solution || '').trim();
    const language = String(req.body?.language || 'javascript').trim();
    if (!solution) {
      return res.status(400).json({ ok: false, error: 'Solution is empty' });
    }

    const submittedAt = Date.now();
    const remainingMs = Math.max(0, state.codingRoundState.deadlineAt - submittedAt);
    const isLate = remainingMs <= 0;

    const evaluation = await evaluateCodingRoundSolution(state.codingRoundState.problem, solution, language);
    state.codingRoundState = {
      ...state.codingRoundState,
      submission: {
        submittedAt,
        language,
        isLate,
        solution,
        evaluation
      }
    };

    persistAuthUser(req);
    res.json({
      ok: true,
      codingRound: {
        ...state.codingRoundState,
        remainingMs,
        isExpired: remainingMs <= 0
      }
    });
  } catch (err) {
    console.error('Coding submit error', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to submit coding solution' });
  }
});

async function synthesizeSpeech(text) {
  if (!sarvamClient) {
    throw new Error('Missing SARVAM_API_KEY in .env');
  }

  const response = await sarvamClient.textToSpeech.convert({
    text,
    model: 'bulbul:v3',
    speaker: 'shubh',
    target_language_code: 'en-IN'
  });

  return response.audios?.[0] || null;
}

app.post('/voice-turn', requireAuth, audioUpload.single('audio'), async (req, res) => {
  if (!sarvamClient) {
    return res.status(500).json({ ok: false, error: 'Missing SARVAM_API_KEY in .env' });
  }

  const state = req.user.state;
  const jobDescription = getJobDescriptionFromState(state);
  if (!state.lastParsedResume) {
    return res.status(400).json({ ok: false, error: 'No resume uploaded' });
  }
  if (!jobDescription) {
    return res.status(400).json({ ok: false, error: 'No job description set' });
  }

  if (!req.file?.path) {
    return res.status(400).json({ ok: false, error: 'No audio file uploaded' });
  }

  try {
    const audioFile = fs.createReadStream(req.file.path);

    const sttResponse = await sarvamClient.speechToText.transcribe({
      file: audioFile,
      model: 'saaras:v3',
      mode: 'transcribe'
    });

    const transcript = sttResponse?.transcript?.trim();
    if (!transcript) {
      return res.status(400).json({
        ok: false,
        error: 'No speech detected. Please try speaking a little longer.'
      });
    }

    state.currentDifficultyLevel = clampDifficulty(recalculateDifficultyFromScores(state.scoreHistory));
    const difficultyLabel = getDifficultyLabel(state.currentDifficultyLevel);
    const difficultyGuide = getDifficultyGuide(state.currentDifficultyLevel);

    const reply = await askInterviewer(state.lastParsedResume, jobDescription, transcript, {
      difficultyLevel: state.currentDifficultyLevel,
      difficultyLabel,
      difficultyGuide
    });
    const score = await scoreCandidateAnswer(state.lastParsedResume, jobDescription, transcript, reply);
    const scoreEntry = {
      id: Date.now() + '-' + Math.round(Math.random() * 1e6),
      timestamp: new Date().toISOString(),
      source: 'voice',
      answer: transcript,
      difficultyLevel: state.currentDifficultyLevel,
      difficultyLabel,
      ...score
    };
    state.scoreHistory.push(scoreEntry);
    state.currentDifficultyLevel = clampDifficulty(recalculateDifficultyFromScores(state.scoreHistory));
    state.conversation.push({ who: 'You', text: transcript, timestamp: new Date().toISOString() });
    state.conversation.push({ who: 'Interviewer', text: reply, timestamp: new Date().toISOString() });
    state.lastSessionAt = new Date().toISOString();
    const audioBase64 = await synthesizeSpeech(reply);

    persistAuthUser(req);
    res.json({
      ok: true,
      transcript,
      reply,
      audioBase64,
      scoreEntry,
      scoreHistory: state.scoreHistory,
      adaptiveDifficulty: {
        level: state.currentDifficultyLevel,
        label: getDifficultyLabel(state.currentDifficultyLevel),
        guide: getDifficultyGuide(state.currentDifficultyLevel)
      }
    });
  } catch (err) {
    console.error('Voice turn error', err);
    res.status(500).json({ ok: false, error: err.message || 'Voice interview failed' });
  } finally {
    fs.promises.unlink(req.file.path).catch(() => {});
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server listening on ${port}`));
