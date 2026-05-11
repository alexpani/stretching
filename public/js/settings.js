/* ==========================================
   settings.js — Aspetto + sessione defaults.
   Gestisce palette x6, tema (auto/light/dark)
   e i toggle Beep/Voice/WakeLock persistiti in
   localStorage. Idempotente: chiama Settings.init()
   dopo che il DOM è pronto.
   ========================================== */
(function () {
  const PALETTES = [
    { id: 'indaco',     name: 'Indaco',      accent: '#5B7FA8', accent2: '#3F5C82', soft: '#DDE6F0' },
    { id: 'salvia',     name: 'Salvia',      accent: '#5B8E84', accent2: '#3F6F66', soft: '#E2EBE7' },
    { id: 'terracotta', name: 'Terracotta',  accent: '#C58B4F', accent2: '#9B6A38', soft: '#F5E9DA' },
    { id: 'carbone',    name: 'Carbone',     accent: '#15161A', accent2: '#45464C', soft: '#ECEAE4' },
    { id: 'rosa',       name: 'Rosa antico', accent: '#B5697A', accent2: '#8B4A5B', soft: '#F0DDE2' },
    { id: 'oliva',      name: 'Oliva',       accent: '#7B8A4F', accent2: '#5C6936', soft: '#E5E8D5' },
    { id: 'oceano',     name: 'Oceano',      accent: '#3E7B8A', accent2: '#285C68', soft: '#D8E5E9' },
    { id: 'lavanda',    name: 'Lavanda',     accent: '#8A7AA8', accent2: '#665680', soft: '#E5DEEC' },
    { id: 'ambra',      name: 'Ambra',       accent: '#B88A2F', accent2: '#8E6A1E', soft: '#F0E4C8' },
    { id: 'muschio',    name: 'Muschio',     accent: '#4F7355', accent2: '#365239', soft: '#DDE6DC' },
    { id: 'corallo',    name: 'Corallo',     accent: '#D27865', accent2: '#A8553F', soft: '#F4DED4' },
    { id: 'notte',      name: 'Notte',       accent: '#3A4A6B', accent2: '#26334D', soft: '#D8DDE7' },
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
    const def = { beep: true, voice: true, wakelock: true, voiceVolume: 1.0, voiceURI: '', commentEnabled: true, commentDelaySec: 3 };
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
    const map = { beep: 'opt-beep', voice: 'opt-voice', wakelock: 'opt-wakelock', commentEnabled: 'opt-comment' };
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

    const delay = document.getElementById('opt-comment-delay');
    const delayVal = document.getElementById('opt-comment-delay-val');
    if (delay) {
      const init = Math.max(0, Math.min(30, parseInt(opts.commentDelaySec ?? 3, 10) || 3));
      delay.value = String(init);
      if (delayVal) delayVal.textContent = `${init}s`;
      const onDelayChange = () => {
        const s = Math.max(0, Math.min(30, parseInt(delay.value, 10) || 0));
        if (delayVal) delayVal.textContent = `${s}s`;
        const next = getSessionOpts();
        next.commentDelaySec = s;
        setSessionOpts(next);
      };
      delay.addEventListener('input', onDelayChange);
      delay.addEventListener('change', onDelayChange);
    }
  }

  function bindVoicePicker() {
    const sel = document.getElementById('opt-voice-pick');
    const sub = document.getElementById('opt-voice-pick-sub');
    const test = document.getElementById('opt-voice-test');
    if (!sel) return;
    if (!('speechSynthesis' in window)) {
      sel.disabled = true;
      if (sub) sub.textContent = 'Sintesi vocale non disponibile su questo browser';
      if (test) test.disabled = true;
      return;
    }
    const populate = () => {
      const its = speechSynthesis.getVoices()
        .filter(v => v.lang && v.lang.toLowerCase().startsWith('it'));
      const opts = getSessionOpts();
      const cur = opts.voiceURI || '';
      const optionsHtml = [
        '<option value="">Automatica (migliore disponibile)</option>',
        ...its.map(v => {
          const lbl = `${v.name}${v.lang ? ' — ' + v.lang : ''}${v.localService ? '' : ' ☁'}`;
          const sel = v.voiceURI === cur ? ' selected' : '';
          return `<option value="${v.voiceURI}"${sel}>${lbl.replace(/</g,'&lt;')}</option>`;
        })
      ].join('');
      sel.innerHTML = optionsHtml;
      if (sub) {
        if (!its.length) sub.textContent = 'Nessuna voce italiana trovata sul dispositivo';
        else sub.textContent = 'Scegli quale voce italiana usare. Su iOS scarica una voce "Migliorata" da Impostazioni → Accessibilità → Contenuto letto → Voci.';
      }
    };
    populate();
    speechSynthesis.addEventListener('voiceschanged', populate);
    sel.addEventListener('change', () => {
      const next = getSessionOpts();
      next.voiceURI = sel.value || '';
      setSessionOpts(next);
    });
    if (test) {
      test.addEventListener('click', () => {
        const opts = getSessionOpts();
        try { speechSynthesis.cancel(); } catch (_) {}
        const u = new SpeechSynthesisUtterance('Piegamenti in avanti, per 30 secondi');
        u.lang = 'it-IT';
        u.volume = Math.max(0, Math.min(1, opts.voiceVolume ?? 1.0));
        const chosen = speechSynthesis.getVoices().find(v => v.voiceURI === (opts.voiceURI || sel.value));
        if (chosen) u.voice = chosen;
        speechSynthesis.speak(u);
      });
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
    bindVoicePicker();
  }

  window.Settings = {
    PALETTES, PALETTE_IDS,
    getPalette, getThemePref, resolveTheme,
    getSessionOpts, setSessionOpts,
    initUI,
  };
})();
