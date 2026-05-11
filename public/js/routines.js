/* ==========================================
   routines.js — Tab Piani (ex Routine)
   CRUD + drag-and-drop items via SortableJS
   ========================================== */

const Routines = {
  list: [],
  current: null,      // dettaglio aperto
  sortable: null,
  editMode: false     // M14: view/edit mode nel dettaglio piano
};

const MUSCLE_LBL = {
  'collo e spalle':   'Collo e spalle',
  'schiena':          'Schiena',
  'addominali':       'Addominali',
  'glutei e gambe':   'Glutei e gambe',
  'braccia e torace': 'Braccia e torace'
};
const SIDE_LBL = { dx: 'DX', sx: 'SX', bilaterale: 'BL' };

function slugMuscle(s) {
  return (s || '').replace(/\s+/g, '-');
}

function fmtDuration(sec) {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}min`;
  return `${m}min ${s}s`;
}

function itemImg(it) {
  if (it.image_path) {
    const v = it.updated_at || it.created_at || '';
    return it.image_path + (v ? `?v=${encodeURIComponent(v)}` : '');
  }
  if (it.muscle_group) return `/img/exercises/${slugMuscle(it.muscle_group)}.svg`;
  return '/img/exercises/default.svg';
}

function isVideoMediaR(p) {
  return typeof p === 'string' && /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(p);
}

function itemMediaTag(it) {
  const src = itemImg(it);
  if (!isVideoMediaR(src)) return `<img src="${src}" alt="" />`;
  const loop = (it.video_loop == null || it.video_loop) ? ' loop' : '';
  return `<video src="${src}" muted${loop} autoplay playsinline preload="metadata"></video>`;
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
    const hasCover = !!r.cover_image_path;
    card.className = 'plan-card' + (hasCover ? '' : ' no-cover');
    const imgHtml = hasCover
      ? `<img class="plan-cover-img" src="${escHtml(r.cover_image_path)}" alt="" />`
      : '';
    card.innerHTML = `
      <div class="plan-cover">
        ${imgHtml}
        ${hasCover ? '<div class="plan-cover-overlay"></div>' : ''}
        <div class="plan-cover-meta">
          <div class="plan-cover-meta-l">
            <div class="plan-cover-name">${escHtml(r.name)}</div>
            <div class="plan-cover-sub">${r.items_total} esercizi · ${fmtDuration(r.duration_sec)}</div>
          </div>
          <div class="plan-cover-play" aria-hidden="true">${window.Icons ? Icons.Play({ size: 18 }) : '▶'}</div>
        </div>
      </div>
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
  Routines.editMode = false;                         // sempre view-mode all'apertura
  setEditMode(false);

  document.getElementById('routines-list-view').classList.add('hidden');
  document.getElementById('routine-detail-view').classList.remove('hidden');
  document.getElementById('routine-detail-name').textContent = r.name;
  document.getElementById('rd-items').textContent = r.items_total;
  document.getElementById('rd-duration').textContent = fmtDuration(r.duration_sec);
  // Cover banner (M-cover)
  const coverEl = document.getElementById('rd-cover');
  const coverImg = document.getElementById('rd-cover-img');
  if (r.cover_image_path) {
    coverImg.src = r.cover_image_path;
    coverEl.classList.remove('hidden');
  } else {
    coverImg.removeAttribute('src');
    coverEl.classList.add('hidden');
  }

  renderRoutineItems(r.items);
}

function setEditMode(on) {
  Routines.editMode = !!on;
  const view = document.getElementById('routine-detail-view');
  view.classList.toggle('edit-mode', Routines.editMode);
  const toggleBtn = document.getElementById('rd-edit-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = Routines.editMode ? '✓' : '✎';
    toggleBtn.setAttribute('aria-label', Routines.editMode ? 'Fine modifica' : 'Modifica piano');
  }
  // In view-mode distruggi Sortable per evitare drag accidentale
  if (!Routines.editMode && Routines.sortable) {
    Routines.sortable.destroy();
    Routines.sortable = null;
  } else if (Routines.editMode && Routines.current) {
    renderRoutineItems(Routines.current.items);     // ri-renderizza per riagganciare Sortable
  }
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
      <div class="item-thumb">${itemMediaTag(it)}</div>
      <div class="item-body">
        <div class="item-name">${escHtml(it.name)}</div>
        <div class="item-meta-row">${sideBadge}<span class="item-meta">${MUSCLE_LBL[it.muscle_group]} · ${dur}s · riposo ${it.rest_after_sec || 0}s</span></div>
      </div>
      <button class="item-del" data-del="${it.id}" aria-label="Rimuovi">×</button>
    `;
    row.addEventListener('click', (e) => {
      if (!Routines.editMode) return;                // read-only in view mode
      if (e.target.closest('.drag-handle') || e.target.closest('.item-del')) return;
      openItemEdit(it);
    });
    frag.appendChild(row);
  }
  root.appendChild(frag);

  // SortableJS solo in edit mode
  if (Routines.sortable) { Routines.sortable.destroy(); Routines.sortable = null; }
  if (Routines.editMode && typeof Sortable !== 'undefined') {
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
      if (!confirm('Rimuovere questo esercizio dal piano?')) return;
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
  // Ricalcola durata e count dalla lista in memoria (usa rest_standard_sec se valorizzato)
  const items = Routines.current.items || [];
  const restOverride = (Routines.current.rest_standard_sec != null) ? Routines.current.rest_standard_sec : null;
  let total = 0;
  for (const it of items) {
    total += (it.duration_override_sec || it.exercise_duration_sec || 0);
    total += (restOverride != null) ? restOverride : (it.rest_after_sec || 0);
  }
  if (items.length) {
    const last = items[items.length - 1];
    total -= (restOverride != null) ? restOverride : (last.rest_after_sec || 0);
  }
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
  document.getElementById('modal-routine-title').textContent = r ? 'Impostazioni' : 'Nuovo piano';
  document.getElementById('rt-id').value          = r ? r.id : '';
  document.getElementById('rt-name').value        = r ? r.name : '';
  document.getElementById('rt-description').value = r ? (r.description || '') : '';
  document.getElementById('rt-rest-std').value    = (r && r.rest_standard_sec != null) ? r.rest_standard_sec : '';
  document.getElementById('rt-voice-guide').checked = !!(r && r.voice_guide);

  // Cover preview
  const coverImg = document.getElementById('rt-cover-img');
  const coverEmpty = document.getElementById('rt-cover-empty');
  document.getElementById('rt-cover-file').value = '';
  Routines._coverFile = null;
  Routines._coverRemove = false;
  if (r && r.cover_image_path) {
    coverImg.src = r.cover_image_path;
    coverEmpty.style.display = 'none';
  } else {
    coverImg.removeAttribute('src');
    coverEmpty.style.display = '';
  }

  document.getElementById('rt-error').classList.add('hidden');
  document.getElementById('modal-routine').classList.remove('hidden');
}
function closeRoutineModal() {
  document.getElementById('modal-routine').classList.add('hidden');
}

document.getElementById('modal-routine').addEventListener('click', (e) => {
  if (e.target.dataset && e.target.dataset.close) closeRoutineModal();
});

// Preview cover al cambio file
document.getElementById('rt-cover-file').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  Routines._coverFile = f;
  Routines._coverRemove = false;
  const url = URL.createObjectURL(f);
  document.getElementById('rt-cover-img').src = url;
  document.getElementById('rt-cover-empty').style.display = 'none';
});

document.getElementById('rt-cover-remove').addEventListener('click', () => {
  Routines._coverFile = null;
  Routines._coverRemove = true;
  document.getElementById('rt-cover-file').value = '';
  document.getElementById('rt-cover-img').removeAttribute('src');
  document.getElementById('rt-cover-empty').style.display = '';
});

document.getElementById('fab-add-routine').addEventListener('click', () => openRoutineModal(null));
document.getElementById('rd-edit-toggle').addEventListener('click', () => {
  setEditMode(!Routines.editMode);
});
document.getElementById('rd-rename-btn').addEventListener('click', () => {
  if (Routines.current) openRoutineModal(Routines.current);
});

document.getElementById('form-routine').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('rt-error');
  errEl.classList.add('hidden');
  const id = document.getElementById('rt-id').value;
  const restStdVal = document.getElementById('rt-rest-std').value.trim();
  const payload = {
    name: document.getElementById('rt-name').value.trim(),
    description: document.getElementById('rt-description').value.trim(),
    rest_standard_sec: restStdVal === '' ? null : parseInt(restStdVal, 10),
    voice_guide: document.getElementById('rt-voice-guide').checked
  };
  let res = id
    ? await apiPut(`/api/routines/${id}`, payload)
    : await apiPost('/api/routines', payload);
  if (!res || res.error) {
    showMsg(errEl, (res && res.error) || 'Errore di salvataggio', 'error');
    return;
  }

  // Gestione cover (upload o remove) dopo il save dei metadata
  const targetId = res.id;
  if (Routines._coverFile) {
    const fd = new FormData();
    fd.set('file', Routines._coverFile);
    const cr = await fetch(`/api/routines/${targetId}/cover`, {
      method: 'PUT', body: fd, credentials: 'same-origin'
    });
    if (cr.ok) res = await cr.json();
  } else if (Routines._coverRemove) {
    const dr = await fetch(`/api/routines/${targetId}/cover`, {
      method: 'DELETE', credentials: 'same-origin'
    });
    if (dr.ok) res.cover_image_path = null;
  }
  Routines._coverFile = null;
  Routines._coverRemove = false;

  closeRoutineModal();
  if (id && Routines.current && Routines.current.id === id) {
    Routines.current.name = res.name;
    Routines.current.description = res.description;
    Routines.current.rest_standard_sec = res.rest_standard_sec;
    Routines.current.voice_guide = res.voice_guide;
    Routines.current.cover_image_path = res.cover_image_path;
    document.getElementById('routine-detail-name').textContent = res.name;
    // Aggiorna banner cover nel detail
    const coverEl = document.getElementById('rd-cover');
    const coverImg = document.getElementById('rd-cover-img');
    if (res.cover_image_path) {
      // Aggiungo cache-buster per forzare refresh dell'immagine sostituita
      coverImg.src = res.cover_image_path + '?t=' + Date.now();
      coverEl.classList.remove('hidden');
    } else {
      coverImg.removeAttribute('src');
      coverEl.classList.add('hidden');
    }
    refreshStatsOnly();
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
  if (!confirm(`Eliminare il piano "${Routines.current.name}"?`)) return;
  const res = await apiDelete(`/api/routines/${Routines.current.id}`);
  if (res && res.ok) backToList();
});

document.getElementById('rd-play-btn').addEventListener('click', () => {
  if (!Routines.current) return;
  if (typeof window.startSession === 'function') window.startSession(Routines.current);
});

// ── Picker esercizi ─────────────────────
async function openPicker() {
  document.getElementById('picker-search').value = '';
  // Assicurati che la lista esercizi sia caricata (se l'utente apre il picker
  // senza essere mai entrato nel tab Esercizi).
  if (typeof Library !== 'undefined' && !(Library.items && Library.items.length) &&
      typeof loadExercises === 'function') {
    await loadExercises();
  }
  renderPicker('');
  document.getElementById('modal-exercise-picker').classList.remove('hidden');
  // Focus sulla casella di ricerca dopo che il modale è visibile.
  // requestAnimationFrame evita race con il transition/display change.
  requestAnimationFrame(() => {
    const s = document.getElementById('picker-search');
    if (s) s.focus();
  });
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
    list.innerHTML = '<div class="empty-state" style="padding:24px">Nessun esercizio. Aggiungi prima voci in Esercizi.</div>';
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
