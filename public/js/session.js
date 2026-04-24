/* ==========================================
   session.js — Sessione guidata (M5a + M5b)
   - Countdown SVG stroke-dasharray + rAF
   - Screen Wake Lock API
   - Web Audio (beep 3-2-1 e transizioni)
   - Salvataggio POST /api/sessions
   ========================================== */

const Session = {
  running: false,
  paused: false,

  routine: null,
  phases: [],
  phaseIndex: 0,

  phaseStartMs: 0,
  pausedAccumMs: 0,
  pauseStartMs: 0,
  lastCountdownSec: null,

  itemsDone: 0,
  itemsSkipped: 0,
  startedAtIso: null,
  sessionStartMs: 0,

  rafId: null,

  // Wake Lock
  wakeLock: null,

  // Web Audio
  audioCtx: null,

  // Speech synthesis (M17)
  voice: null,
  voiceEnabled: false,
  voiceLastSpokenSec: null,

  saved: false
};

const CIRC = 2 * Math.PI * 54;
const SIDE_TXT = { dx: 'DX', sx: 'SX' };
const MUSCLE_TXT = {
  'collo e spalle':   'Collo e spalle',
  'schiena':          'Schiena',
  'addominali':       'Addominali',
  'glutei e gambe':   'Glutei e gambe',
  'braccia e torace': 'Braccia e torace'
};

function muscleSlug(s) { return (s || '').replace(/\s+/g, '-'); }

function itemImgPath(it) {
  if (it && it.image_path) return it.image_path;
  if (it && it.muscle_group) return `/img/exercises/${muscleSlug(it.muscle_group)}.svg`;
  return '/img/exercises/default.svg';
}

function formatSec(s) {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r ? `${m}min ${r}s` : `${m}min`;
}

function escapeHtmlS(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Wake Lock ───────────────────────────
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    Session.wakeLock = await navigator.wakeLock.request('screen');
    Session.wakeLock.addEventListener('release', () => {
      // Il browser può rilasciarlo spontaneamente (es. pagina nascosta).
      // Non lo riacquisiamo qui: lo farà visibilitychange al rientro.
    });
  } catch (err) {
    console.warn('Wake Lock non disponibile:', err.message);
  }
}
async function releaseWakeLock() {
  if (Session.wakeLock) {
    try { await Session.wakeLock.release(); } catch (_) {}
    Session.wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Session.running && !Session.paused) {
    requestWakeLock();
  }
});

// ── Web Audio ───────────────────────────
// AudioContext va creato/resumed dopo un gesto utente (startSession triggerato da tap).
function ensureAudio() {
  if (Session.audioCtx) {
    if (Session.audioCtx.state === 'suspended') Session.audioCtx.resume().catch(() => {});
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    Session.audioCtx = new AC();
  } catch (err) {
    console.warn('Web Audio non disponibile:', err.message);
  }
}

// Beep morbido (sinusoide + busta per evitare click).
function playBeep(freq, durMs, peak = 0.18) {
  const ctx = Session.audioCtx;
  if (!ctx) return;
  const now = ctx.currentTime;
  const end = now + durMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(end + 0.02);
}
const beepCountdown = () => playBeep(880, 120);
const beepEndPhase  = () => playBeep(1320, 220);
const beepFinish    = () => {
  playBeep(880, 140);
  setTimeout(() => playBeep(1175, 140), 160);
  setTimeout(() => playBeep(1568, 320), 320);
};

// ── Guida vocale (SpeechSynthesis) ──────
// Su Safari iOS getVoices() è asincrono: ascoltiamo onvoiceschanged.
function initVoice() {
  if (!('speechSynthesis' in window)) return;
  const pickItalian = () => {
    const vs = speechSynthesis.getVoices();
    Session.voice = vs.find(v => v.lang && v.lang.toLowerCase().startsWith('it')) || null;
  };
  pickItalian();
  if (!Session.voice) {
    speechSynthesis.addEventListener('voiceschanged', pickItalian, { once: true });
    setTimeout(pickItalian, 500);
  }
}

function speak(text) {
  if (!Session.voiceEnabled || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    if (Session.voice) u.voice = Session.voice;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    speechSynthesis.speak(u);
  } catch (_) {}
}

function stopSpeak() {
  if ('speechSynthesis' in window) {
    try { speechSynthesis.cancel(); } catch (_) {}
  }
}

// ── Avvio ────────────────────────────────
function startSession(routine) {
  if (!routine || !Array.isArray(routine.items) || routine.items.length === 0) {
    alert('Aggiungi almeno un esercizio al piano.');
    return;
  }
  ensureAudio();
  Session.voiceEnabled = !!routine.voice_guide;
  if (Session.voiceEnabled) initVoice();

  Session.routine = routine;
  Session.phases = [];
  // M16: se la routine ha rest_standard_sec valorizzato, sovrascrive le pause per-item.
  const restOverride = (routine.rest_standard_sec != null) ? routine.rest_standard_sec : null;
  for (let i = 0; i < routine.items.length; i++) {
    const it = routine.items[i];
    Session.phases.push({
      type: 'exercise',
      duration: it.duration_override_sec || it.exercise_duration_sec || 30,
      item: it
    });
    const restSec = (restOverride != null) ? restOverride : (it.rest_after_sec || 0);
    if (i < routine.items.length - 1 && restSec > 0) {
      Session.phases.push({
        type: 'rest',
        duration: restSec,
        item: null,
        nextItem: routine.items[i + 1]
      });
    }
  }
  Session.phaseIndex = 0;
  Session.itemsDone = 0;
  Session.itemsSkipped = 0;
  Session.startedAtIso = new Date().toISOString();
  Session.sessionStartMs = performance.now();
  Session.paused = false;
  Session.running = true;
  Session.saved = false;

  document.getElementById('session-running').classList.remove('hidden');
  document.getElementById('session-summary').classList.add('hidden');
  document.getElementById('session-overlay').classList.remove('hidden');

  requestWakeLock();
  // Annuncio di apertura (prima della voce del primo esercizio)
  if (Session.voiceEnabled) speak('Inizio allenamento');
  enterPhase(0);
}

function closeOverlay() {
  Session.running = false;
  if (Session.rafId) { cancelAnimationFrame(Session.rafId); Session.rafId = null; }
  releaseWakeLock();
  stopSpeak();
  document.getElementById('session-overlay').classList.add('hidden');
}

// ── Fasi ─────────────────────────────────
function enterPhase(idx) {
  if (idx >= Session.phases.length) return finishSession();
  Session.phaseIndex = idx;
  Session.phaseStartMs = performance.now();
  Session.pausedAccumMs = 0;
  Session.paused = false;
  Session.lastCountdownSec = null;
  Session.voiceLastSpokenSec = null;
  document.getElementById('ss-pause-btn').textContent = '⏸';

  const ph = Session.phases[idx];
  const cd = document.getElementById('ss-countdown');
  const phaseLbl = document.getElementById('ss-phase');
  const img = document.getElementById('ss-img');
  const name = document.getElementById('ss-name');
  const muscle = document.getElementById('ss-muscle');
  const next = document.getElementById('ss-next');

  if (ph.type === 'exercise') {
    const it = ph.item;
    cd.classList.remove('rest');
    phaseLbl.textContent = 'Esercizio';
    phaseLbl.classList.remove('rest');
    img.src = itemImgPath(it);
    const sideTxt = SIDE_TXT[it.side] ? ` (${SIDE_TXT[it.side]})` : '';
    name.textContent = (it.name || '') + sideTxt;
    muscle.textContent = MUSCLE_TXT[it.muscle_group] || it.muscle_group || '';
    const following = Session.phases.slice(idx + 1).find(p => p.type === 'exercise');
    next.innerHTML = following
      ? `Prossimo: <strong>${escapeHtmlS(following.item.name)}${SIDE_TXT[following.item.side] ? ' (' + SIDE_TXT[following.item.side] + ')' : ''}</strong>`
      : 'Ultimo esercizio';
    // Voce: annuncia il nome dell'esercizio (+ eventuale lato)
    if (Session.voiceEnabled) {
      const lateral = it.side === 'dx' ? ' lato destro' : it.side === 'sx' ? ' lato sinistro' : '';
      speak(`${it.name || 'Esercizio'}${lateral}`);
    }
  } else {
    cd.classList.add('rest');
    phaseLbl.textContent = 'Riposo';
    phaseLbl.classList.add('rest');
    name.textContent = 'Respira';
    muscle.textContent = '';
    img.src = itemImgPath(ph.nextItem);
    next.innerHTML = `Prossimo: <strong>${escapeHtmlS(ph.nextItem.name)}${SIDE_TXT[ph.nextItem.side] ? ' (' + SIDE_TXT[ph.nextItem.side] + ')' : ''}</strong>`;
    // Voce: annuncia il prossimo esercizio durante il riposo
    if (Session.voiceEnabled && ph.nextItem) {
      const lateral = ph.nextItem.side === 'dx' ? ' lato destro'
                    : ph.nextItem.side === 'sx' ? ' lato sinistro' : '';
      speak(`Pausa. Prossimo: ${ph.nextItem.name}${lateral}`);
    }
  }

  updatePositionLabel();
  tick();
}

function updatePositionLabel() {
  const totalEx = Session.phases.filter(p => p.type === 'exercise').length;
  let cur = 0;
  for (let i = 0; i <= Session.phaseIndex && i < Session.phases.length; i++) {
    if (Session.phases[i].type === 'exercise') cur++;
  }
  if (cur === 0) cur = 1;
  document.getElementById('ss-position').textContent = `Esercizio ${cur} di ${totalEx}`;
}

function nextPhase() {
  const ph = Session.phases[Session.phaseIndex];
  if (ph && ph.type === 'exercise') {
    Session.itemsDone++;
    beepEndPhase();
  }
  enterPhase(Session.phaseIndex + 1);
}

function skipPhase() {
  const ph = Session.phases[Session.phaseIndex];
  if (ph && ph.type === 'exercise') Session.itemsSkipped++;
  let target = Session.phaseIndex + 1;
  if (ph && ph.type === 'exercise' && target < Session.phases.length && Session.phases[target].type === 'rest') {
    target++;
  }
  enterPhase(target);
}

function finishSession() {
  Session.running = false;
  if (Session.rafId) { cancelAnimationFrame(Session.rafId); Session.rafId = null; }
  releaseWakeLock();
  beepFinish();
  if (Session.voiceEnabled) speak('Allenamento completato');

  const totalSec = Math.round((performance.now() - Session.sessionStartMs) / 1000);
  Session._endedAtIso = new Date().toISOString();
  Session._durationSec = totalSec;

  document.getElementById('sm-done').textContent = Session.itemsDone;
  document.getElementById('sm-skipped').textContent = Session.itemsSkipped;
  document.getElementById('sm-duration').textContent = formatSec(totalSec);
  document.getElementById('sm-save-btn').textContent = 'Salva';
  document.getElementById('sm-save-btn').disabled = false;
  document.getElementById('sm-saved-msg').classList.add('hidden');
  document.getElementById('session-running').classList.add('hidden');
  document.getElementById('session-summary').classList.remove('hidden');
}

// ── Timer tick ──────────────────────────
function tick() {
  if (!Session.running) return;
  if (Session.paused) {
    Session.rafId = requestAnimationFrame(tick);
    return;
  }
  const ph = Session.phases[Session.phaseIndex];
  if (!ph) return;
  const now = performance.now();
  const elapsedMs = now - Session.phaseStartMs - Session.pausedAccumMs;
  const totalMs = ph.duration * 1000;
  const remainingMs = Math.max(0, totalMs - elapsedMs);

  const secDisplay = Math.ceil(remainingMs / 1000);
  document.getElementById('ss-num').textContent = secDisplay;

  // Beep 3-2-1 solo per la fase esercizio (non disturbare in riposo)
  if (ph.type === 'exercise' && Session.lastCountdownSec !== secDisplay) {
    if (secDisplay === 3 || secDisplay === 2 || secDisplay === 1) beepCountdown();
    Session.lastCountdownSec = secDisplay;
  }
  // Guida vocale 5-4-3-2-1 (solo in fase esercizio, solo se abilitata)
  if (Session.voiceEnabled && ph.type === 'exercise'
      && Session.voiceLastSpokenSec !== secDisplay
      && secDisplay >= 1 && secDisplay <= 5) {
    const words = { 5: 'cinque', 4: 'quattro', 3: 'tre', 2: 'due', 1: 'uno' };
    speak(words[secDisplay]);
    Session.voiceLastSpokenSec = secDisplay;
  }

  const progress = Math.min(1, elapsedMs / totalMs);
  const ring = document.querySelector('#ss-countdown .ring-fg');
  if (ring) ring.setAttribute('stroke-dashoffset', String(CIRC * progress));

  updateTotalProgress(elapsedMs);

  if (remainingMs <= 0) { nextPhase(); return; }
  Session.rafId = requestAnimationFrame(tick);
}

function updateTotalProgress(currentPhaseElapsedMs) {
  let total = 0, done = 0;
  for (let i = 0; i < Session.phases.length; i++) {
    const d = Session.phases[i].duration * 1000;
    total += d;
    if (i < Session.phaseIndex) done += d;
    else if (i === Session.phaseIndex) done += Math.min(currentPhaseElapsedMs, d);
  }
  const pct = total > 0 ? (done / total) * 100 : 0;
  document.getElementById('ss-progress').style.width = `${Math.min(100, pct).toFixed(1)}%`;
}

// ── Controlli ───────────────────────────
function togglePause() {
  if (!Session.running) return;
  if (!Session.paused) {
    Session.paused = true;
    Session.pauseStartMs = performance.now();
    stopSpeak();
    document.getElementById('ss-pause-btn').textContent = '▶';
    releaseWakeLock();
  } else {
    Session.pausedAccumMs += (performance.now() - Session.pauseStartMs);
    Session.paused = false;
    document.getElementById('ss-pause-btn').textContent = '⏸';
    requestWakeLock();
  }
}

function stopEarly() {
  if (!confirm('Terminare ora la sessione? Potrai salvarla parziale.')) return;
  // Chiudi le statistiche a questo punto e mostra il riepilogo (permette di salvare parziale)
  Session.running = false;
  if (Session.rafId) { cancelAnimationFrame(Session.rafId); Session.rafId = null; }
  releaseWakeLock();
  stopSpeak();
  Session._endedAtIso = new Date().toISOString();
  Session._durationSec = Math.round((performance.now() - Session.sessionStartMs) / 1000);

  document.getElementById('sm-done').textContent = Session.itemsDone;
  document.getElementById('sm-skipped').textContent = Session.itemsSkipped;
  document.getElementById('sm-duration').textContent = formatSec(Session._durationSec);
  document.getElementById('sm-save-btn').textContent = 'Salva (parziale)';
  document.getElementById('sm-save-btn').disabled = false;
  document.getElementById('sm-saved-msg').classList.add('hidden');
  document.getElementById('session-running').classList.add('hidden');
  document.getElementById('session-summary').classList.remove('hidden');
}

// ── Salvataggio ─────────────────────────
async function saveSession() {
  if (Session.saved) return;
  const btn = document.getElementById('sm-save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvataggio…';

  const total = Session.phases.filter(p => p.type === 'exercise').length;
  const payload = {
    routine_id:    Session.routine ? Session.routine.id : null,
    routine_name:  Session.routine ? Session.routine.name : null,
    started_at:    Session.startedAtIso,
    ended_at:      Session._endedAtIso || new Date().toISOString(),
    duration_sec:  Session._durationSec || Math.round((performance.now() - Session.sessionStartMs) / 1000),
    items_total:   total,
    items_skipped: Session.itemsSkipped,
    notes:         null
  };
  const res = await apiPost('/api/sessions', payload);
  if (res && res.id) {
    Session.saved = true;
    btn.textContent = 'Salvata';
    document.getElementById('sm-saved-msg').classList.remove('hidden');
  } else {
    btn.disabled = false;
    btn.textContent = 'Riprova salvataggio';
  }
}

// ── Listener ────────────────────────────
document.getElementById('ss-pause-btn').addEventListener('click', togglePause);
document.getElementById('ss-skip-btn').addEventListener('click', skipPhase);
document.getElementById('ss-stop-btn').addEventListener('click', stopEarly);
document.getElementById('ss-close-btn').addEventListener('click', stopEarly);
document.getElementById('sm-save-btn').addEventListener('click', saveSession);
document.getElementById('sm-close-btn').addEventListener('click', closeOverlay);

window.startSession = startSession;
