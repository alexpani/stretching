/* ==========================================
   routines.js — Tab Routine (M4)
   CRUD + drag-and-drop items via SortableJS
   ========================================== */

const Routines = {
  list: [],
  current: null,   // dettaglio aperto
  sortable: null
};

const MUSCLE_LBL = {
  collo: 'Collo', spalle: 'Spalle', schiena: 'Schiena', core: 'Core',
  gambe: 'Gambe', anche: 'Anche', polpacci: 'Polpacci', braccia: 'Braccia'
};
const SIDE_LBL = { dx: 'DX', sx: 'SX' };

function fmtDuration(sec) {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}min`;
  return `${m}min ${s}s`;
}

function itemImg(it) {
  if (it.image_path) return it.image_path;
  if (it.muscle_group) return `/img/exercises/${it.muscle_group}.svg`;
  return '/img/exercises/default.svg';
}

function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Liste ────────────────────────────────
async function loadRoutines() {
  const list = await apiGet('/api/routines');
  Routines.list = Array.isArray(list) ? list : [];
  renderRoutines();
}

function renderRoutines() {
  const root = document.getElementById('routines-list');
  const empty = document.getElementById('routines-empty');
  root.innerHTML = '';
  if (!Routines.list.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const frag = document.createDocumentFragment();
  for (const r of Routines.list) {
    const card = document.createElement('div');
    card.className = 'routine-card';
    card.innerHTML = `
      <div class="rc-body">
        <div class="rc-name">${escHtml(r.name)}</div>
        <div class="rc-meta">${r.items_total} esercizi · ${fmtDuration(r.duration_sec)}</div>
      </div>
      <div class="rc-arrow">›</div>
    `;
    card.addEventListener('click', () => openRoutineDetail(r.id));
    frag.appendChild(card);
  }
  root.appendChild(frag);
}

// ── Dettaglio ───────────────────────────
async function openRoutineDetail(id) {
  const r = await apiGet(`/api/routines/${id}`);
  if (!r) return;
  Routines.current = r;

  document.getElementById('routines-list-view').classList.add('hidden');
  document.getElementById('routine-detail-view').classList.remove('hidden');
  document.getElementById('routine-detail-name').textContent = r.name;
  document.getElementById('rd-items').textContent = r.items_total;
  document.getElementById('rd-duration').textContent = fmtDuration(r.duration_sec);

  renderRoutineItems(r.items);
}

function renderRoutineItems(items) {
  const root = document.getElementById('routine-items-list');
  root.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.dataset.itemId = it.id;
    const dur = it.duration_override_sec || it.exercise_duration_sec;
    const sideBadge = SIDE_LBL[it.side] ? `<span class="badge side-${it.side}">${SIDE_LBL[it.side]}</span>` : '';
    row.innerHTML = `
      <div class="drag-handle" aria-label="Trascina">≡</div>
      <div class="item-thumb"><img src="${itemImg(it)}" alt="" /></div>
      <div class="item-body">
        <div class="item-name">${escHtml(it.name)}</div>
        <div class="item-meta-row">${sideBadge}<span class="item-meta">${MUSCLE_LBL[it.muscle_group]} · ${dur}s · riposo ${it.rest_after_sec || 0}s</span></div>
      </div>
      <button class="item-del" data-del="${it.id}" aria-label="Rimuovi">×</button>
    `;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.drag-handle') || e.target.closest('.item-del')) return;
      openItemEdit(it);
    });
    frag.appendChild(row);
  }
  root.appendChild(frag);

  // SortableJS
  if (Routines.sortable) Routines.sortable.destroy();
  if (typeof Sortable !== 'undefined') {
    Routines.sortable = Sortable.create(root, {
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: async () => {
        const order = [...root.querySelectorAll('.item-row')].map(r => r.dataset.itemId);
        const newItems = await apiPut(`/api/routines/${Routines.current.id}/reorder`, { order });
        if (Array.isArray(newItems)) {
          Routines.current.items = newItems;
          refreshStatsOnly();
        }
      }
    });
  }

  // Click sul bottone × (delegato)
  root.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.del;
      if (!confirm('Rimuovere questo esercizio dalla routine?')) return;
      const items = await apiDelete(`/api/routines/${Routines.current.id}/items/${itemId}`);
      if (Array.isArray(items)) {
        Routines.current.items = items;
        renderRoutineItems(items);
        refreshStatsOnly();
      }
    });
  });
}

function refreshStatsOnly() {
  // Ricalcola durata e count dalla lista in memoria
  const items = Routines.current.items || [];
  let total = 0;
  for (const it of items) {
    total += (it.duration_override_sec || it.exercise_duration_sec || 0);
    total += (it.rest_after_sec || 0);
  }
  if (items.length) total -= (items[items.length - 1].rest_after_sec || 0);
  document.getElementById('rd-items').textContent = items.length;
  document.getElementById('rd-duration').textContent = fmtDuration(Math.max(0, total));
}

function backToList() {
  Routines.current = null;
  document.getElementById('routine-detail-view').classList.add('hidden');
  document.getElementById('routines-list-view').classList.remove('hidden');
  loadRoutines();
}

// ── Nuova / rinomina routine ────────────
function openRoutineModal(r) {
  document.getElementById('modal-routine-title').textContent = r ? 'Rinomina routine' : 'Nuova routine';
  document.getElementById('rt-id').value          = r ? r.id : '';
  document.getElementById('rt-name').value        = r ? r.name : '';
  document.getElementById('rt-description').value = r ? (r.description || '') : '';
  document.getElementById('rt-error').classList.add('hidden');
  document.getElementById('modal-routine').classList.remove('hidden');
}
function closeRoutineModal() {
  document.getElementById('modal-routine').classList.add('hidden');
}

document.getElementById('modal-routine').addEventListener('click', (e) => {
  if (e.target.dataset && e.target.dataset.close) closeRoutineModal();
});

document.getElementById('fab-add-routine').addEventListener('click', () => openRoutineModal(null));
document.getElementById('routine-edit-btn').addEventListener('click', () => {
  if (Routines.current) openRoutineModal(Routines.current);
});

document.getElementById('form-routine').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('rt-error');
  errEl.classList.add('hidden');
  const id = document.getElementById('rt-id').value;
  const payload = {
    name: document.getElementById('rt-name').value.trim(),
    description: document.getElementById('rt-description').value.trim()
  };
  const res = id
    ? await apiPut(`/api/routines/${id}`, payload)
    : await apiPost('/api/routines', payload);
  if (!res || res.error) {
    showMsg(errEl, (res && res.error) || 'Errore di salvataggio', 'error');
    return;
  }
  closeRoutineModal();
  if (id && Routines.current && Routines.current.id === id) {
    Routines.current.name = res.name;
    Routines.current.description = res.description;
    document.getElementById('routine-detail-name').textContent = res.name;
  } else {
    loadRoutines();
  }
});

// ── Azioni dettaglio ────────────────────
document.getElementById('routine-back').addEventListener('click', backToList);

document.getElementById('rd-dup-btn').addEventListener('click', async () => {
  if (!Routines.current) return;
  const r = await apiPost(`/api/routines/${Routines.current.id}/duplicate`, {});
  if (r && r.id) {
    backToList();
  }
});

document.getElementById('rd-del-btn').addEventListener('click', async () => {
  if (!Routines.current) return;
  if (!confirm(`Eliminare la routine "${Routines.current.name}"?`)) return;
  const res = await apiDelete(`/api/routines/${Routines.current.id}`);
  if (res && res.ok) backToList();
});

document.getElementById('rd-play-btn').addEventListener('click', () => {
  if (!Routines.current) return;
  if (typeof window.startSession === 'function') window.startSession(Routines.current);
});

// ── Picker esercizi ─────────────────────
function openPicker() {
  document.getElementById('picker-search').value = '';
  renderPicker('');
  document.getElementById('modal-exercise-picker').classList.remove('hidden');
}
function closePicker() {
  document.getElementById('modal-exercise-picker').classList.add('hidden');
}
document.getElementById('modal-exercise-picker').addEventListener('click', (e) => {
  if (e.target.dataset && e.target.dataset.close) closePicker();
});
document.getElementById('rd-add-item-btn').addEventListener('click', openPicker);
document.getElementById('picker-search').addEventListener('input', (e) => renderPicker(e.target.value));

function renderPicker(q) {
  const list = document.getElementById('picker-list');
  list.innerHTML = '';
  const qq = q.toLowerCase().trim();
  const items = (Library.items || []).filter(ex =>
    !qq || (ex.name && ex.name.toLowerCase().includes(qq))
  );
  if (!items.length) {
    list.innerHTML = '<div class="empty-state" style="padding:24px">Nessun esercizio. Aggiungi prima esercizi dalla Libreria.</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const ex of items) {
    const row = document.createElement('div');
    row.className = 'picker-row';
    const sideBadge = SIDE_LBL[ex.side] ? `<span class="badge side-${ex.side}">${SIDE_LBL[ex.side]}</span>` : '';
    row.innerHTML = `
      <div class="picker-thumb"><img src="${itemImg(ex)}" alt="" /></div>
      <div class="picker-body">
        <div class="picker-name">${escHtml(ex.name)}</div>
        <div class="picker-meta-row">${sideBadge}<span class="picker-meta">${MUSCLE_LBL[ex.muscle_group]} · ${ex.duration_sec}s</span></div>
      </div>
      <button class="btn btn-primary" style="min-height:36px; padding:0 var(--space-3);">+</button>
    `;
    row.querySelector('button').addEventListener('click', async () => {
      const items = await apiPost(`/api/routines/${Routines.current.id}/items`, { exercise_id: ex.id });
      if (Array.isArray(items)) {
        Routines.current.items = items;
        renderRoutineItems(items);
        refreshStatsOnly();
        closePicker();
      }
    });
    frag.appendChild(row);
  }
  list.appendChild(frag);
}

// ── Modal item (override durata/riposo) ──
function openItemEdit(it) {
  document.getElementById('modal-item-title').textContent = 'Modifica esercizio';
  document.getElementById('it-id').value       = it.id;
  const sideStr = SIDE_LBL[it.side] ? ` (${SIDE_LBL[it.side]})` : '';
  document.getElementById('it-exercise-name').textContent = `${it.name}${sideStr}`;
  document.getElementById('it-duration').value = it.duration_override_sec || '';
  document.getElementById('it-duration').placeholder = `${it.exercise_duration_sec}`;
  document.getElementById('it-default-dur').textContent = it.exercise_duration_sec;
  document.getElementById('it-rest').value     = it.rest_after_sec != null ? it.rest_after_sec : 10;
  document.getElementById('modal-item').classList.remove('hidden');
}
function closeItemModal() {
  document.getElementById('modal-item').classList.add('hidden');
}
document.getElementById('modal-item').addEventListener('click', (e) => {
  if (e.target.dataset && e.target.dataset.close) closeItemModal();
});
document.getElementById('form-item').addEventListener('submit', async (e) => {
  e.preventDefault();
  const itemId = document.getElementById('it-id').value;
  const durVal = document.getElementById('it-duration').value.trim();
  const payload = {
    duration_override_sec: durVal ? parseInt(durVal, 10) : null,
    rest_after_sec: parseInt(document.getElementById('it-rest').value, 10) || 0
  };
  const items = await apiPut(`/api/routines/${Routines.current.id}/items/${itemId}`, payload);
  if (Array.isArray(items)) {
    Routines.current.items = items;
    renderRoutineItems(items);
    refreshStatsOnly();
    closeItemModal();
  }
});

// ── Trigger ingresso tab ────────────────
document.addEventListener('tabchange', (e) => {
  if (e.detail.tab === 'routines') {
    // se non siamo in dettaglio, ricarica la lista
    if (!Routines.current) loadRoutines();
  }
});
