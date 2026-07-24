// store.js
// Minimal file-backed persistence. Codementor is a single-user, local-first
// app, so a JSON file on disk is all the "database" it needs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_STATE = {
  profile: null,              // { language, level }
  chatHistory: [],            // [{ role, content }]
  completedTopics: {},         // { javascript: { "Loops": true } }
  activityLog: {},             // { "2026-07-23": true }
  challenges: {}               // { "javascript:beginner:2026-07-23": {...} }
};

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
  }
}

export function readState() {
  ensureFile();
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // backfill any keys added in later versions
    return { ...DEFAULT_STATE, ...parsed };
  } catch (err) {
    console.error('Failed to read store, resetting to defaults:', err);
    return { ...DEFAULT_STATE };
  }
}

export function writeState(state) {
  ensureFile();
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

export function resetState() {
  writeState({ ...DEFAULT_STATE });
  return readState();
}
