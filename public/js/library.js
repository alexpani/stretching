/* ==========================================
   library.js — Tab Esercizi (ex Libreria)
   ========================================== */

const Library = {
  filter: { muscle_group: '' },
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
const SIDE_LABELS = { dx: 'DX', sx: 'SX' };

// Converte un muscle_group ("glutei e gambe") in slug file-safe ("glutei-e-gambe")
// per il path SVG placeholder.
function slugMuscle(s) {
  return (s || '').replace(/\s+/g, '-');
}

function imgFor(ex) {
  if (ex && ex.image_path) return ex.image_path;
  if (ex && ex.muscle_group) return `/img/exercises/${slugMuscle(ex.muscle_group)}.svg`;
  return '/img/exercises/default.svg';
}
// Esposto globalmente: anche session.js lo userà.
window.slugMuscle = slugMuscle;

async function loadExercises() {
  const params = new URLSearchParams();
  if (Library.filter.muscle_group) params.set('muscle_group', Library.filter.muscle_group);
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
    const sideBadge = (ex.side === 'dx' || ex.side === 'sx')
      ? `<span class="badge side-${ex.side}">${SIDE_LABELS[ex.side]}</span>`
      : '';
    card.innerHTML = `
      <div class="thumb"><img src="${imgFor(ex)}" alt="" loading="lazy" /></div>
      <div class="body">
        <div class="name">${escapeHtml(ex.name)}</div>
        <div class="meta-row">${sideBadge}<span class="meta">${MUSCLE_LABELS[ex.muscle_group] || ex.muscle_group} · ${ex.duration_sec}s</span></div>
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
document.getElementById('filter-muscle').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  document.querySelectorAll('#filter-muscle .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  Library.filter.muscle_group = btn.dataset.muscle || '';
  loadExercises();
});

// ── Modal ────────────────────────────────
function openModal(ex) {
  const modal = document.getElementById('modal-exercise');
  document.getElementById('modal-ex-title').textContent = ex ? 'Modifica esercizio' : 'Nuovo esercizio';
  document.getElementById('ex-id').value           = ex ? ex.id : '';
  document.getElementById('ex-name').value         = ex ? ex.name : '';
  document.getElementById('ex-muscle').value       = ex ? ex.muscle_group : 'collo e spalle';
  document.getElementById('ex-side').value         = ex ? (ex.side || 'both') : 'both';
  document.getElementById('ex-duration').value     = ex ? ex.duration_sec : 30;
  document.getElementById('ex-description').value  = ex ? (ex.description || '') : '';
  document.getElementById('ex-notes').value        = ex ? (ex.notes || '') : '';
  document.getElementById('ex-file').value         = '';
  document.getElementById('ex-remove-image').checked = false;
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
  fd.set('muscle_group', document.getElementById('ex-muscle').value);
  fd.set('side',         document.getElementById('ex-side').value);
  fd.set('duration_sec', document.getElementById('ex-duration').value);
  fd.set('description',  document.getElementById('ex-description').value.trim());
  fd.set('notes',        document.getElementById('ex-notes').value.trim());
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
  if (!confirm('Eliminare questo esercizio?')) return;
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
