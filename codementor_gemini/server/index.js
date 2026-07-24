// index.js
// Codementor backend: serves the frontend, persists progress locally,
// talks to the Gemini API for tutoring/challenges, and can run
// learner-submitted Python locally for real (not simulated) output.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

import { readState, writeState, resetState } from './store.js';
import { chatComplete } from './gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const LANG_LABEL = { javascript: 'JavaScript', python: 'Python', webdev: 'HTML & CSS' };
const label = (v) => LANG_LABEL[v] || v;

// ---------------------------------------------------------------
// Profile & progress
// ---------------------------------------------------------------

app.get('/api/state', (req, res) => {
  res.json(readState());
});

app.post('/api/profile', (req, res) => {
  const { language, level } = req.body || {};
  if (!language || !level) {
    return res.status(400).json({ error: 'language and level are required' });
  }
  const state = readState();
  state.profile = { language, level };
  if (state.chatHistory.length === 0) {
    state.chatHistory.push({
      role: 'assistant',
      content:
        `Hey! I'm your tutor for ${label(language)} at the ${level} level. ` +
        `Ask me anything, or click a topic on the left and I'll teach it. ` +
        `You can also drop code into the Playground and I'll help you debug or understand it. ` +
        `What do you want to start with?`
    });
  }
  writeState(state);
  res.json(state);
});

app.post('/api/reset', (req, res) => {
  res.json(resetState());
});

app.post('/api/activity/touch', (req, res) => {
  const state = readState();
  const today = new Date().toISOString().slice(0, 10);
  state.activityLog[today] = true;
  writeState(state);
  res.json({ activityLog: state.activityLog });
});

app.post('/api/topics/complete', (req, res) => {
  const { language, topic } = req.body || {};
  if (!language || !topic) return res.status(400).json({ error: 'language and topic required' });
  const state = readState();
  if (!state.completedTopics[language]) state.completedTopics[language] = {};
  state.completedTopics[language][topic] = true;
  writeState(state);
  res.json({ completedTopics: state.completedTopics });
});

// ---------------------------------------------------------------
// Chat
// ---------------------------------------------------------------

app.post('/api/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });

  const state = readState();
  if (!state.profile) return res.status(400).json({ error: 'No profile set yet' });

  state.chatHistory.push({ role: 'user', content: message });

  const sysPrompt =
    `You are Codementor, a warm, patient, precise coding tutor embedded in a learning app. ` +
    `The learner is studying ${label(state.profile.language)} at a ${state.profile.level} level. ` +
    `Keep explanations concise but complete. Use short code examples in fenced code blocks. ` +
    `Prefer teaching through small runnable examples over long theory. When explaining an error or code, ` +
    `be specific about the line or concept at fault. When appropriate, end with one short follow-up question ` +
    `to check understanding, but don't do this every single message.`;

  const apiMessages = state.chatHistory.slice(-16).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content
  }));

  try {
    const reply = await chatComplete({ system: sysPrompt, messages: apiMessages, maxTokens: 1000 });
    state.chatHistory.push({ role: 'assistant', content: reply || "Sorry, I couldn't generate a response." });
    state.chatHistory = state.chatHistory.slice(-60);
    writeState(state);
    res.json({ reply, chatHistory: state.chatHistory });
  } catch (err) {
    console.error('chat error:', err.message);
    writeState(state); // keep the user's message even if the reply failed
    res.status(500).json({ error: err.message || 'Failed to reach the tutor.' });
  }
});

app.post('/api/chat/clear', (req, res) => {
  const state = readState();
  state.chatHistory = [];
  writeState(state);
  res.json({ chatHistory: [] });
});

// ---------------------------------------------------------------
// Daily challenge
// ---------------------------------------------------------------

app.get('/api/challenge', async (req, res) => {
  const state = readState();
  if (!state.profile) return res.status(400).json({ error: 'No profile set yet' });

  const today = new Date().toISOString().slice(0, 10);
  const key = `${state.profile.language}:${state.profile.level}:${today}`;
  const force = req.query.force === 'true';

  if (!force && state.challenges[key]) {
    return res.json(state.challenges[key]);
  }

  const sysPrompt =
    `You write short daily coding exercises for a learner studying ${label(state.profile.language)} ` +
    `at ${state.profile.level} level. Respond with ONLY valid JSON, no markdown fences, no preamble, ` +
    `matching exactly this shape: {"title": string, "difficulty": "easy"|"medium"|"hard", "prompt": string, ` +
    `"starter_code": string, "hints": [string, string], "solution": string}. ` +
    `Keep prompt under 80 words. Keep starter_code short.`;

  try {
    const raw = await chatComplete({
      system: sysPrompt,
      messages: [{ role: 'user', content: 'Give me the challenge for today.' }],
      maxTokens: 700
    });
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    state.challenges[key] = parsed;
    // keep the challenges map from growing forever
    const keys = Object.keys(state.challenges);
    if (keys.length > 60) delete state.challenges[keys[0]];
    writeState(state);
    res.json(parsed);
  } catch (err) {
    console.error('challenge error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate a challenge.' });
  }
});

app.post('/api/challenge/solved', (req, res) => {
  const state = readState();
  const today = new Date().toISOString().slice(0, 10);
  state.activityLog[today] = true;
  writeState(state);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Code execution
// JavaScript and HTML/CSS run client-side in a sandboxed iframe (see
// public/app.js). Python has no browser interpreter, so it is executed
// here with a real local Python process, sandboxed by a short timeout
// and a throwaway temp file. This runs on YOUR machine with YOUR
// permissions — do not expose this server to the network, and treat
// it the same as running any script you write locally.
// ---------------------------------------------------------------

app.post('/api/run/python', (req, res) => {
  const { code } = req.body || {};
  if (typeof code !== 'string') return res.status(400).json({ error: 'code is required' });

  const dir = mkdtempSync(path.join(tmpdir(), 'codementor-'));
  const file = path.join(dir, 'snippet.py');
  writeFileSync(file, code);

  const pythonBin = process.platform === 'win32' ? 'python' : 'python3';

  execFile(pythonBin, [file], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    rmSync(dir, { recursive: true, force: true });
    if (err) {
      if (err.code === 'ENOENT') {
        return res.status(500).json({
          error: `Could not find "${pythonBin}" on this machine. Install Python 3, or ask the tutor to trace through the code instead.`
        });
      }
      return res.json({ stdout: stdout || '', stderr: stderr || err.message, exitCode: err.code ?? 1 });
    }
    res.json({ stdout, stderr, exitCode: 0 });
  });
});

app.post('/api/explain', async (req, res) => {
  const { code, language } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });
  const message = `Can you explain what this ${language || ''} code does, line by line if useful, and flag any bugs?\n\n\`\`\`${language || ''}\n${code}\n\`\`\``;

  const state = readState();
  state.chatHistory.push({ role: 'user', content: message });

  const sysPrompt =
    `You are Codementor, a coding tutor. Explain the given code clearly and concisely, ` +
    `flag any bugs, and suggest a fix if there is one.`;

  try {
    const reply = await chatComplete({
      system: sysPrompt,
      messages: [{ role: 'user', content: message }],
      maxTokens: 800
    });
    state.chatHistory.push({ role: 'assistant', content: reply });
    state.chatHistory = state.chatHistory.slice(-60);
    writeState(state);
    res.json({ reply, chatHistory: state.chatHistory });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reach the tutor.' });
  }
});

app.listen(PORT, () => {
  console.log(`Codementor running at http://localhost:${PORT}`);
});
