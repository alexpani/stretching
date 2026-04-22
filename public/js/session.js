/* ==========================================
   session.js — Sessione guidata (M5a)
   Countdown circolare SVG (stroke-dasharray)
   Timer via requestAnimationFrame
   M5b aggiungerà: Wake Lock, Web Audio, salvataggio
   ========================================== */

const Session = {
  running: false,
  paused: false,

  routine: null,
  phases: [],           // [{type:'exercise'|'rest', duration:sec, item:...}, ...]
  phaseIndex: 0,

  phaseStartMs: 0,      // wall-clock quando è iniziata la fase corrente
  pausedAccumMs: 0,     // tempo cumulato in pausa nella fase corrente
  pauseStartMs: 0,      // timestamp dell'ultimo ingresso in pausa

  itemsDone: 0,
  itemsSkipped: 0,
  sessionStartMs: 0,

  rafId: null
};

const CIRC = 2 * Math.PI * 54; // raggio 54 → circonferenza ≈ 339.292

const SIDE_TXT = { dx: 'DX', sx: 'SX' };
const MUSCLE_TXT = {
  collo: 'Collo', spalle: 'Spalle', schiena: 'Schiena', core: 'Core',
  gambe: 'Gambe', anche: 'Anche', polpacci: 'Polpacci', braccia: 'Braccia'
};

function itemImgPath(it) {
  if (it && it.image_path) return it.image_path;
  if (it && it.muscle_group) return `/img/exercises/${it.muscle_group}.svg`;
  return '/img/exercises/default.svg';
}

function formatSec(s) {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r ? `${m}min ${r}s` : `${m}min`;
}

// ── Avvio ────────────────────────────────
// Chiamato da routines.js con la routine completa (con items)
function startSession(routine) {
  if (!routine || !Array.isArray(routine.items) || routine.items.length === 0) {
    alert('Aggiungi almeno un esercizio alla routine.');
    return;
  }
  Session.routine = routine;
  Session.phases = [];
  for (let i = 0; i < routine.items.length; i++) {
    const it = routine.items[i];
    Session.phases.push({
      type: 'exercise',
      duration: it.duration_override_sec || it.exercise_duration_sec || 30,
      item: it
    });
    // Niente riposo dopo l'ultimo esercizio
    if (i < routine.items.length - 1 && (it.rest_after_sec || 0) > 0) {
      Session.phases.push({
        type: 'rest',
        duration: it.rest_after_sec,
        item: null,
        nextItem: routine.items[i + 1]
      });
    }
  }
  Session.phaseIndex = 0;
  Session.itemsDone = 0;
  Session.itemsSkipped = 0;
  Session.sessionStartMs = performance.now();
  Session.paused = false;
  Session.running = true;

  document.getElementById('session-running').classList.remove('hidden');
  document.getElementById('session-summary').classList.add('hidden');
  document.getElementById('session-overlay').classList.remove('hidden');

  enterPhase(0);
}

function stopSession() {
  Session.running = false;
  if (Session.rafId) { cancelAnimationFrame(Session.rafId); Session.rafId = null; }
  document.getElementById('session-overlay').classList.add('hidden');
}

// ── Fasi ─────────────────────────────────
function enterPhase(idx) {
  if (idx >= Session.phases.length) return finishSession();
  Session.phaseIndex = idx;
  Session.phaseStartMs = performance.now();
  Session.pausedAccumMs = 0;
  Session.paused = false;
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
  } else {
    cd.classList.add('rest');
    phaseLbl.textContent = 'Riposo';
    phaseLbl.classList.add('rest');
    name.textContent = 'Respira';
    muscle.textContent = '';
    img.src = itemImgPath(ph.nextItem);
    next.innerHTML = `Prossimo: <strong>${escapeHtmlS(ph.nextItem.name)}${SIDE_TXT[ph.nextItem.side] ? ' (' + SIDE_TXT[ph.nextItem.side] + ')' : ''}</strong>`;
  }

  updatePositionLabel();
  tick();
}

function escapeHtmlS(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updatePositionLabel() {
  // "Esercizio N di M" sempre (conta solo le fasi exercise)
  const totalExercises = Session.phases.filter(p => p.type === 'exercise').length;
  let currentExerciseNumber = 0;
  for (let i = 0; i <= Session.phaseIndex && i < Session.phases.length; i++) {
    if (Session.phases[i].type === 'exercise') currentExerciseNumber++;
  }
  if (currentExerciseNumber === 0) currentExerciseNumber = 1;
  document.getElementById('ss-position').textContent = `Esercizio ${currentExerciseNumber} di ${totalExercises}`;
}

function nextPhase() {
  const ph = Session.phases[Session.phaseIndex];
  if (ph && ph.type === 'exercise') Session.itemsDone++;
  enterPhase(Session.phaseIndex + 1);
}

function skipPhase() {
  const ph = Session.phases[Session.phaseIndex];
  if (ph && ph.type === 'exercise') Session.itemsSkipped++;
  // Vai alla prossima fase (salta anche il riposo successivo se si salta un esercizio)
  let target = Session.phaseIndex + 1;
  if (ph && ph.type === 'exercise' && target < Session.phases.length && Session.phases[target].type === 'rest') {
    target++;
  }
  enterPhase(target);
}

function finishSession() {
  Session.running = false;
  if (Session.rafId) { cancelAnimationFrame(Session.rafId); Session.rafId = null; }
  const totalSec = Math.round((performance.now() - Session.sessionStartMs) / 1000);
  document.getElementById('sm-done').textContent = Session.itemsDone;
  document.getElementById('sm-skipped').textContent = Session.itemsSkipped;
  document.getElementById('sm-duration').textContent = formatSec(totalSec);
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

  // Numero al centro (secondi interi rimanenti, arrotondamento per eccesso)
  document.getElementById('ss-num').textContent = Math.ceil(remainingMs / 1000);

  // Ring: dashoffset cresce proporzionalmente al tempo trascorso
  const progress = Math.min(1, elapsedMs / totalMs);
  const ring = document.querySelector('#ss-countdown .ring-fg');
  if (ring) ring.setAttribute('stroke-dashoffset', String(CIRC * progress));

  // Progress bar totale (dell'intera routine)
  updateTotalProgress(elapsedMs);

  if (remainingMs <= 0) {
    nextPhase();
    return;
  }
  Session.rafId = requestAnimationFrame(tick);
}

function updateTotalProgress(currentPhaseElapsedMs) {
  let total = 0;
  let done = 0;
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
    document.getElementById('ss-pause-btn').textContent = '▶';
  } else {
    Session.pausedAccumMs += (performance.now() - Session.pauseStartMs);
    Session.paused = false;
    document.getElementById('ss-pause-btn').textContent = '⏸';
  }
}

function confirmAndStop() {
  if (!confirm('Terminare la sessione?')) return;
  // In M5a non salviamo: solo chiudiamo. Al summary dopo l'ultimo esercizio
  // mostriamo comunque le statistiche cumulate.
  Session.running = false;
  if (Session.rafId) { cancelAnimationFrame(Session.rafId); Session.rafId = null; }
  stopSession();
}

// ── Listener ────────────────────────────
document.getElementById('ss-pause-btn').addEventListener('click', togglePause);
document.getElementById('ss-skip-btn').addEventListener('click', skipPhase);
document.getElementById('ss-stop-btn').addEventListener('click', confirmAndStop);
document.getElementById('ss-close-btn').addEventListener('click', confirmAndStop);
document.getElementById('sm-close-btn').addEventListener('click', stopSession);

// Espone a routines.js
window.startSession = startSession;
