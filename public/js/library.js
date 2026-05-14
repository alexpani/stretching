/* ==========================================
   library.js — Tab Esercizi (ex Libreria)
   ========================================== */

const Library = {
  filter: { zones: [], posizione: '' },
  items: [],
  modalOpen: false
};

const MUSCLE_LABELS = {
  'collo e spalle':   'Collo e spalle',
  'schiena':          'Schiena',
  'addominali':       'Addominali',
  'glutei e gambe':   'Glutei e gambe',
  'braccia e torace': 'Braccia e torace'
};
// Zone muscolari (tag multipli). Allineato a ZONES in routes/exercises.js.
const ZONES = [
  'Collo e cervicale',
  'Spalle e cingolo scapolare',
  'Braccia e polsi',
  'Petto',
  'Dorsale (schiena alta)',
  'Lombare (schiena bassa)',
  'Core e addome',
  'Anche e flessori dell\'anca',
  'Glutei e piriforme',
  'Quadricipiti',
  'Ischiocrurali (femorali posteriori)',
  'Adduttori e inguine',
  'Polpacci e caviglie',
  'Catena posteriore completa'
];
const SIDE_LABELS = { dx: 'DX', sx: 'SX', bilaterale: 'BL' };

// Converte un muscle_group ("glutei e gambe") in slug file-safe ("glutei-e-gambe")
// per il path SVG placeholder.
function slugMuscle(s) {
  return (s || '').replace(/\s+/g, '-');
}

function imgFor(ex) {
  if (ex && ex.image_path) {
    const v = ex.updated_at || ex.created_at || '';
    return ex.image_path + (v ? `?v=${encodeURIComponent(v)}` : '');
  }
  if (ex && ex.muscle_group) return `/img/exercises/${slugMuscle(ex.muscle_group)}.svg`;
  return '/img/exercises/default.svg';
}

function isVideoMedia(p) {
  return typeof p === 'string' && /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(p);
}

function mediaTagFor(ex) {
  const src = imgFor(ex);
  if (!isVideoMedia(src)) return `<img src="${src}" alt="" loading="lazy" />`;
  const loop = (ex.video_loop == null || ex.video_loop) ? ' loop' : '';
  return `<video src="${src}" muted${loop} autoplay playsinline preload="metadata"></video>`;
}
// Esposto globalmente: anche session.js lo userà.
window.slugMuscle = slugMuscle;

async function loadExercises() {
  const params = new URLSearchParams();
  if (Library.filter.zones.length) params.set('zones', Library.filter.zones.join(','));
  if (Library.filter.posizione) params.set('posizione', Library.filter.posizione);
  const qs = params.toString() ? `?${params}` : '';
  const list = await apiGet(`/api/exercises${qs}`);
  Library.items = Array.isArray(list) ? list : [];
  renderExercises();
}

function renderExercises() {
  const grid = document.getElementById('exercises-grid');
  const empty = document.getElementById('exercises-empty');
  grid.innerHTML = '';
  if (!Library.items.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const frag = document.createDocumentFragment();
  for (const ex of Library.items) {
    const card = document.createElement('div');
    card.className = 'exercise-card';
    const sideBadge = SIDE_LABELS[ex.side]
      ? `<span class="badge side-${ex.side}">${SIDE_LABELS[ex.side]}</span>`
      : '';
    const zones = Array.isArray(ex.zones) ? ex.zones : [];
    const zoneTxt = zones.length
      ? (zones.length > 1 ? `${zones[0]} +${zones.length - 1}` : zones[0])
      : (MUSCLE_LABELS[ex.muscle_group] || ex.muscle_group);
    const amount = (ex.modalita === 'ripetizioni')
      ? `${ex.reps_count || '?'} rip.`
      : `${ex.duration_sec}s`;
    card.innerHTML = `
      <div class="thumb">${mediaTagFor(ex)}</div>
      <div class="body">
        <div class="name">${escapeHtml(ex.name)}</div>
        <div class="meta-row">${sideBadge}<span class="meta">${escapeHtml(zoneTxt)} · ${amount}</span></div>
      </div>
    `;
    card.addEventListener('click', () => openModal(ex));
    frag.appendChild(card);
  }
  grid.appendChild(frag);
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Filtri ───────────────────────────────
// Costruisce le chip del filtro zone: "Tutte" + una per zona (multi-selezione).
(function buildZoneFilter() {
  const row = document.getElementById('filter-zone');
  let html = '<button class="chip active" data-zone="">Tutte</button>';
  for (const z of ZONES) html += `<button class="chip" data-zone="${escapeHtml(z)}">${escapeHtml(z)}</button>`;
  row.innerHTML = html;
})();

document.getElementById('filter-zone').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  const row = document.getElementById('filter-zone');
  const zone = btn.dataset.zone || '';
  if (!zone) {
    Library.filter.zones = [];               // "Tutte" → azzera la selezione
  } else {
    btn.classList.toggle('active');
    Library.filter.zones = [...row.querySelectorAll('.chip.active')]
      .map(c => c.dataset.zone).filter(Boolean);
  }
  const allBtn = row.querySelector('.chip[data-zone=""]');
  if (Library.filter.zones.length === 0) {
    row.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    allBtn.classList.add('active');
  } else {
    allBtn.classList.remove('active');
  }
  loadExercises();
});

// Costruisce le zone come tag toggle nel modal esercizio.
(function buildZoneTags() {
  document.getElementById('ex-zones').innerHTML = ZONES.map(z =>
    `<button type="button" class="chip" data-zone="${escapeHtml(z)}">${escapeHtml(z)}</button>`
  ).join('');
})();
document.getElementById('ex-zones').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) chip.classList.toggle('active');
});

document.getElementById('filter-posizione').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  document.querySelectorAll('#filter-posizione .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  Library.filter.posizione = btn.dataset.posizione || '';
  loadExercises();
});

// ── Modal ────────────────────────────────
// Mostra il campo durata o ripetizioni in base alla modalità selezionata.
function applyModalitaUI() {
  const isReps = document.getElementById('ex-modalita').value === 'ripetizioni';
  document.getElementById('ex-duration-field').classList.toggle('hidden', isReps);
  document.getElementById('ex-reps-field').classList.toggle('hidden', !isReps);
}

function openModal(ex) {
  const modal = document.getElementById('modal-exercise');
  document.getElementById('modal-ex-title').textContent = ex ? 'Modifica esercizio' : 'Nuovo esercizio';
  document.getElementById('ex-id').value           = ex ? ex.id : '';
  document.getElementById('ex-name').value         = ex ? ex.name : '';
  const exZones = (ex && Array.isArray(ex.zones)) ? ex.zones : [];
  document.querySelectorAll('#ex-zones .chip').forEach(chip => {
    chip.classList.toggle('active', exZones.includes(chip.dataset.zone));
  });
  document.getElementById('ex-side').value         = ex ? (ex.side || 'both') : 'both';
  document.getElementById('ex-posizione').value    = ex ? (ex.posizione || 'in piedi') : 'in piedi';
  document.getElementById('ex-duration').value     = ex ? ex.duration_sec : 30;
  document.getElementById('ex-modalita').value     = ex ? (ex.modalita || 'tempo') : 'tempo';
  document.getElementById('ex-reps').value         = (ex && ex.reps_count) ? ex.reps_count : 10;
  applyModalitaUI();
  document.getElementById('ex-description').value  = ex ? (ex.description || '') : '';
  document.getElementById('ex-notes').value        = ex ? (ex.notes || '') : '';
  document.getElementById('ex-file').value         = '';
  document.getElementById('ex-remove-image').checked = false;
  document.getElementById('ex-video-loop').checked = ex ? (ex.video_loop == null ? true : !!ex.video_loop) : true;
  document.getElementById('ex-img').src            = imgFor(ex);
  document.getElementById('ex-error').classList.add('hidden');
  document.getElementById('ex-delete-row').style.display = ex ? 'flex' : 'none';
  modal.classList.remove('hidden');
  Library.modalOpen = true;
}

function closeModal() {
  document.getElementById('modal-exercise').classList.add('hidden');
  Library.modalOpen = false;
}

// Chiusura su backdrop / bottoni data-close
document.getElementById('modal-exercise').addEventListener('click', (e) => {
  if (e.target.dataset && e.target.dataset.close) closeModal();
});

document.getElementById('fab-add-exercise').addEventListener('click', () => openModal(null));

document.getElementById('ex-modalita').addEventListener('change', applyModalitaUI);

// Anteprima immagine selezionata
document.getElementById('ex-file').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  document.getElementById('ex-remove-image').checked = false;
  const url = URL.createObjectURL(f);
  document.getElementById('ex-img').src = url;
});

// Submit form
document.getElementById('form-exercise').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('ex-error');
  errEl.classList.add('hidden');

  const id = document.getElementById('ex-id').value;
  const fd = new FormData();
  fd.set('name',         document.getElementById('ex-name').value.trim());
  const selZones = [...document.querySelectorAll('#ex-zones .chip.active')].map(c => c.dataset.zone);
  fd.set('zones',        selZones.join(','));
  fd.set('side',         document.getElementById('ex-side').value);
  fd.set('posizione',    document.getElementById('ex-posizione').value);
  fd.set('duration_sec', document.getElementById('ex-duration').value);
  fd.set('modalita',     document.getElementById('ex-modalita').value);
  fd.set('reps_count',   document.getElementById('ex-reps').value);
  fd.set('description',  document.getElementById('ex-description').value.trim());
  fd.set('notes',        document.getElementById('ex-notes').value.trim());
  fd.set('video_loop',   document.getElementById('ex-video-loop').checked ? '1' : '0');
  const file = document.getElementById('ex-file').files[0];
  if (file) fd.set('file', file);
  if (document.getElementById('ex-remove-image').checked) fd.set('remove_image', '1');

  const url = id ? `/api/exercises/${id}` : '/api/exercises';
  const method = id ? 'PUT' : 'POST';
  try {
    const res = await fetch(url, { method, body: fd, credentials: 'same-origin' });
    if (res.status === 401) { showLogin(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMsg(errEl, data.error || 'Errore salvataggio', 'error');
      return;
    }
    closeModal();
    loadExercises();
  } catch (err) {
    showMsg(errEl, 'Errore di rete', 'error');
  }
});

// Elimina
document.getElementById('ex-delete-btn').addEventListener('click', async () => {
  const id = document.getElementById('ex-id').value;
  if (!id) return;
  let msg = 'Eliminare questo esercizio?';
  const used = await apiGet(`/api/exercises/${id}/routines`);
  if (Array.isArray(used) && used.length) {
    const names = used.map(r => `• ${r.name}`).join('\n');
    msg = `Questo esercizio è usato in ${used.length} ${used.length === 1 ? 'piano' : 'piani'}:\n${names}\n\nEliminarlo comunque?`;
  }
  if (!confirm(msg)) return;
  const res = await apiDelete(`/api/exercises/${id}`);
  if (res && res.ok) {
    closeModal();
    loadExercises();
  }
});

// Primo caricamento quando l'utente è autenticato (checkAuth → showApp)
document.addEventListener('tabchange', (e) => {
  if (e.detail.tab === 'library') loadExercises();
});
// Nota: il primo load avviene via tabchange dispatchato da showApp() in app.js.
// Il listener 'tabchange' sopra si attiva solo quando l'utente apre il tab Esercizi.
