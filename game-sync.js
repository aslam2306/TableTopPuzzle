// ============================================================================
// Kahoot Relay Race - Shared Cross-Tab State & Audio Engine
// Syncs admin.html and participant.html via localStorage + BroadcastChannel
// ============================================================================

(function () {
const STORAGE_KEY = 'kahoot_envelope_relay_state_v2';
const CHANNEL_NAME = 'kahoot_envelope_relay_channel_v2';
const TOTAL_QUESTIONS_TO_WIN = 5;

const INITIAL_QUESTION_BANK = [
  {
    id: 'q-1',
    category: 'Analytics & Tech',
    hint: "Microsoft's interactive data visualization and business intelligence tool used for creating reports.",
    answer: 'POWER BI',
    pieces: ['P', 'O', 'W', 'E', 'R', 'B', 'I']
  },
  {
    id: 'q-2',
    category: 'Astrophysics',
    hint: 'The theoretical boundary around a black hole beyond which neither light nor matter can escape.',
    answer: 'EVENT HORIZON',
    pieces: ['EV', 'ENT', 'HOR', 'IZ', 'ON']
  },
  {
    id: 'q-3',
    category: 'World Heritage',
    hint: 'A 15th-century Inca citadel situated on a mountain ridge in southern Peru.',
    answer: 'MACHU PICCHU',
    pieces: ['MA', 'CHU', 'PIC', 'CHU']
  },
  {
    id: 'q-4',
    category: 'Venture Capital',
    hint: 'A privately held startup company valued at over one billion US dollars.',
    answer: 'UNICORN',
    pieces: ['U', 'NI', 'CO', 'RN']
  },
  {
    id: 'q-5',
    category: 'Computer Science',
    hint: 'A finite sequence of rigorous instructions used to solve specific classes of computation problems.',
    answer: 'ALGORITHM',
    pieces: ['AL', 'GO', 'RI', 'THM']
  },
  {
    id: 'q-6',
    category: 'Biochemistry',
    hint: 'The molecule that carries genetic instructions in all living organisms and viruses.',
    answer: 'DNA HELIX',
    pieces: ['D', 'NA', 'HE', 'L', 'IX']
  },
  {
    id: 'q-7',
    category: 'Renewable Energy',
    hint: 'Technology that directly converts solar radiation into electrical power through semiconducting materials.',
    answer: 'PHOTOVOLTAIC',
    pieces: ['PHO', 'TO', 'VOL', 'TA', 'IC']
  },
  {
    id: 'q-8',
    category: 'Cloud Computing',
    hint: 'Software architectural pattern where applications are structured as collections of loosely coupled services.',
    answer: 'MICROSERVICES',
    pieces: ['MI', 'CRO', 'SER', 'VI', 'CES']
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
    attempts: 0
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
      attempts: 0
    };
  });
}

function createInitialState() {
  const questions = JSON.parse(JSON.stringify(INITIAL_QUESTION_BANK));
  const groups = buildTracksForGroups(createDefaultGroups(), questions);
  return {
    version: 1,
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

function getSharedState() {
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

function updateSharedState(mutatorFn) {
  const current = getSharedState();
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
  const latest = getSharedState();

  // Promote COUNTDOWN -> RUNNING automatically once countdownEndsAt passes
  if (latest.sessionState === 'COUNTDOWN' && latest.countdownEndsAt && Date.now() >= latest.countdownEndsAt) {
    updateSharedState(s => {
      if (s.sessionState === 'COUNTDOWN' && s.countdownEndsAt && Date.now() >= s.countdownEndsAt) {
        s.sessionState = 'RUNNING';
        s.raceStartedAt = s.countdownEndsAt;
        s.countdownEndsAt = null;
      } else {
        return false;
      }
    });
    return;
  }

  if (latest.version !== lastSeenVersion) {
    lastSeenVersion = latest.version;
    notifyStateListeners(latest);
  }
}, 250);

// --- Computed Timing Helpers ---
function getElapsedSeconds(state) {
  let totalMs = state.accumulatedElapsedMs || 0;
  if (state.sessionState === 'RUNNING' && state.raceStartedAt) {
    totalMs += Math.max(0, Date.now() - state.raceStartedAt);
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
    if (a.completedAll && !b.completedAll) return -1;
    if (!a.completedAll && b.completedAll) return 1;
    if (a.completedAll && b.completedAll) return (a.totalDurationSec || 0) - (b.totalDurationSec || 0);
    if (b.currentQuestionIndex !== a.currentQuestionIndex) {
      return b.currentQuestionIndex - a.currentQuestionIndex;
    }
    return b.score - a.score;
  });
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

window.KahootRelay = {
  TOTAL_QUESTIONS_TO_WIN,
  INITIAL_QUESTION_BANK,
  createDefaultGroups,
  shuffleArray,
  normalizeAnswer,
  buildTracksForGroups,
  getSharedState,
  updateSharedState,
  subscribeToState,
  getElapsedSeconds,
  formatDuration,
  getRankedGroups,
  fx: new SoundFX()
};
})();
