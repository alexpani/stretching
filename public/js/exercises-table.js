/* ==========================================
   exercises-table.js — Foglio di lavoro (M18)
   - Lista tabellare degli esercizi
   - Filtri testo + gruppo + lato
   - Edit inline (auto-save al blur)
   - Upload foto via click sulla miniatura
   - Creazione riga nuova e delete soft
   ========================================== */

const Table = {
  items: [],
  filter: { q: '', zones: [], side: '', posizione: '' },
  sort: { key: null, dir: 'asc' },   // key: 'name' | 'muscle_group' | null
  uploadRowId: null,  // id riga per cui sta arrivando la foto
  zones: []           // elenco zone caricato da /api/zones
};

const MUSCLE_ORDER = ['collo e spalle', 'schiena', 'addominali', 'glutei e gambe', 'braccia e torace'];

function compareSort(a, b) {
  const k = Table.sort.key;
  if (!k) return 0;
  const dir = Table.sort.dir === 'desc' ? -1 : 1;
  let av, bv;
  if (k === 'muscle_group') {
    av = MUSCLE_ORDER.indexOf(a.muscle_group || '');
    bv = MUSCLE_ORDER.indexOf(b.muscle_group || '');
    if (av < 0) av = 999;
    if (bv < 0) bv = 999;
  } else {
    av = (a[k] || '').toString().toLocaleLowerCase('it');
    bv = (b[k] || '').toString().toLocaleLowerCase('it');
  }
  if (av < bv) return -1 * dir;
  if (av > bv) return  1 * dir;
  // Tie-break stabile per nome
  const an = (a.name || '').toLocaleLowerCase('it');
  const bn = (b.name || '').toLocaleLowerCase('it');
  return an < bn ? -1 : an > bn ? 1 : 0;
}

function refreshSortHeaders() {
  document.querySelectorAll('.th-sort').forEach(btn => {
    const key = btn.dataset.sort;
    btn.classList.remove('asc', 'desc');
    if (Table.sort.key === key) btn.classList.add(Table.sort.dir);
  });
}

function slugMuscleT(s) { return (s || '').replace(/\s+/g, '-'); }

function imgForT(ex) {
  if (ex && ex.image_path) {
    // Il file è sempre stretch-<id>.<ext>: bust cache browser/SW al cambio.
    const v = ex.updated_at || ex.created_at || '';
    const q = v ? `?v=${encodeURIComponent(v)}` : '';
    return ex.image_path + q;
  }
  if (ex && ex.muscle_group) return `/img/exercises/${slugMuscleT(ex.muscle_group)}.svg`;
  return '/img/exercises/default.svg';
}

function isVideoMediaT(p) {
  return typeof p === 'string' && /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(p);
}

function mediaTagT(ex) {
  const src = imgForT(ex);
  if (!isVideoMediaT(src)) return `<img src="${src}" alt="" />`;
  const loop = (ex.video_loop == null || ex.video_loop) ? ' loop' : '';
  return `<video src="${src}" muted${loop} autoplay playsinline preload="metadata"></video>`;
}

function escT(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Anteprima grande (lightbox) ─────────
function openLightbox(ex) {
  const box = document.getElementById('tbl-lightbox');
  const inner = document.getElementById('tbl-lightbox-inner');
  const src = imgForT(ex);
  inner.innerHTML = isVideoMediaT(src)
    ? `<video src="${src}" controls autoplay loop playsinline></video>`
    : `<img src="${src}" alt="" />`;
  box.classList.remove('hidden');
}
function closeLightbox() {
  document.getElementById('tbl-lightbox').classList.add('hidden');
  document.getElementById('tbl-lightbox-inner').innerHTML = '';
}
document.getElementById('tbl-lightbox').addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// ── Carica ──────────────────────────────
async function loadZonesT() {
  const res = await fetch('/api/zones', { credentials: 'same-origin' });
  if (!res.ok) return;
  const list = await res.json();
  Table.zones = Array.isArray(list) ? list.map(z => z.name) : [];
  buildZoneFilterT();
}

async function loadTable() {
  await loadZonesT();
  const res = await fetch('/api/exercises', { credentials: 'same-origin' });
  if (res.status === 401) { window.location.href = '/'; return; }
  if (!res.ok) return;
  const list = await res.json();
  Table.items = Array.isArray(list) ? list : [];
  renderTable();
}

function matchesFilter(ex) {
  const q = Table.filter.q.toLowerCase();
  if (q) {
    const hay = ((ex.name || '') + ' ' + (ex.description || '')).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (Table.filter.zones.length) {
    const exZones = Array.isArray(ex.zones) ? ex.zones : [];
    if (!Table.filter.zones.some(z => exZones.includes(z))) return false;
  }
  if (Table.filter.side && ex.side !== Table.filter.side) return false;
  if (Table.filter.posizione && (ex.posizione || 'in piedi') !== Table.filter.posizione) return false;
  return true;
}

function renderTable() {
  const body = document.getElementById('tbl-body');
  const empty = document.getElementById('tbl-empty');
  body.innerHTML = '';
  const filtered = Table.items.filter(matchesFilter);
  if (Table.sort.key) filtered.sort(compareSort);
  refreshSortHeaders();
  document.getElementById('tbl-count').textContent =
    `${filtered.length} / ${Table.items.length}`;
  if (!filtered.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const frag = document.createDocumentFragment();
  for (const ex of filtered) frag.appendChild(buildRow(ex));
  body.appendChild(frag);
}

function buildRow(ex) {
  const tr = document.createElement('tr');
  tr.dataset.id = ex.id;

  // Foto
  const tdThumb = document.createElement('td');
  tdThumb.className = 'col-thumb';
  tdThumb.innerHTML = `
    <div class="tbl-thumb">
      ${mediaTagT(ex)}
      <div class="tbl-thumb-actions">
        <button type="button" class="tbl-thumb-btn js-thumb-edit" title="Cambia foto o video">📷</button>
        <button type="button" class="tbl-thumb-btn js-thumb-zoom" title="Anteprima grande">🔍</button>
      </div>
    </div>
  `;
  tdThumb.querySelector('.js-thumb-edit').addEventListener('click', () => {
    Table.uploadRowId = ex.id;
    document.getElementById('tbl-file-input').click();
  });
  tdThumb.querySelector('.js-thumb-zoom').addEventListener('click', () => openLightbox(ex));
  tr.appendChild(tdThumb);

  // Nome — textarea così il titolo va a capo invece di troncare
  tr.appendChild(buildTextareaCell('name', ex.name || '', 'col-name'));
  // Descrizione
  tr.appendChild(buildTextareaCell('description', ex.description || '', 'col-desc'));
  // Commento durante l'esercizio (notes)
  tr.appendChild(buildTextareaCell('notes', ex.notes || '', 'col-notes'));
  // Zone (tag multipli)
  tr.appendChild(buildZonesCell(Array.isArray(ex.zones) ? ex.zones : []));
  // Lato
  tr.appendChild(buildSelectCell('side', ex.side || 'both',
    { 'both': 'Entrambi', 'dx': 'Destro', 'sx': 'Sinistro', 'bilaterale': 'Bilaterale' }, 'col-side'));
  // Posizione
  tr.appendChild(buildSelectCell('posizione', ex.posizione || 'in piedi',
    { 'in piedi': 'In piedi', 'da seduto': 'Da seduto', 'a terra': 'A terra' }, 'col-posizione'));
  // Modalità
  tr.appendChild(buildSelectCell('modalita', ex.modalita || 'tempo',
    { 'tempo': 'A tempo', 'ripetizioni': 'A ripetizioni' }, 'col-modalita'));
  // Durata
  tr.appendChild(buildInputCell('number', 'duration_sec', ex.duration_sec || 30, 'col-dur'));
  // Ripetizioni
  tr.appendChild(buildInputCell('number', 'reps_count', ex.reps_count || '', 'col-reps'));
  // Loop video
  tr.appendChild(buildCheckboxCell('video_loop', ex.video_loop == null ? true : !!ex.video_loop, 'col-loop'));

  // Azioni
  const tdAct = document.createElement('td');
  tdAct.className = 'col-actions';
  tdAct.innerHTML = `
    <div class="row-actions">
      <button type="button" class="save-btn" title="Salva modifiche" disabled>✓</button>
      <button type="button" class="voice-btn" title="Anteprima voce">🔊</button>
      <button type="button" class="dup-btn" title="Duplica">⎘</button>
      <button type="button" class="del-btn" title="Elimina">×</button>
    </div>
  `;
  tdAct.querySelector('.save-btn').addEventListener('click', () => saveRow(tr));
  tdAct.querySelector('.voice-btn').addEventListener('click', () => previewVoiceRow(tr));
  tdAct.querySelector('.dup-btn').addEventListener('click', () => duplicateRow(ex));
  tdAct.querySelector('.del-btn').addEventListener('click', () => deleteRow(tr, ex));
  tr.appendChild(tdAct);

  // Auto-mark dirty on any input change
  tr.querySelectorAll('input, textarea, select').forEach(el => {
    el.addEventListener('input', () => markDirty(tr));
    el.addEventListener('blur', () => {
      if (tr.classList.contains('dirty')) saveRow(tr);
    });
  });

  // La modalità decide quale tra Durata e Ripetizioni è attiva.
  const modalitaSel = tr.querySelector('select[data-field="modalita"]');
  modalitaSel.addEventListener('change', () => applyModalitaRow(tr));
  applyModalitaRow(tr);

  return tr;
}

// Disabilita il campo non pertinente alla modalità (Durata vs Ripetizioni).
function applyModalitaRow(tr) {
  const isReps = tr.querySelector('select[data-field="modalita"]').value === 'ripetizioni';
  const durInput  = tr.querySelector('input[data-field="duration_sec"]');
  const repsInput = tr.querySelector('input[data-field="reps_count"]');
  durInput.disabled  = isReps;
  repsInput.disabled = !isReps;
  durInput.closest('td').classList.toggle('cell-muted', isReps);
  repsInput.closest('td').classList.toggle('cell-muted', !isReps);
}

function buildInputCell(type, field, value, colClass) {
  const td = document.createElement('td');
  td.className = colClass;
  let min = '';
  if (type === 'number') {
    min = field === 'reps_count' ? ' min="1" max="200"' : ' min="5" max="600"';
  }
  td.innerHTML = `<input type="${type}"${min} data-field="${field}" value="${escT(value)}" />`;
  return td;
}

function buildTextareaCell(field, value, colClass) {
  const td = document.createElement('td');
  td.className = colClass;
  td.innerHTML = `<textarea data-field="${field}" rows="1">${escT(value)}</textarea>`;
  return td;
}

function buildCheckboxCell(field, checked, colClass) {
  const td = document.createElement('td');
  td.className = colClass;
  td.innerHTML = `<label style="display:inline-flex;align-items:center;justify-content:center;width:100%;cursor:pointer">
    <input type="checkbox" data-field="${field}"${checked ? ' checked' : ''} />
  </label>`;
  // Per coerenza con gli altri campi, segnala dirty al change.
  td.querySelector('input').addEventListener('change', (e) => {
    const tr = e.target.closest('tr');
    if (tr) {
      markDirty(tr);
      saveRow(tr);
    }
  });
  return td;
}

function buildSelectCell(field, selected, options, colClass) {
  const td = document.createElement('td');
  td.className = colClass;
  const opts = Object.entries(options)
    .map(([v, lbl]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${escT(lbl)}</option>`)
    .join('');
  td.innerHTML = `<select data-field="${field}">${opts}</select>`;
  return td;
}

// Cella zone: tag toggle con tutte le 14 zone, salvataggio immediato al tap.
function buildZonesCell(selected) {
  const td = document.createElement('td');
  td.className = 'col-zones';
  const chips = Table.zones
    .map(z => `<button type="button" class="zone-tag${selected.includes(z) ? ' active' : ''}" data-zone="${escT(z)}">${escT(z)}</button>`)
    .join('');
  td.innerHTML = `<div class="zone-tags" data-field="zones">${chips}</div>`;
  td.querySelector('.zone-tags').addEventListener('click', (e) => {
    const chip = e.target.closest('.zone-tag');
    if (!chip) return;
    chip.classList.toggle('active');
    const tr = chip.closest('tr');
    if (tr) { markDirty(tr); saveRow(tr); }
  });
  return td;
}

function markDirty(tr) {
  tr.classList.add('dirty');
  tr.querySelector('.save-btn').disabled = false;
}

function getRowData(tr) {
  const data = {};
  tr.querySelectorAll('[data-field]').forEach(el => {
    const f = el.dataset.field;
    if (el.type === 'checkbox') data[f] = el.checked ? '1' : '0';
    else if (el.classList.contains('zone-tags')) data[f] = [...el.querySelectorAll('.zone-tag.active')].map(c => c.dataset.zone);
    else if (el.multiple) data[f] = [...el.selectedOptions].map(o => o.value);
    else data[f] = el.value;
  });
  return data;
}

async function saveRow(tr) {
  const id = tr.dataset.id;
  const data = getRowData(tr);
  const fd = new FormData();
  fd.set('name',         data.name || '');
  fd.set('description',  data.description || '');
  fd.set('notes',        data.notes || '');
  fd.set('zones',        (data.zones || []).join(','));
  fd.set('side',         data.side || 'both');
  fd.set('posizione',    data.posizione || 'in piedi');
  fd.set('duration_sec', data.duration_sec || 30);
  fd.set('modalita',     data.modalita || 'tempo');
  fd.set('reps_count',   data.reps_count || '');
  fd.set('video_loop',   data.video_loop || '0');

  const res = await fetch(`/api/exercises/${id}`, {
    method: 'PUT', body: fd, credentials: 'same-origin'
  });
  if (res.status === 401) { window.location.href = '/'; return; }
  if (!res.ok) {
    tr.querySelector('.save-btn').textContent = '!';
    setTimeout(() => {
      tr.querySelector('.save-btn').textContent = '✓';
    }, 1500);
    return;
  }
  const updated = await res.json();
  // aggiorna in memoria
  const idx = Table.items.findIndex(x => x.id === id);
  if (idx >= 0) Table.items[idx] = updated;
  tr.classList.remove('dirty');
  tr.querySelector('.save-btn').disabled = true;
  tr.querySelector('.save-btn').textContent = '✓';
}

// ── Anteprima voce (rispecchia session.js) ─
function getSessionOptsT() {
  try {
    const raw = localStorage.getItem('st-session-opts');
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

let _voicePreviewCache = null;
function pickItalianVoiceT(preferredURI) {
  if (!('speechSynthesis' in window)) return null;
  const all = speechSynthesis.getVoices();
  if (preferredURI) {
    const chosen = all.find(v => v.voiceURI === preferredURI);
    if (chosen) return chosen;
  }
  const its = all.filter(v => v.lang && v.lang.toLowerCase().startsWith('it'));
  if (!its.length) return null;
  const score = (v) => {
    const hay = ((v.voiceURI || '') + ' ' + (v.name || '')).toLowerCase();
    let s = 0;
    if (/siri|neural/.test(hay)) s += 100;
    if (/premium/.test(hay)) s += 60;
    if (/enhanced|eloquence|eloquenza/.test(hay)) s += 40;
    if (/\bcompact\b/.test(hay)) s -= 30;
    if (v.localService) s += 5;
    return s;
  };
  its.sort((a, b) => score(b) - score(a));
  return its[0];
}

function speakT(text, voice, volume, onend) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    if (voice) u.voice = voice;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = Math.max(0, Math.min(1, volume ?? 1.0));
    if (typeof onend === 'function') u.onend = onend;
    speechSynthesis.speak(u);
  } catch (_) {}
}

function previewVoiceRow(tr) {
  if (!('speechSynthesis' in window)) {
    alert('Sintesi vocale non disponibile su questo browser.');
    return;
  }
  const data = getRowData(tr);
  const name = (data.name || '').trim() || 'Esercizio';
  const side = data.side || 'both';
  const modalita = data.modalita || 'tempo';
  const isReps = modalita === 'ripetizioni';
  const isBilateral = side === 'bilaterale';
  const lateral = side === 'dx' ? ' lato destro' : side === 'sx' ? ' lato sinistro' : '';
  let amount;
  if (isReps) {
    const reps = parseInt(data.reps_count || '0', 10) || 10;
    amount = isBilateral ? `, ${reps} ripetizioni per lato` : `, ${reps} ripetizioni`;
  } else {
    const dur = parseInt(data.duration_sec || '0', 10) || 30;
    amount = isBilateral
      ? `, ${Math.round(dur / 2)} secondi per lato`
      : `, per ${dur} secondi`;
  }
  const phrase = `${name}${lateral}${amount}`;
  const notes = (data.notes || '').trim();

  const opts = getSessionOptsT();
  const volume = opts.voiceVolume ?? 1.0;
  const commentOn = opts.commentEnabled !== false;
  const commentDelayMs = Math.max(0, (opts.commentDelaySec ?? 3) * 1000);

  try { speechSynthesis.cancel(); } catch (_) {}

  const start = () => {
    const voice = pickItalianVoiceT(opts.voiceURI);
    const playComment = commentOn && notes;
    speakT(phrase, voice, volume, playComment ? () => {
      setTimeout(() => speakT(notes, voice, volume), commentDelayMs);
    } : null);
  };

  // Su Safari iOS getVoices() può essere asincrono: attendi voiceschanged se vuoto.
  if (!_voicePreviewCache && !speechSynthesis.getVoices().length) {
    _voicePreviewCache = true;
    speechSynthesis.addEventListener('voiceschanged', start, { once: true });
    setTimeout(start, 400);
  } else {
    start();
  }

  const btn = tr.querySelector('.voice-btn');
  if (btn) {
    btn.classList.add('playing');
    setTimeout(() => btn.classList.remove('playing'), 1200);
  }
}

async function duplicateRow(ex) {
  const res = await fetch(`/api/exercises/${ex.id}/duplicate`, {
    method: 'POST', credentials: 'same-origin'
  });
  if (res.status === 401) { window.location.href = '/'; return; }
  if (!res.ok) return;
  const created = await res.json();
  Table.items.push(created);
  renderTable();
  const newTr = document.querySelector(`tr[data-id="${created.id}"]`);
  if (newTr) newTr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function deleteRow(tr, ex) {
  let msg = `Eliminare "${ex.name}"?`;
  try {
    const r = await fetch(`/api/exercises/${ex.id}/routines`, { credentials: 'same-origin' });
    if (r.ok) {
      const used = await r.json();
      if (Array.isArray(used) && used.length) {
        const names = used.map(x => `• ${x.name}`).join('\n');
        msg = `"${ex.name}" è usato in ${used.length} ${used.length === 1 ? 'piano' : 'piani'}:\n${names}\n\nEliminarlo comunque?`;
      }
    }
  } catch (_) { /* in caso di errore mostra il confirm semplice */ }
  if (!confirm(msg)) return;
  const res = await fetch(`/api/exercises/${ex.id}`, {
    method: 'DELETE', credentials: 'same-origin'
  });
  if (!res.ok) return;
  tr.classList.add('deleted');
  setTimeout(() => {
    Table.items = Table.items.filter(x => x.id !== ex.id);
    renderTable();
  }, 200);
}

// ── Upload foto ─────────────────────────
document.getElementById('tbl-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const id = Table.uploadRowId;
  e.target.value = '';
  if (!file || !id) return;
  const ex = Table.items.find(x => x.id === id);
  if (!ex) return;
  const fd = new FormData();
  fd.set('name', ex.name || '');
  fd.set('description', ex.description || '');
  fd.set('notes', ex.notes || '');
  fd.set('zones', (Array.isArray(ex.zones) ? ex.zones : []).join(','));
  fd.set('side', ex.side || 'both');
  fd.set('posizione', ex.posizione || 'in piedi');
  fd.set('duration_sec', ex.duration_sec);
  fd.set('modalita', ex.modalita || 'tempo');
  fd.set('reps_count', ex.reps_count || '');
  fd.set('video_loop', (ex.video_loop == null || ex.video_loop) ? '1' : '0');
  fd.set('file', file);
  const res = await fetch(`/api/exercises/${id}`, {
    method: 'PUT', body: fd, credentials: 'same-origin'
  });
  if (!res.ok) return;
  const updated = await res.json();
  const idx = Table.items.findIndex(x => x.id === id);
  if (idx >= 0) Table.items[idx] = updated;
  renderTable();
});

// ── Nuovo ───────────────────────────────
document.getElementById('tbl-add-btn').addEventListener('click', async () => {
  const name = prompt('Nome del nuovo esercizio:');
  if (!name || !name.trim()) return;
  const fd = new FormData();
  fd.set('name', name.trim());
  fd.set('zones', Table.filter.zones.join(',') || 'Core e addome');
  fd.set('side', Table.filter.side || 'both');
  fd.set('posizione', Table.filter.posizione || 'in piedi');
  fd.set('duration_sec', 30);
  const res = await fetch('/api/exercises', {
    method: 'POST', body: fd, credentials: 'same-origin'
  });
  if (!res.ok) return;
  await loadTable();
});

// ── Filtri ──────────────────────────────
document.getElementById('tbl-search').addEventListener('input', (e) => {
  Table.filter.q = e.target.value.trim();
  renderTable();
});
// Filtro zone: chip "Tutte" + una per zona, multi-selezione.
// Ricostruito quando l'elenco zone cambia; preserva la selezione corrente.
function buildZoneFilterT() {
  const row = document.getElementById('tbl-filter-zone');
  let html = '<button type="button" class="chip" data-zone="">Tutte</button>';
  for (const z of Table.zones) html += `<button type="button" class="chip" data-zone="${escT(z)}">${escT(z)}</button>`;
  row.innerHTML = html;
  Table.filter.zones = Table.filter.zones.filter(z => Table.zones.includes(z));
  if (Table.filter.zones.length) {
    Table.filter.zones.forEach(z => {
      const c = row.querySelector(`.chip[data-zone="${CSS.escape(z)}"]`);
      if (c) c.classList.add('active');
    });
  } else {
    row.querySelector('.chip[data-zone=""]').classList.add('active');
  }
}
document.getElementById('tbl-filter-zone').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  const row = document.getElementById('tbl-filter-zone');
  const zone = btn.dataset.zone || '';
  if (!zone) {
    Table.filter.zones = [];
  } else {
    btn.classList.toggle('active');
    Table.filter.zones = [...row.querySelectorAll('.chip.active')]
      .map(c => c.dataset.zone).filter(Boolean);
  }
  const allBtn = row.querySelector('.chip[data-zone=""]');
  if (Table.filter.zones.length === 0) {
    row.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    allBtn.classList.add('active');
  } else {
    allBtn.classList.remove('active');
  }
  renderTable();
});
document.getElementById('tbl-filter-side').addEventListener('change', (e) => {
  Table.filter.side = e.target.value;
  renderTable();
});
document.getElementById('tbl-filter-posizione').addEventListener('change', (e) => {
  Table.filter.posizione = e.target.value;
  renderTable();
});
document.getElementById('tbl-filter-reset').addEventListener('click', () => {
  Table.filter = { q: '', zones: [], side: '', posizione: '' };
  document.getElementById('tbl-search').value = '';
  document.getElementById('tbl-filter-side').value = '';
  document.getElementById('tbl-filter-posizione').value = '';
  const zoneRow = document.getElementById('tbl-filter-zone');
  zoneRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  const allZ = zoneRow.querySelector('.chip[data-zone=""]');
  if (allZ) allZ.classList.add('active');
  renderTable();
});

// ── Tema ────────────────────────────────
document.getElementById('tbl-theme').addEventListener('click', () => {
  if (typeof toggleTheme === 'function') toggleTheme();
});

// ── Sort headers ────────────────────────
document.querySelectorAll('.th-sort').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sort;
    if (Table.sort.key === key) {
      // toggle asc → desc → off
      if (Table.sort.dir === 'asc') Table.sort.dir = 'desc';
      else { Table.sort.key = null; Table.sort.dir = 'asc'; }
    } else {
      Table.sort.key = key;
      Table.sort.dir = 'asc';
    }
    renderTable();
  });
});

// ── Init ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTable();
});
