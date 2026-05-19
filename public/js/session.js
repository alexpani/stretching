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
const SIDE_TXT = { dx: 'DX', sx: 'SX', bilaterale: 'BL' };
const MUSCLE_TXT = {
  'collo e spalle':   'Collo e spalle',
  'schiena':          'Schiena',
  'addominali':       'Addominali',
  'glutei e gambe':   'Glutei e gambe',
  'braccia e torace': 'Braccia e torace'
};

function muscleSlug(s) { return (s || '').replace(/\s+/g, '-'); }

function itemImgPath(it) {
  if (it && it.image_path) {
    const v = it.updated_at || it.created_at || '';
    return it.image_path + (v ? `?v=${encodeURIComponent(v)}` : '');
  }
  if (it && it.muscle_group) return `/img/exercises/${muscleSlug(it.muscle_group)}.svg`;
  return '/img/exercises/default.svg';
}

function isVideoMedia(p) {
  return typeof p === 'string' && /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(p);
}

// Mostra foto o video nell'overlay sessione a seconda del media dell'esercizio
function renderSessionMedia(it) {
  const img = document.getElementById('ss-img');
  const video = document.getElementById('ss-video');
  const src = itemImgPath(it);
  if (isVideoMedia(src)) {
    img.classList.add('hidden');
    img.removeAttribute('src');
    video.loop = (it && it.video_loop == null) ? true : !!it.video_loop;
    if (video.getAttribute('src') !== src) video.src = src;
    video.classList.remove('hidden');
    try { video.play().catch(() => {}); } catch (_) {}
  } else {
    video.classList.add('hidden');
    video.pause();
    video.removeAttribute('src');
    video.load();
    img.src = src;
    img.classList.remove('hidden');
  }
}

function formatSec(s) {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r ? `${m}min ${r}s` : `${m}min`;
}

function formatMmss(s) {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function sessionOpts() {
  return (window.Settings && Settings.getSessionOpts) ? Settings.getSessionOpts() : { beep: true, voice: true, wakelock: true };
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
    if (Session.wakelockEnabled) requestWakeLock();
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
const beepStartExercise = () => playBeep(1100, 220);
const beepFinish    = () => {
  playBeep(880, 140);
  setTimeout(() => playBeep(1175, 140), 160);
  setTimeout(() => playBeep(1568, 320), 320);
};

// ── Guida vocale (SpeechSynthesis) ──────
// Su Safari iOS getVoices() è asincrono: ascoltiamo onvoiceschanged.
// Su Apple le voci "naturali" (Siri / Neural / Premium / Enhanced) suonano
// nettamente meglio delle compatte di default: le preferiamo via scoring.
function scoreVoice(v) {
  const uri  = (v.voiceURI || '').toLowerCase();
  const name = (v.name     || '').toLowerCase();
  const hay  = uri + ' ' + name;
  let s = 0;
  if (/siri|neural/.test(hay))               s += 100;
  if (/premium/.test(hay))                   s += 60;
  if (/enhanced|eloquence|eloquenza/.test(hay)) s += 40;
  if (/\bcompact\b/.test(hay))               s -= 30;
  if (v.localService)                        s += 5;
  return s;
}

function initVoice() {
  if (!('speechSynthesis' in window)) return;
  const pickItalian = () => {
    const opts = sessionOpts();
    const all = speechSynthesis.getVoices();
    if (opts.voiceURI) {
      const chosen = all.find(v => v.voiceURI === opts.voiceURI);
      if (chosen) { Session.voice = chosen; return; }
    }
    const its = all.filter(v => v.lang && v.lang.toLowerCase().startsWith('it'));
    if (!its.length) return;
    its.sort((a, b) => scoreVoice(b) - scoreVoice(a));
    Session.voice = its[0];
  };
  pickItalian();
  if (!Session.voice) {
    speechSynthesis.addEventListener('voiceschanged', pickItalian, { once: true });
    setTimeout(pickItalian, 500);
  }
}

function speak(text, onend) {
  if (!Session.voiceEnabled || !('speechSynthesis' in window)) return;
  const opts = sessionOpts();
  const vol = Math.max(0, Math.min(1, opts.voiceVolume ?? 1.0));
  if (vol <= 0) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    if (Session.voice) u.voice = Session.voice;
    if (typeof onend === 'function') u.onend = onend;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = vol;
    speechSynthesis.speak(u);
  } catch (_) {}
}

// SVG pause/play per il bottone primary
const PAUSE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <rect x="6" y="5" width="4" height="14" rx="1"/>
  <rect x="14" y="5" width="4" height="14" rx="1"/>
</svg>`;
const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <polygon points="6,4 20,12 6,20"/>
</svg>`;
function setPauseBtnIcon(showPlay) {
  const btn = document.getElementById('ss-pause-btn');
  if (!btn) return;
  btn.innerHTML = showPlay ? PLAY_SVG : PAUSE_SVG;
  btn.setAttribute('aria-label', showPlay ? 'Riprendi' : 'Pausa');
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
  const opts = sessionOpts();
  ensureAudio();
  // Voice: il toggle del piano (routine.voice_guide) ha priorità; fallback al default globale.
  Session.voiceEnabled = (routine.voice_guide != null) ? !!routine.voice_guide : !!opts.voice;
  Session.beepEnabled = opts.beep !== false;
  Session.wakelockEnabled = opts.wakelock !== false;
  if (Session.voiceEnabled) initVoice();

  Session.routine = routine;
  Session.phases = [];
  // M16: se la routine ha rest_standard_sec valorizzato, sovrascrive le pause per-item.
  const restOverride = (routine.rest_standard_sec != null) ? routine.rest_standard_sec : null;
  // Pausa iniziale di 10s prima del primo esercizio (richiesta utente, sempre fissa)
  if (routine.items.length > 0) {
    Session.phases.push({
      type: 'rest',
      duration: 10,
      item: null,
      nextItem: routine.items[0],
      isInitial: true
    });
  }
  for (let i = 0; i < routine.items.length; i++) {
    const it = routine.items[i];
    const isReps = (it.modalita || 'tempo') === 'ripetizioni';
    const effReps = it.reps_override || it.reps_count || 10;
    Session.phases.push({
      type: 'exercise',
      modalita: isReps ? 'ripetizioni' : 'tempo',
      reps: isReps ? effReps : null,
      // Per gli esercizi a tempo è il countdown reale; per quelli a ripetizioni
      // è solo una stima usata dalla barra di avanzamento totale.
      duration: isReps ? (effReps * 4) : (it.duration_override_sec || it.exercise_duration_sec || 30),
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

  if (Session.wakelockEnabled) requestWakeLock();
  // Annuncio di apertura (prima della voce del primo esercizio)
  if (Session.voiceEnabled) speak('Inizio allenamento');
  enterPhase(0);
}

// ── Sessione libera (cronometro che sale, senza scaletta) ──
function startFreeSession() {
  const opts = sessionOpts();
  Session.freeMode = true;
  Session.routine = null;
  Session.phases = [];
  Session.phaseIndex = 0;
  Session.itemsDone = 0;
  Session.itemsSkipped = 0;
  Session.voiceEnabled = false;
  Session.beepEnabled = false;
  Session.wakelockEnabled = opts.wakelock !== false;
  Session.startedAtIso = new Date().toISOString();
  Session.sessionStartMs = performance.now();
  Session.pausedAccumMs = 0;
  Session.paused = false;
  Session.running = true;
  Session.saved = false;

  const overlay = document.getElementById('session-overlay');
  overlay.dataset.mode = 'free';
  document.getElementById('session-running').classList.remove('hidden');
  document.getElementById('session-summary').classList.add('hidden');
  overlay.classList.remove('hidden');
  setPauseBtnIcon(false);

  if (Session.wakelockEnabled) requestWakeLock();
  freeTick();
}

function freeTick() {
  if (!Session.running || !Session.freeMode) return;
  if (!Session.paused) {
    const elapsedMs = performance.now() - Session.sessionStartMs - Session.pausedAccumMs;
    const el = document.getElementById('ss-free-timer');
    if (el) el.textContent = formatMmss(elapsedMs / 1000);
  }
  Session.rafId = requestAnimationFrame(freeTick);
}

function closeOverlay() {
  Session.running = false;
  if (Session.rafId) { cancelAnimationFrame(Session.rafId); Session.rafId = null; }
  releaseWakeLock();
  stopSpeak();
  const overlay = document.getElementById('session-overlay');
  overlay.classList.add('hidden');
  delete overlay.dataset.mode;
  Session.freeMode = false;
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
  Session.voiceMidSpoken = false;
  Session.voiceCommentSpoken = false;
  Session.announceEndedAtMs = null;
  setPauseBtnIcon(false);

  const ph = Session.phases[idx];
  const cd = document.getElementById('ss-countdown');
  const phaseLbl = document.getElementById('ss-phase');
  const img = document.getElementById('ss-img');
  const name = document.getElementById('ss-name');
  const next = document.getElementById('ss-next');
  const doneBtn = document.getElementById('ss-done-btn');

  // Reset eventuale toggle descrizione → torna sempre alla foto al cambio fase
  const ssImage = document.getElementById('ss-image');
  if (ssImage) ssImage.classList.remove('show-desc');
  const descText = document.getElementById('ss-desc-text');

  if (ph.type === 'exercise') {
    const it = ph.item;
    const isReps = ph.modalita === 'ripetizioni';
    if (Session.beepEnabled) beepStartExercise();
    cd.classList.remove('rest');
    cd.classList.toggle('reps', isReps);
    doneBtn.classList.toggle('hidden', !isReps);
    phaseLbl.textContent = isReps ? 'Ripetizioni' : 'Esercizio';
    phaseLbl.classList.remove('rest');
    next.classList.remove('rest');
    renderSessionMedia(it);
    if (descText) descText.textContent = it.description || 'Nessuna descrizione disponibile per questo esercizio.';
    const sideTxt = SIDE_TXT[it.side] ? ` (${SIDE_TXT[it.side]})` : '';
    name.textContent = (it.name || '') + sideTxt;
    // Esercizio a ripetizioni: niente countdown, mostra il numero di ripetizioni.
    if (isReps) document.getElementById('ss-num').textContent = ph.reps;
    const following = Session.phases.slice(idx + 1).find(p => p.type === 'exercise');
    next.innerHTML = following
      ? `Prossimo: <strong>${escapeHtmlS(following.item.name)}${SIDE_TXT[following.item.side] ? ' (' + SIDE_TXT[following.item.side] + ')' : ''}</strong>`
      : 'Ultimo esercizio';
    // Voce: annuncia il nome dell'esercizio (+ eventuale lato + durata o ripetizioni)
    if (Session.voiceEnabled) {
      const lateral = it.side === 'dx' ? ' lato destro' : it.side === 'sx' ? ' lato sinistro' : '';
      const isBilateral = it.side === 'bilaterale';
      // virgola → piccola pausa naturale prima della quantità
      let amountPhrase;
      if (isReps) {
        amountPhrase = isBilateral
          ? `, ${ph.reps} ripetizioni per lato`
          : `, ${ph.reps} ripetizioni`;
      } else {
        amountPhrase = isBilateral
          ? `, ${Math.round(ph.duration / 2)} secondi per lato`
          : `, per ${ph.duration} secondi`;
      }
      speak(
        `${it.name || 'Esercizio'}${lateral}${amountPhrase}`,
        () => { Session.announceEndedAtMs = performance.now(); }
      );
    }
  } else {
    cd.classList.add('rest');
    cd.classList.remove('reps');
    doneBtn.classList.add('hidden');
    phaseLbl.textContent = ph.isInitial ? 'Preparati' : 'Riposo';
    phaseLbl.classList.add('rest');
    next.classList.add('rest');
    name.textContent = ph.isInitial ? 'Iniziamo' : 'Respira';
    renderSessionMedia(ph.nextItem);
    if (descText) descText.textContent = (ph.nextItem && ph.nextItem.description) || '';
    next.innerHTML = `Prossimo: <strong>${escapeHtmlS(ph.nextItem.name)}${SIDE_TXT[ph.nextItem.side] ? ' (' + SIDE_TXT[ph.nextItem.side] + ')' : ''}</strong>`;
    // Voce: annuncia il prossimo esercizio durante il riposo (o "preparati" se è la pausa iniziale)
    if (Session.voiceEnabled && ph.nextItem) {
      const lateral = ph.nextItem.side === 'dx' ? ' lato destro'
                    : ph.nextItem.side === 'sx' ? ' lato sinistro' : '';
      if (ph.isInitial) {
        speak(`Preparati. Primo esercizio: ${ph.nextItem.name}${lateral}`);
      } else {
        speak(`Pausa. Prossimo: ${ph.nextItem.name}${lateral}`);
      }
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
  // Interrompi subito qualsiasi annuncio in corso (es. nome esercizio appena saltato)
  if ('speechSynthesis' in window) {
    try { speechSynthesis.cancel(); } catch (_) {}
  }
  const ph = Session.phases[Session.phaseIndex];
  if (ph && ph.type === 'exercise') Session.itemsSkipped++;
  let target = Session.phaseIndex + 1;
  if (ph && ph.type === 'exercise' && target < Session.phases.length && Session.phases[target].type === 'rest') {
    target++;
  }
  enterPhase(target);
}

// Riporta i bottoni del riepilogo allo stato iniziale (sessione non salvata).
function resetSummaryButtons(saveLabel) {
  const saveBtn = document.getElementById('sm-save-btn');
  saveBtn.textContent = saveLabel;
  saveBtn.disabled = false;
  saveBtn.classList.remove('hidden');
  const closeBtn = document.getElementById('sm-close-btn');
  closeBtn.textContent = 'Chiudi senza salvare';
  closeBtn.classList.add('btn-ghost');
  closeBtn.classList.remove('btn-primary');
  document.getElementById('sm-saved-msg').classList.add('hidden');
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
  document.getElementById('sm-duration').textContent = formatMmss(totalSec);
  const meta = Session.routine
    ? `${Session.routine.name} · ${Session.itemsDone} esercizi`
    : `${Session.itemsDone} esercizi`;
  const metaEl = document.getElementById('sm-routine-meta');
  if (metaEl) metaEl.textContent = meta;
  resetSummaryButtons('Fatto');
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

  // Commento esercizio: parte N s dopo la fine dell'annuncio del nome
  // (N configurabile in Profilo, default 3s). Vale sia per gli esercizi a
  // tempo che per quelli a ripetizioni.
  const _opts = sessionOpts();
  const _commentOn = _opts.commentEnabled !== false;
  const _commentDelayMs = Math.max(0, (_opts.commentDelaySec ?? 3) * 1000);
  if (Session.voiceEnabled && _commentOn && ph.type === 'exercise' && !Session.voiceCommentSpoken
      && ph.item && ph.item.notes
      && Session.announceEndedAtMs
      && (performance.now() - Session.announceEndedAtMs) >= _commentDelayMs) {
    Session.voiceCommentSpoken = true;
    speak(ph.item.notes);
  }

  // Esercizio a ripetizioni: avanzamento manuale, nessun countdown né beep.
  // Si attende il tap su "Fatto" (vedi listener ss-done-btn → nextPhase).
  if (ph.type === 'exercise' && ph.modalita === 'ripetizioni') {
    updateTotalProgress(elapsedMs);
    Session.rafId = requestAnimationFrame(tick);
    return;
  }

  const totalMs = ph.duration * 1000;
  const remainingMs = Math.max(0, totalMs - elapsedMs);

  const secDisplay = Math.ceil(remainingMs / 1000);
  document.getElementById('ss-num').textContent = secDisplay;

  // Beep 3-2-1 solo per la fase esercizio (non disturbare in riposo)
  if (Session.beepEnabled && Session.lastCountdownSec !== secDisplay) {
    if (secDisplay === 3 || secDisplay === 2 || secDisplay === 1) beepCountdown();
    Session.lastCountdownSec = secDisplay;
  }
  // Guida vocale 3-2-1 (solo in fase esercizio, solo se abilitata)
  if (Session.voiceEnabled && ph.type === 'exercise'
      && Session.voiceLastSpokenSec !== secDisplay
      && secDisplay >= 1 && secDisplay <= 3) {
    const words = { 3: 'tre', 2: 'due', 1: 'uno' };
    speak(words[secDisplay]);
    Session.voiceLastSpokenSec = secDisplay;
  }
  // Guida vocale a metà fase esercizio: una sola volta.
  // - Se bilaterale → "cambia lato" (annuncio sempre, è un'istruzione operativa)
  // - Altrimenti → "metà tempo" solo se esercizio ≥ 20s (per non disturbare i corti)
  if (Session.voiceEnabled && ph.type === 'exercise' && !Session.voiceMidSpoken
      && elapsedMs >= totalMs / 2) {
    const isBilateral = ph.item && ph.item.side === 'bilaterale';
    if (isBilateral || ph.duration >= 20) {
      Session.voiceMidSpoken = true;
      speak(isBilateral ? 'cambia lato' : 'metà tempo');
    }
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
  const sr = document.getElementById('session-running');
  if (!Session.paused) {
    Session.paused = true;
    Session.pauseStartMs = performance.now();
    stopSpeak();
    setPauseBtnIcon(true);
    releaseWakeLock();
    if (sr) sr.classList.add('is-paused');
  } else {
    Session.pausedAccumMs += (performance.now() - Session.pauseStartMs);
    Session.paused = false;
    setPauseBtnIcon(false);
    if (Session.wakelockEnabled) requestWakeLock();
    if (sr) sr.classList.remove('is-paused');
  }
}

function stopEarly() {
  const msg = Session.freeMode
    ? 'Terminare la sessione?'
    : 'Terminare ora la sessione? Potrai salvarla parziale.';
  if (!confirm(msg)) return;
  Session.running = false;
  if (Session.rafId) { cancelAnimationFrame(Session.rafId); Session.rafId = null; }
  releaseWakeLock();
  stopSpeak();
  Session._endedAtIso = new Date().toISOString();
  Session._durationSec = Math.round((performance.now() - Session.sessionStartMs - (Session.pausedAccumMs || 0)) / 1000);

  document.getElementById('sm-done').textContent = Session.itemsDone;
  document.getElementById('sm-skipped').textContent = Session.itemsSkipped;
  document.getElementById('sm-duration').textContent = formatMmss(Session._durationSec);
  const metaEl = document.getElementById('sm-routine-meta');
  if (metaEl) {
    if (Session.freeMode) metaEl.textContent = 'Sessione libera';
    else if (Session.routine) metaEl.textContent = `${Session.routine.name} · sessione parziale`;
    else metaEl.textContent = 'Sessione parziale';
  }
  resetSummaryButtons(Session.freeMode ? 'Salva' : 'Salva (parziale)');
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
    routine_name:  Session.freeMode ? 'Sessione libera' : (Session.routine ? Session.routine.name : null),
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
    document.getElementById('sm-saved-msg').classList.remove('hidden');
    // Sessione salvata: niente più scelta "salva / non salvare", resta solo "Chiudi".
    btn.classList.add('hidden');
    const closeBtn = document.getElementById('sm-close-btn');
    closeBtn.textContent = 'Chiudi';
    closeBtn.classList.remove('btn-ghost');
    closeBtn.classList.add('btn-primary');
  } else {
    btn.disabled = false;
    btn.textContent = 'Riprova salvataggio';
  }
}

// ── Listener ────────────────────────────
// Toggle descrizione esercizio: tap sulla foto → testo in overlay sopra l'immagine.
const _ssImageEl = document.getElementById('ss-image');
if (_ssImageEl) {
  const toggleDesc = () => _ssImageEl.classList.toggle('show-desc');
  _ssImageEl.addEventListener('click', toggleDesc);
  _ssImageEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDesc(); }
  });
}

document.getElementById('ss-pause-btn').addEventListener('click', togglePause);
document.getElementById('ss-skip-btn').addEventListener('click', skipPhase);
// "Fatto, prossimo" — avanzamento manuale degli esercizi a ripetizioni
document.getElementById('ss-done-btn').addEventListener('click', () => {
  if (!Session.running || Session.paused) return;
  stopSpeak();
  nextPhase();
});
document.getElementById('ss-stop-btn').addEventListener('click', stopEarly);
document.getElementById('sm-save-btn').addEventListener('click', saveSession);
document.getElementById('sm-close-btn').addEventListener('click', closeOverlay);
const smCloseX = document.getElementById('sm-close-x');
if (smCloseX) smCloseX.addEventListener('click', closeOverlay);

const _freeCard = document.getElementById('free-session-card');
if (_freeCard) {
  _freeCard.addEventListener('click', () => {
    if (Session.running) return;
    startFreeSession();
  });
}

window.startSession = startSession;
window.startFreeSession = startFreeSession;
