/* ==========================================
   settings.js — Aspetto + sessione defaults.
   Gestisce palette x6, tema (auto/light/dark)
   e i toggle Beep/Voice/WakeLock persistiti in
   localStorage. Idempotente: chiama Settings.init()
   dopo che il DOM è pronto.
   ========================================== */
(function () {
  const PALETTES = [
    { id: 'indaco',     name: 'Indaco',     accent: '#5B7FA8', accent2: '#3F5C82', soft: '#DDE6F0' },
    { id: 'salvia',     name: 'Salvia',     accent: '#5B8E84', accent2: '#3F6F66', soft: '#E2EBE7' },
    { id: 'terracotta', name: 'Terracotta', accent: '#C58B4F', accent2: '#9B6A38', soft: '#F5E9DA' },
    { id: 'carbone',    name: 'Carbone',    accent: '#15161A', accent2: '#45464C', soft: '#ECEAE4' },
    { id: 'rosa',       name: 'Rosa antico', accent: '#B5697A', accent2: '#8B4A5B', soft: '#F0DDE2' },
    { id: 'oliva',      name: 'Oliva',      accent: '#7B8A4F', accent2: '#5C6936', soft: '#E5E8D5' },
  ];
  const PALETTE_IDS = PALETTES.map(p => p.id);
  const DEFAULT_PALETTE = 'indaco';

  const THEMES = ['auto', 'light', 'dark'];
  const DEFAULT_THEME = 'auto';

  /* Letture persistenza ──────────────────── */
  function getPalette() {
    const v = localStorage.getItem('st-palette');
    return PALETTE_IDS.includes(v) ? v : DEFAULT_PALETTE;
  }
  function getThemePref() {
    const v = localStorage.getItem('st-theme');
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
    return DEFAULT_THEME;
  }
  function resolveTheme(pref) {
    if (pref === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return pref;
  }

  /* Applicazione al DOM ──────────────────── */
  function applyPalette(id) {
    document.documentElement.setAttribute('data-palette', id);
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  /* Session toggles ──────────────────────── */
  function getSessionOpts() {
    const raw = localStorage.getItem('st-session-opts');
    const def = { beep: true, voice: true, wakelock: true, voiceVolume: 1.0 };
    if (!raw) return def;
    try { return Object.assign(def, JSON.parse(raw)); } catch { return def; }
  }
  function setSessionOpts(opts) {
    localStorage.setItem('st-session-opts', JSON.stringify(opts));
  }

  /* Render UI Profilo ────────────────────── */
  function renderPaletteGrid() {
    const grid = document.getElementById('palette-grid');
    if (!grid) return;
    const current = getPalette();
    grid.innerHTML = PALETTES.map(p => `
      <button type="button" class="palette-card${p.id === current ? ' active' : ''}" data-palette-id="${p.id}">
        <div class="palette-swatches">
          <span style="background:${p.accent}"></span>
          <span style="background:${p.accent2}"></span>
          <span style="background:${p.soft}"></span>
        </div>
        <div class="palette-name">${p.name}</div>
        <span class="palette-check" aria-hidden="true">${window.Icons ? Icons.Check({ size: 12 }) : '✓'}</span>
      </button>
    `).join('');
    grid.querySelectorAll('.palette-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.paletteId;
        localStorage.setItem('st-palette', id);
        applyPalette(id);
        grid.querySelectorAll('.palette-card').forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  }

  function refreshThemeRows() {
    const list = document.getElementById('theme-list');
    if (!list) return;
    const cur = getThemePref();
    list.querySelectorAll('.profile-row').forEach(r => {
      r.classList.toggle('selected', r.dataset.themeChoice === cur);
    });
  }

  function bindThemePicker() {
    const list = document.getElementById('theme-list');
    if (!list) return;
    list.querySelectorAll('[data-theme-choice]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.themeChoice;
        localStorage.setItem('st-theme', v);
        applyTheme(resolveTheme(v));
        refreshThemeRows();
      });
    });
  }

  function bindSessionToggles() {
    const opts = getSessionOpts();
    const map = { beep: 'opt-beep', voice: 'opt-voice', wakelock: 'opt-wakelock' };
    Object.entries(map).forEach(([key, id]) => {
      const cb = document.getElementById(id);
      if (!cb) return;
      cb.checked = !!opts[key];
      cb.addEventListener('change', () => {
        const next = getSessionOpts();
        next[key] = cb.checked;
        setSessionOpts(next);
      });
    });

    const slider = document.getElementById('opt-voice-volume');
    const valEl = document.getElementById('opt-voice-volume-val');
    if (slider) {
      const init = Math.round((opts.voiceVolume ?? 1.0) * 100);
      slider.value = String(init);
      if (valEl) valEl.textContent = `${init}%`;
      const onChange = () => {
        const pct = Math.max(0, Math.min(100, parseInt(slider.value, 10) || 0));
        if (valEl) valEl.textContent = `${pct}%`;
        const next = getSessionOpts();
        next.voiceVolume = pct / 100;
        setSessionOpts(next);
      };
      slider.addEventListener('input', onChange);
      slider.addEventListener('change', onChange);
    }
  }

  /* Reazione a cambi sistema (auto theme) ─ */
  function bindSystemThemeListener() {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (getThemePref() === 'auto') applyTheme(resolveTheme('auto'));
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* Boot — applica palette+tema PRIMA del rendering */
  function bootApply() {
    applyPalette(getPalette());
    applyTheme(resolveTheme(getThemePref()));
  }
  bootApply();
  bindSystemThemeListener();

  /* Init UI: chiamata da app.js dopo DOMContentLoaded */
  function initUI() {
    renderPaletteGrid();
    refreshThemeRows();
    bindThemePicker();
    bindSessionToggles();
  }

  window.Settings = {
    PALETTES, PALETTE_IDS,
    getPalette, getThemePref, resolveTheme,
    getSessionOpts, setSessionOpts,
    initUI,
  };
})();
