/* ==========================================
   app.js — Core SPA: auth, fetch wrapper, tema
   ========================================== */

window.App = {
  user: null,
  currentTab: 'routines'   // tab di default al login (ex Libreria, ora Piani)
};

// ── Fetch wrapper ──────────────────────────
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'same-origin',
      ...options
    });
    if (res.status === 401) {
      localStorage.removeItem('st-auth-ok');
      showLogin();
      return null;
    }
    return res;
  } catch (err) {
    // Errore di rete (offline, server down): non invalidiamo la sessione
    console.warn('Fetch error (offline?):', url);
    return null;
  }
}

async function apiGet(url)         { const r = await apiFetch(url); return r ? r.json() : null; }
async function apiPost(url, body)  { const r = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) }); return r ? r.json() : null; }
async function apiPut(url, body)   { const r = await apiFetch(url, { method: 'PUT',  body: JSON.stringify(body) }); return r ? r.json() : null; }
async function apiPatch(url, body) { const r = await apiFetch(url, { method: 'PATCH', body: JSON.stringify(body) }); return r ? r.json() : null; }
async function apiDelete(url)      { const r = await apiFetch(url, { method: 'DELETE' }); return r ? r.json() : null; }

// ── Utility date ──────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = todayStr();
  const y = shiftDate(t, -1);
  const dayMonth = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).toUpperCase();
  if (dateStr === t) return `OGGI, ${dayMonth}`;
  if (dateStr === y) return `IERI, ${dayMonth}`;
  const weekday = d.toLocaleDateString('it-IT', { weekday: 'long' }).toUpperCase();
  return `${weekday}, ${dayMonth}`;
}

function fmt(n, decimals = 1) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return parseFloat(Number(n).toFixed(decimals)).toString();
}

function showMsg(el, text, type = 'success') {
  if (!el) return;
  el.textContent = text;
  el.className = `msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── Tema (light/dark) ─────────────────────
function getPreferredTheme() {
  const saved = localStorage.getItem('st-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('st-theme', next);
  applyTheme(next);
}

// Applica subito (prima che app/login appaiano) per evitare flash
applyTheme(getPreferredTheme());

// ── Auth ──────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  // Notifica ai moduli tab il tab corrente così caricano i dati.
  document.dispatchEvent(new CustomEvent('tabchange', { detail: { tab: window.App.currentTab } }));
}

async function checkAuth() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.ok) {
      const me = await res.json();
      window.App.user = me;
      localStorage.setItem('st-auth-ok', '1');
      const nameEl = document.getElementById('user-name');
      if (nameEl) nameEl.textContent = me.username || '';
      showApp();
    } else {
      localStorage.removeItem('st-auth-ok');
      showLogin();
    }
  } catch (err) {
    if (localStorage.getItem('st-auth-ok') === '1') {
      // Offline: lascia vedere la shell comunque
      showApp();
    } else {
      showLogin();
    }
  }
}

async function doLogout() {
  await fetch('/logout', { method: 'POST', credentials: 'same-origin' });
  localStorage.removeItem('st-auth-ok');
  window.App.user = null;
  showLogin();
}

// ── Login form ────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');

    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password })
    });

    if (res.ok) {
      document.getElementById('login-pass').value = '';
      checkAuth();
    } else {
      showMsg(errEl, 'Credenziali non valide', 'error');
    }
  });

  document.getElementById('logout-btn').addEventListener('click', doLogout);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Tab switching
  document.querySelectorAll('.tab-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  checkAuth();
  registerServiceWorker();
});

// ── Service Worker registration + update banner ─
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');

      // Se un nuovo SW è già in waiting al caricamento della pagina, mostra il banner
      if (reg.waiting) showUpdateBanner(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            // Installato ma non attivo: c'è già un SW che controlla la pagina → aggiornamento pronto
            showUpdateBanner(nw);
          }
        });
      });

      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  });
}

function showUpdateBanner(worker) {
  const banner = document.getElementById('update-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  document.getElementById('update-reload').onclick = () => {
    worker.postMessage({ type: 'SKIP_WAITING' });
    // Il reload avverrà via controllerchange quando il nuovo SW prende il controllo
  };
}

function switchTab(name) {
  document.querySelectorAll('.tab-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('hidden', p.id !== `tab-${name}`);
  });
  window.App.currentTab = name;
  document.dispatchEvent(new CustomEvent('tabchange', { detail: { tab: name } }));
}
