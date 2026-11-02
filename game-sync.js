// ============================================================================
// Kahoot Relay Race - Shared Cross-Tab State & Audio Engine
// Syncs admin.html and participant.html via localStorage + BroadcastChannel
// ============================================================================

(function () {
// ============================================================================
// ONLINE HOSTING (GitHub Pages etc.): paste your Firebase Realtime Database URL here,
// e.g. 'https://my-quiz-default-rtdb.asia-southeast1.firebasedatabase.app'
// Leave '' to use server.js (node server.js) or same-browser mode.
// ============================================================================
const FIREBASE_DB_URL = 'https://tabletop-puzzle-default-rtdb.firebaseio.com';
const FB = FIREBASE_DB_URL.trim().replace(/\/+$/, 'https://tabletop-puzzle-default-rtdb.firebaseio.com');
const STORAGE_KEY = 'kahoot_envelope_relay_state_v3';
const CHANNEL_NAME = 'kahoot_envelope_relay_channel_v2';
const TOTAL_QUESTIONS_TO_WIN = 3;
const QUESTION_TIME_LIMIT_SEC = 45;
const BANK_VERSION = 3; // bump to force old questions in shared storage to be replaced

const INITIAL_QUESTION_BANK = [
  {
    id: 'q-1',
    hint: "A network security device or software that monitors and filters traffic based on predefined rules.",
    answer: 'FIREWALL',
    pieces: ["F","I","R","E","W","A","L","L"]
  },
  {
    id: 'q-2',
    hint: "The maximum rate of data transfer capacity over a network connection within a given timeframe.",
    answer: 'BANDWIDTH',
    pieces: ["B","A","N","D","W","I","D","T","H"]
  },
  {
    id: 'q-3',
    hint: "An organized collection of structured information stored electronically for fast retrieval and management.",
    answer: 'DATABASE',
    pieces: ["D","A","T","A","B","A","S","E"]
  },
  {
    id: 'q-4',
    hint: "The essential process of checking and validating AI outputs against original source documents.",
    answer: 'VERIFICATION',
    pieces: ["V","E","R","I","F","I","C","A","T","I","O","N"]
  },
  {
    id: 'q-5',
    hint: "Safeguarding confidential client records and personal financial details from public exposure.",
    answer: 'PRIVACY',
    pieces: ["P","R","I","V","A","C","Y"]
  },
  {
    id: 'q-6',
    hint: "Potential risks or cyber hazards intended to compromise data security.",
    answer: 'THREATS',
    pieces: ["T","H","R","E","A","T","S"]
  },
  {
    id: 'q-7',
    hint: "Safeguarding sensitive financial information against unauthorized access and security risks.",
    answer: 'PROTECTION',
    pieces: ["P","R","O","T","E","C","T","I","O","N"]
  },
  {
    id: 'q-8',
    hint: "Intrusive software created by cybercriminals to disrupt, damage, or gain unauthorized access to computer systems.",
    answer: 'MALWARE',
    pieces: ["M","A","L","W","A","R","E"]
  },
  {
    id: 'q-9',
    hint: "Software that acts as a bridge connecting different applications, databases, or operating systems.",
    answer: 'MIDDLEWARE',
    pieces: ["M","I","D","D","L","E","W","A","R","E"]
  },
  {
    id: 'q-10',
    hint: "The time delay experienced between sending a data request and receiving the system's response.",
    answer: 'LATENCY',
    pieces: ["L","A","T","E","N","C","Y"]
  },
  {
    id: 'q-11',
    hint: "A linear data structure operating on a First-In, First-Out (FIFO) processing order.",
    answer: 'QUEUE',
    pieces: ["Q","U","E","U","E"]
  },
  {
    id: 'q-12',
    hint: "A secret or unauthorized method built into software that bypasses normal security authentication mechanisms.",
    answer: 'BACKDOOR',
    pieces: ["B","A","C","K","D","O","O","R"]
  },
  {
    id: 'q-13',
    hint: "An initial model or base object from which other software objects inherit properties and default functions.",
    answer: 'PROTOTYPE',
    pieces: ["P","R","O","T","O","T","Y","P","E"]
  },
  {
    id: 'q-14',
    hint: "A severe concurrency condition where two or more threads freeze permanently waiting on each other's resources.",
    answer: 'DEADLOCK',
    pieces: ["D","E","A","D","L","O","C","K"]
  },
  {
    id: 'q-15',
    hint: "A standardized set of rules that enables different computers and devices to communicate across a network.",
    answer: 'PROTOCOL',
    pieces: ["P","R","O","T","O","C","O","L"]
  }
];

function createDefaultGroups() {
  return Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    name: `Group ${i + 1}`,
    questionTrack: [],
    currentQuestionIndex: 0,
    score: 0,
    joined: false,
    joinedAt: null,
    completedAll: false,
    completedAt: null,
    totalDurationSec: null,
    attempts: 0,
    qStartMs: 0,
    missed: 0,
    questionResults: [],
    finished: false
  }));
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeAnswer(text) {
  return (text || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function buildTracksForGroups(groups, questions) {
  if (!questions || questions.length < TOTAL_QUESTIONS_TO_WIN) return groups;
  return groups.map(g => {
    const shuffled = shuffleArray(questions);
    return {
      ...g,
      questionTrack: shuffled.slice(0, TOTAL_QUESTIONS_TO_WIN).map(q => q.id),
      currentQuestionIndex: 0,
      score: 0,
      completedAll: false,
      completedAt: null,
      totalDurationSec: null,
      attempts: 0,
      qStartMs: 0,
      missed: 0,
      questionResults: [],
      finished: false
    };
  });
}

function createInitialState() {
  const questions = JSON.parse(JSON.stringify(INITIAL_QUESTION_BANK));
  const groups = buildTracksForGroups(createDefaultGroups(), questions);
  return {
    version: 1,
    bankVersion: BANK_VERSION,
    updatedAt: Date.now(),
    lobbyId: 'lobby-' + Date.now(),
    gamePin: '', // Admin sets the PIN code before participants join
    sessionState: 'NOT_STARTED', // 'NOT_STARTED' | 'COUNTDOWN' | 'RUNNING' | 'PAUSED' | 'ENDED'
    countdownEndsAt: null,
    raceStartedAt: null, // Epoch ms when current RUNNING segment started
    accumulatedElapsedMs: 0, // Saved elapsed ms prior to pause/stop
    questions,
    groups,
    submissions: [],
    winningGroup: null
  };
}

// --- Cross-Tab Sync Bus ---
let broadcastChannel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  }
} catch (_) {
  broadcastChannel = null;
}

const stateListeners = new Set();
let lastSeenVersion = -1;

function localGet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = createInitialState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      lastSeenVersion = initial.version;
      return initial;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.groups) || !Array.isArray(parsed.questions)) {
      const reset = createInitialState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reset));
      lastSeenVersion = reset.version;
      return reset;
    }
    return parsed;
  } catch (err) {
    console.error('Failed reading shared state:', err);
    return createInitialState();
  }
}

function localUpdate(mutatorFn) {
  const current = localGet();
  const next = JSON.parse(JSON.stringify(current));
  const result = mutatorFn(next);
  if (result === false) {
    return current;
  }
  next.version = (current.version || 0) + 1;
  next.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  lastSeenVersion = next.version;

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'STATE_UPDATED', version: next.version });
    } catch (_) {}
  }

  notifyStateListeners(next);
  return next;
}

// --- Sync backend selection ---
// Served over http(s) by server.js  -> shared server state (works across phones/computers)
// Opened as file://                 -> localStorage (same browser only)
const IS_STATIC_HOST = /github\.io$|netlify\.app$|vercel\.app$|pages\.dev$/.test(location.hostname);
const REMOTE = !!FB || ((location.protocol === 'http:' || location.protocol === 'https:') && !IS_STATIC_HOST);

if (!REMOTE && IS_STATIC_HOST) {
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#be123c;color:#fff;font:600 13px sans-serif;padding:10px 14px;text-align:center';
    b.textContent = '⚠ Online play not configured: other devices cannot see this game. Set FIREBASE_DB_URL in game-sync.js (see setup steps).';
    document.body.appendChild(b);
  });
}

// Firebase drops empty arrays / nulls, so restore the shapes the app expects
function normalizeState(v) {
  if (!v) return null;
  v.submissions = v.submissions || [];
  v.questions = (v.questions || []).filter(Boolean).map(q => ({ ...q, pieces: q.pieces || [] }));
  v.groups = (v.groups || []).filter(Boolean).map(g => ({
    ...g,
    questionTrack: g.questionTrack || [],
    questionResults: g.questionResults || [],
    missed: g.missed || 0,
    qStartMs: g.qStartMs || 0
  }));
  v.gamePin = v.gamePin || '';
  v.accumulatedElapsedMs = v.accumulatedElapsedMs || 0;
  return v;
}
let lastClockSync = 0;
async function syncFbClock() {
  const t0 = Date.now();
  const r = await fetch(FB + '/clock.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ '.sv': 'timestamp' })
  });
  const ts = await r.json();
  const t1 = Date.now();
  if (typeof ts === 'number') clockOffset = ts - (t0 + t1) / 2;
  lastClockSync = Date.now();
}
// Writes state; returns { ok:true } or { conflict:true, state } (state = latest server state)
async function postState(base, next) {
  if (FB) {
    const r = await fetch(FB + '/state.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next)
    });
    if (r.ok) return { ok: true };
    if (r.status === 401 || r.status === 403 || r.status === 412) {
      await fetchServer();
      return { conflict: true, state: serverState };
    }
    throw new Error('write failed ' + r.status);
  }
  const r = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseVersion: base, state: next })
  });
  if (r.ok) return { ok: true };
  if (r.status === 409) return { conflict: true, state: (await r.json()).state };
  throw new Error('write failed ' + r.status);
}

let clockOffset = 0; // serverTime - localTime, keeps all devices on the same clock
function now() { return Date.now() + clockOffset; }
const clone = o => JSON.parse(JSON.stringify(o));

let cache = null;        // what the UI reads (includes optimistic local changes)
let serverState = null;  // last authoritative state received from the server
let remoteLoaded = false;
let pending = 0;
let chain = Promise.resolve();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function remoteGet() {
  if (!cache) cache = createInitialState();
  return cache;
}

async function fetchServer() {
  if (FB) {
    if (Date.now() - lastClockSync > 30000) { try { await syncFbClock(); } catch (_) {} }
    const r = await fetch(FB + '/state.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('read failed ' + r.status);
    serverState = normalizeState(await r.json());
    return serverState;
  }
  const t0 = Date.now();
  const r = await fetch('/api/state', { cache: 'no-store' });
  const d = await r.json();
  const t1 = Date.now();
  clockOffset = d.serverTime - (t0 + t1) / 2;
  serverState = d.state;
  return d.state;
}

let fetching = false;
async function fetchRemote() {
  if (fetching || pending > 0) return;
  fetching = true;
  try {
    const st = await fetchServer();
    if (pending > 0) return;
    if (!st) {
      // Server empty: first client seeds it
      if (!remoteLoaded) {
        remoteLoaded = true;
        const seed = remoteGet();
        seed.version = 1;
        await postState(0, seed);
        await fetchServer();
        cache = clone(serverState || seed);
        notifyStateListeners(cache);
      }
      return;
    }
    if (!remoteLoaded || !cache || st.version !== cache.version) {
      remoteLoaded = true;
      cache = clone(st);
      notifyStateListeners(cache);
      migrateBankIfOld();
    }
  } catch (_) {
  } finally {
    fetching = false;
  }
}

async function pushMutation(mutator) {
  for (let i = 0; i < 10; i++) {
    try {
      if (!serverState) {
        await fetchServer();
        if (!serverState) {
          serverState = createInitialState();
          serverState.version = 0;
        }
      }
      const base = serverState.version || 0;
      const next = clone(serverState);
      if (mutator(next) === false) {
        cache = clone(serverState);
        notifyStateListeners(cache);
        return;
      }
      next.version = base + 1;
      next.updatedAt = now();
      const r = await postState(base, next);
      if (r.ok) {
        serverState = next;
        cache = clone(next);
        remoteLoaded = true;
        return;
      }
      if (r.conflict) {
        serverState = r.state;
        continue;
      }
    } catch (_) {
      await sleep(300);
    }
  }
}

function remoteUpdate(mutator) {
  const current = remoteGet();
  const next = clone(current);
  if (mutator(next) === false) return current;
  next.version = (current.version || 0) + 1;
  next.updatedAt = now();
  cache = next;
  pending++;
  notifyStateListeners(next);
  chain = chain
    .then(() => pushMutation(mutator))
    .catch(() => {})
    .then(() => {
      pending--;
      if (pending === 0 && cache) notifyStateListeners(cache);
    });
  return next;
}

function migrateBankIfOld() {
  const st = getSharedState();
  if (st && st.bankVersion !== BANK_VERSION) {
    updateSharedState(s => {
      if (s.bankVersion === BANK_VERSION) return false;
      s.bankVersion = BANK_VERSION;
      s.questions = JSON.parse(JSON.stringify(INITIAL_QUESTION_BANK));
      s.submissions = [];
      s.groups = buildTracksForGroups(s.groups, s.questions);
    });
  }
}
function getSharedState() { return REMOTE ? remoteGet() : localGet(); }
function updateSharedState(m) { return REMOTE ? remoteUpdate(m) : localUpdate(m); }

if (REMOTE) fetchRemote(); else setTimeout(migrateBankIfOld, 0);

function notifyStateListeners(state) {
  stateListeners.forEach(fn => {
    try {
      fn(state);
    } catch (err) {
      console.error('Listener error:', err);
    }
  });
}

function subscribeToState(listener) {
  stateListeners.add(listener);

  // Check countdown auto-transition and missed storage events on a fast tick
  return () => stateListeners.delete(listener);
}

window.addEventListener('storage', (evt) => {
  if (evt.key === STORAGE_KEY && evt.newValue) {
    try {
      const parsed = JSON.parse(evt.newValue);
      if (parsed && parsed.version !== lastSeenVersion) {
        lastSeenVersion = parsed.version;
        notifyStateListeners(parsed);
      }
    } catch (_) {}
  }
});

if (broadcastChannel) {
  broadcastChannel.onmessage = () => {
    const latest = getSharedState();
    if (latest.version !== lastSeenVersion) {
      lastSeenVersion = latest.version;
      notifyStateListeners(latest);
    }
  };
}

// Polling fallback for file:// protocol cross-tab sync reliability + countdown promotion
setInterval(() => {
  if (REMOTE) fetchRemote();
  const latest = getSharedState();

  // Promote COUNTDOWN -> RUNNING automatically once countdownEndsAt passes
  if (latest.sessionState === 'COUNTDOWN' && latest.countdownEndsAt && now() >= latest.countdownEndsAt) {
    updateSharedState(s => {
      if (s.sessionState === 'COUNTDOWN' && s.countdownEndsAt && now() >= s.countdownEndsAt) {
        s.sessionState = 'RUNNING';
        s.raceStartedAt = s.countdownEndsAt;
        s.countdownEndsAt = null;
      } else {
        return false;
      }
    });
    return;
  }

  if (!REMOTE && latest.version !== lastSeenVersion) {
    lastSeenVersion = latest.version;
    notifyStateListeners(latest);
  }

  // Auto-advance any joined group whose 45s timer expired (with 1s grace for background/closed tabs)
  if (latest.sessionState === 'RUNNING') {
    const totalMs = getElapsedMs(latest);
    const hasExpired = (latest.groups || []).some(g =>
      g.joined && !g.completedAll && !g.finished && g.currentQuestionIndex < TOTAL_QUESTIONS_TO_WIN &&
      (totalMs - Math.min(g.qStartMs || 0, totalMs)) >= (QUESTION_TIME_LIMIT_SEC * 1000 + 1000)
    );
    if (hasExpired) {
      updateSharedState(s => {
        if (s.sessionState !== 'RUNNING') return false;
        const elapsed = getElapsedMs(s);
        let changed = false;
        s.groups.forEach(grp => {
          if (!grp.joined || grp.completedAll || grp.finished || grp.currentQuestionIndex >= TOTAL_QUESTIONS_TO_WIN) return;
          const qElapsed = elapsed - Math.min(grp.qStartMs || 0, elapsed);
          if (qElapsed >= QUESTION_TIME_LIMIT_SEC * 1000 + 1000) {
            grp.questionResults = grp.questionResults || [];
            grp.questionResults[grp.currentQuestionIndex] = 'missed';
            grp.currentQuestionIndex += 1;
            grp.missed = (grp.missed || 0) + 1;
            grp.qStartMs = elapsed;
            changed = true;
            if (grp.currentQuestionIndex >= TOTAL_QUESTIONS_TO_WIN) {
              grp.finished = true;
              grp.totalDurationSec = Math.floor(elapsed / 1000);
            }
          }
        });
        if (!changed) return false;
        finalizeRaceIfComplete(s, false);
      });
    }
  }
}, 300);

// --- Computed Timing Helpers ---
function getElapsedSeconds(state) {
  let totalMs = state.accumulatedElapsedMs || 0;
  if (state.sessionState === 'RUNNING' && state.raceStartedAt) {
    totalMs += Math.max(0, now() - state.raceStartedAt);
  }
  return Math.floor(totalMs / 1000);
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mins = String(Math.floor(s / 60)).padStart(2, '0');
  const secs = String(s % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function getRankedGroups(groups) {
  return [...groups].sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) {
      return (b.score || 0) - (a.score || 0);
    }
    const solvedA = Math.max(0, (a.currentQuestionIndex || 0) - (a.missed || 0));
    const solvedB = Math.max(0, (b.currentQuestionIndex || 0) - (b.missed || 0));
    if (solvedB !== solvedA) {
      return solvedB - solvedA;
    }
    const durA = a.totalDurationSec != null ? a.totalDurationSec : Infinity;
    const durB = b.totalDurationSec != null ? b.totalDurationSec : Infinity;
    if (durA !== durB) return durA - durB;
    return (b.joined ? 1 : 0) - (a.joined ? 1 : 0);
  });
}

function finalizeRaceIfComplete(s, forceEnd = false) {
  const active = (s.groups || []).filter(x => x.joined);
  const allActiveDone = active.length > 0 && active.every(x => x.finished || x.completedAll || x.currentQuestionIndex >= TOTAL_QUESTIONS_TO_WIN);
  if (!forceEnd && !allActiveDone) return false;

  if (s.sessionState === 'RUNNING' && s.raceStartedAt) {
    s.accumulatedElapsedMs = (s.accumulatedElapsedMs || 0) + Math.max(0, now() - s.raceStartedAt);
  }
  s.raceStartedAt = null;
  s.countdownEndsAt = null;
  s.sessionState = 'ENDED';

  const candidates = (s.groups || []).filter(x => x.joined || (x.score || 0) > 0 || (x.currentQuestionIndex || 0) > 0);
  const ranked = getRankedGroups(candidates.length ? candidates : s.groups);
  const top = ranked[0];
  s.winningGroup = (top && (top.score || 0) > 0) ? top.name : null;
  return true;
}

// --- Shared Sound Synthesizer ---
class SoundFX {
  constructor() {
    this.ctx = null;
  }
  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) this.ctx = new AudioContext();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }
  playPop() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(450, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(850, this.ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }
  playBeep(freq = 440) {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.22, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }
  playBuzzer() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, this.ctx.currentTime);
    osc.frequency.setValueAtTime(165, this.ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.32);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.32);
  }
  playTear() {
    this.init();
    if (!this.ctx) return;
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.18);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.18);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start();
  }
  playCorrectJingle() {
    this.init();
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.2, this.ctx.currentTime + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + i * 0.08 + 0.22);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + i * 0.08);
      osc.stop(this.ctx.currentTime + i * 0.08 + 0.25);
    });
  }
  playFanfare() {
    this.init();
    if (!this.ctx) return;
    const freqs = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    freqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.25, this.ctx.currentTime + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + i * 0.1 + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + i * 0.1);
      osc.stop(this.ctx.currentTime + i * 0.1 + 0.4);
    });
  }
}

function getElapsedMs(state) {
  let totalMs = state.accumulatedElapsedMs || 0;
  if (state.sessionState === 'RUNNING' && state.raceStartedAt) totalMs += Math.max(0, now() - state.raceStartedAt);
  return totalMs;
}

window.KahootRelay = {
  TOTAL_QUESTIONS_TO_WIN,
  QUESTION_TIME_LIMIT_SEC,
  getElapsedMs,
  INITIAL_QUESTION_BANK,
  createDefaultGroups,
  shuffleArray,
  normalizeAnswer,
  buildTracksForGroups,
  now,
  getSharedState,
  updateSharedState,
  subscribeToState,
  getElapsedSeconds,
  formatDuration,
  getRankedGroups,
  finalizeRaceIfComplete,
  fx: new SoundFX()
};
})();
