/* ==========================================
   history.js — Tab Storico (M6)
   Statistiche, heatmap mensile, grafico 7gg,
   lista cronologica.
   ========================================== */

const History = {
  sessions: [],     // ultime N sessioni caricate
  hmYear: null,
  hmMonth: null,    // 0-11
  chart: null
};

const MONTH_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

function dayKeyLocal(d) {
  // Date (oggetto) → 'YYYY-MM-DD' in fuso locale
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseStarted(isoStr) {
  // Preservo l'istante reale (UTC) ma conservo anche la data locale.
  const d = new Date(isoStr);
  return { date: d, dayKey: dayKeyLocal(d) };
}

function fmtMinutes(sec) {
  return Math.round(sec / 60);
}

function fmtDateHuman(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((t - target) / (24 * 3600 * 1000));
  const dm = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  if (diff === 0) return `Oggi, ${dm}`;
  if (diff === 1) return `Ieri, ${dm}`;
  const wd = d.toLocaleDateString('it-IT', { weekday: 'long' });
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${dm}`;
}

// ── Caricamento + render ─────────────────
async function loadHistory() {
  const list = await apiGet('/api/sessions?limit=500');
  History.sessions = Array.isArray(list) ? list : [];

  computeStats();
  renderHeatmap();
  renderChartWeekly();
  renderSessionsList();
}

// ── Statistiche ──────────────────────────
function computeStats() {
  const sessions = History.sessions;
  const todayKey = dayKeyLocal(new Date());

  // Set di giorni con almeno una sessione (in fuso locale)
  const daySet = new Set();
  let count30 = 0, time30Sec = 0;
  const now = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  for (const s of sessions) {
    const { date, dayKey } = parseStarted(s.started_at);
    daySet.add(dayKey);
    if (date >= cutoff30) {
      count30++;
      time30Sec += s.duration_sec || 0;
    }
  }

  // Streak corrente: parti da oggi, o da ieri se oggi non ha sessioni.
  let streakStart = new Date();
  if (!daySet.has(todayKey)) streakStart.setDate(streakStart.getDate() - 1);
  let streak = 0;
  const cursor = new Date(streakStart.getTime());
  while (daySet.has(dayKeyLocal(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Streak massima: scan giorni ordinati, trova la catena più lunga.
  const days = [...daySet].sort();
  let maxStreak = 0, run = 0, prev = null;
  for (const k of days) {
    if (prev === null) { run = 1; }
    else {
      const prevDate = new Date(prev + 'T00:00:00');
      const curDate  = new Date(k    + 'T00:00:00');
      const diff = Math.round((curDate - prevDate) / (24 * 3600 * 1000));
      run = diff === 1 ? run + 1 : 1;
    }
    if (run > maxStreak) maxStreak = run;
    prev = k;
  }

  document.getElementById('stat-streak').textContent = streak;
  document.getElementById('stat-streak-max').textContent = maxStreak;
  document.getElementById('stat-30d-count').textContent = count30;
  document.getElementById('stat-30d-time').textContent = fmtMinutes(time30Sec);
}

// ── Heatmap mensile ──────────────────────
function renderHeatmap() {
  if (History.hmYear === null) {
    const now = new Date();
    History.hmYear = now.getFullYear();
    History.hmMonth = now.getMonth();
  }

  document.getElementById('hm-month').textContent =
    `${MONTH_IT[History.hmMonth]} ${History.hmYear}`;

  // Costruisci mappa giorno → {count, duration}
  const agg = {};
  for (const s of History.sessions) {
    const { dayKey } = parseStarted(s.started_at);
    if (!agg[dayKey]) agg[dayKey] = { count: 0, duration: 0 };
    agg[dayKey].count++;
    agg[dayKey].duration += s.duration_sec || 0;
  }

  const firstDay = new Date(History.hmYear, History.hmMonth, 1);
  const daysInMonth = new Date(History.hmYear, History.hmMonth + 1, 0).getDate();
  // firstDay.getDay(): 0=dom, 1=lun, ..., 6=sab → vogliamo offset con lunedì = 0
  let leading = firstDay.getDay() - 1;
  if (leading < 0) leading = 6;

  const todayKey = dayKeyLocal(new Date());
  const grid = document.getElementById('heatmap');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (let i = 0; i < leading; i++) {
    const c = document.createElement('div');
    c.className = 'hm-cell empty';
    frag.appendChild(c);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const y = History.hmYear;
    const m = String(History.hmMonth + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const key = `${y}-${m}-${dd}`;
    const cell = document.createElement('div');
    cell.className = 'hm-cell';
    if (key === todayKey) cell.classList.add('today');
    if (agg[key]) {
      cell.classList.add('has');
      cell.title = `${d} ${MONTH_IT[History.hmMonth]} · ${agg[key].count} sess · ${fmtMinutes(agg[key].duration)} min`;
    } else {
      cell.title = `${d} ${MONTH_IT[History.hmMonth]}`;
    }
    cell.textContent = d;
    frag.appendChild(cell);
  }
  grid.appendChild(frag);
}

document.getElementById('hm-prev').addEventListener('click', () => {
  History.hmMonth--;
  if (History.hmMonth < 0) { History.hmMonth = 11; History.hmYear--; }
  renderHeatmap();
});
document.getElementById('hm-next').addEventListener('click', () => {
  History.hmMonth++;
  if (History.hmMonth > 11) { History.hmMonth = 0; History.hmYear++; }
  renderHeatmap();
});

// ── Grafico ultimi 7 giorni ─────────────
function renderChartWeekly() {
  if (typeof Chart === 'undefined') return;
  const labels = [];
  const values = [];
  const now = new Date(); now.setHours(0, 0, 0, 0);

  const agg = {};
  for (const s of History.sessions) {
    const { dayKey } = parseStarted(s.started_at);
    agg[dayKey] = (agg[dayKey] || 0) + (s.duration_sec || 0);
  }

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
    const key = dayKeyLocal(d);
    labels.push(d.toLocaleDateString('it-IT', { weekday: 'short' }));
    values.push(Math.round((agg[key] || 0) / 60));
  }

  const ctx = document.getElementById('chart-weekly');
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary').trim() || '#666';
  const primary = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#2DB6A8';

  if (History.chart) History.chart.destroy();
  History.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: primary,
        borderRadius: 6,
        maxBarThickness: 36
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.parsed.y} min` } }
      },
      scales: {
        x: { ticks: { color: textColor }, grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: { color: textColor, stepSize: 5, precision: 0 },
          grid: { color: 'rgba(128,128,128,0.12)' }
        }
      }
    }
  });
}

// ── Lista cronologica ───────────────────
function renderSessionsList() {
  const root = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  root.innerHTML = '';
  if (!History.sessions.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const frag = document.createDocumentFragment();
  for (const s of History.sessions) {
    const d = new Date(s.started_at);
    const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const dur = fmtMinutes(s.duration_sec);
    const row = document.createElement('div');
    row.className = 'history-row';
    const name = s.routine_name || 'Sessione libera';
    row.innerHTML = `
      <div class="h-body">
        <div class="h-name">${escapeHtmlH(name)}</div>
        <div class="h-meta">${fmtDateHuman(d)} · ${time} · ${dur} min · ${s.items_total} esercizi${s.items_skipped ? `, ${s.items_skipped} saltati` : ''}</div>
      </div>
      <button class="h-del" data-id="${s.id}" aria-label="Elimina">×</button>
    `;
    frag.appendChild(row);
  }
  root.appendChild(frag);

  root.querySelectorAll('.h-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Eliminare questa sessione dallo storico?')) return;
      const res = await apiDelete(`/api/sessions/${btn.dataset.id}`);
      if (res && res.ok) loadHistory();
    });
  });
}

function escapeHtmlH(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Tab change ──────────────────────────
document.addEventListener('tabchange', (e) => {
  if (e.detail.tab === 'history') loadHistory();
});
