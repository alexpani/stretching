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
  filter: { q: '', muscle_group: '', side: '', posizione: '' },
  sort: { key: null, dir: 'asc' },   // key: 'name' | 'muscle_group' | null
  uploadRowId: null   // id riga per cui sta arrivando la foto
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

const MUSCLE_LABELS_T = {
  'collo e spalle':   'Collo e spalle',
  'schiena':          'Schiena',
  'addominali':       'Addominali',
  'glutei e gambe':   'Glutei e gambe',
  'braccia e torace': 'Braccia e torace'
};

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

// ── Carica ──────────────────────────────
async function loadTable() {
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
  if (Table.filter.muscle_group && ex.muscle_group !== Table.filter.muscle_group) return false;
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
    <button type="button" class="tbl-thumb" title="Clicca per cambiare foto o video">
      ${mediaTagT(ex)}
    </button>
  `;
  tdThumb.querySelector('.tbl-thumb').addEventListener('click', () => {
    Table.uploadRowId = ex.id;
    document.getElementById('tbl-file-input').click();
  });
  tr.appendChild(tdThumb);

  // Nome
  tr.appendChild(buildInputCell('text', 'name', ex.name || '', 'col-name'));
  // Descrizione
  tr.appendChild(buildTextareaCell('description', ex.description || '', 'col-desc'));
  // Commento durante l'esercizio (notes)
  tr.appendChild(buildTextareaCell('notes', ex.notes || '', 'col-notes'));
  // Gruppo
  tr.appendChild(buildSelectCell('muscle_group', ex.muscle_group, MUSCLE_LABELS_T, 'col-muscle'));
  // Lato
  tr.appendChild(buildSelectCell('side', ex.side || 'both',
    { 'both': 'Entrambi', 'dx': 'Destro', 'sx': 'Sinistro', 'bilaterale': 'Bilaterale' }, 'col-side'));
  // Posizione
  tr.appendChild(buildSelectCell('posizione', ex.posizione || 'in piedi',
    { 'in piedi': 'In piedi', 'da seduto': 'Da seduto', 'a terra': 'A terra' }, 'col-posizione'));
  // Durata
  tr.appendChild(buildInputCell('number', 'duration_sec', ex.duration_sec || 30, 'col-dur'));
  // Loop video
  tr.appendChild(buildCheckboxCell('video_loop', ex.video_loop == null ? true : !!ex.video_loop, 'col-loop'));

  // Azioni
  const tdAct = document.createElement('td');
  tdAct.className = 'col-actions';
  tdAct.innerHTML = `
    <div class="row-actions">
      <button type="button" class="save-btn" title="Salva modifiche" disabled>✓</button>
      <button type="button" class="dup-btn" title="Duplica">⎘</button>
      <button type="button" class="del-btn" title="Elimina">×</button>
    </div>
  `;
  tdAct.querySelector('.save-btn').addEventListener('click', () => saveRow(tr));
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

  return tr;
}

function buildInputCell(type, field, value, colClass) {
  const td = document.createElement('td');
  td.className = colClass;
  const min = type === 'number' ? ' min="5" max="600"' : '';
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

function markDirty(tr) {
  tr.classList.add('dirty');
  tr.querySelector('.save-btn').disabled = false;
}

function getRowData(tr) {
  const data = {};
  tr.querySelectorAll('[data-field]').forEach(el => {
    const f = el.dataset.field;
    data[f] = (el.type === 'checkbox') ? (el.checked ? '1' : '0') : el.value;
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
  fd.set('muscle_group', data.muscle_group);
  fd.set('side',         data.side || 'both');
  fd.set('posizione',    data.posizione || 'in piedi');
  fd.set('duration_sec', data.duration_sec || 30);
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
  fd.set('muscle_group', ex.muscle_group);
  fd.set('side', ex.side || 'both');
  fd.set('posizione', ex.posizione || 'in piedi');
  fd.set('duration_sec', ex.duration_sec);
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
  fd.set('muscle_group', Table.filter.muscle_group || 'collo e spalle');
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
document.getElementById('tbl-filter-muscle').addEventListener('change', (e) => {
  Table.filter.muscle_group = e.target.value;
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
