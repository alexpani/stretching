/* Stretching v2 — set icone SVG inline.
 * Port di icons.jsx in vanilla. Ogni funzione ritorna una stringa SVG.
 * Stroke 1.6, round caps, viewBox 24x24 salvo diversa indicazione.
 * Uso: el.innerHTML = Icons.Plans()  oppure  Icons.Plans({ size: 24 })
 */
(function () {
  const SW = 1.6;
  const A = `fill="none" stroke="currentColor" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"`;
  const wrap = (size, content, opts = {}) =>
    `<svg width="${size}" height="${size}" viewBox="${opts.viewBox || '0 0 24 24'}" ${opts.attrs || A} aria-hidden="true">${content}</svg>`;

  const Icons = {
    Plans: ({ size = 22 } = {}) => wrap(size, `
      <rect x="4" y="5" width="16" height="14" rx="2.5"/>
      <line x1="8" y1="9" x2="16" y2="9"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
      <line x1="8" y1="15" x2="13" y2="15"/>`),
    Library: ({ size = 22 } = {}) => wrap(size, `
      <rect x="3" y="9" width="3" height="6" rx="1"/>
      <rect x="18" y="9" width="3" height="6" rx="1"/>
      <line x1="6" y1="12" x2="18" y2="12"/>
      <line x1="8" y1="9" x2="8" y2="15"/>
      <line x1="16" y1="9" x2="16" y2="15"/>`),
    History: ({ size = 22 } = {}) => wrap(size, `
      <circle cx="12" cy="12" r="9"/>
      <polyline points="12 7 12 12 15.5 14"/>`),
    User: ({ size = 22 } = {}) => wrap(size, `
      <circle cx="12" cy="8.5" r="3.5"/>
      <path d="M5 20c1.5-3.5 4.5-5 7-5s5.5 1.5 7 5"/>`),
    Plus: ({ size = 22 } = {}) => wrap(size,
      `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`),
    Search: ({ size = 18 } = {}) => wrap(size,
      `<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="20" y2="20"/>`),
    Sun: ({ size = 18 } = {}) => wrap(size, `
      <circle cx="12" cy="12" r="4"/>
      <line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/>
      <line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/>
      <line x1="5.6" y1="5.6" x2="7" y2="7"/><line x1="17" y1="17" x2="18.4" y2="18.4"/>
      <line x1="5.6" y1="18.4" x2="7" y2="17"/><line x1="17" y1="7" x2="18.4" y2="5.6"/>`),
    Moon: ({ size = 18 } = {}) => wrap(size,
      `<path d="M20 14.5A8 8 0 1 1 9.5 4 a6.5 6.5 0 0 0 10.5 10.5z"/>`),
    Play: ({ size = 22 } = {}) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5 L18 12 L8 18.5 Z" fill="currentColor"/></svg>`,
    Pause: ({ size = 22 } = {}) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></svg>`,
    Skip: ({ size = 22 } = {}) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 5 L14 12 L5 19 Z"/><rect x="15.5" y="5" width="3" height="14" rx="0.5"/></svg>`,
    Prev: ({ size = 22 } = {}) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 5 L10 12 L19 19 Z"/><rect x="5.5" y="5" width="3" height="14" rx="0.5"/></svg>`,
    Stop: ({ size = 22 } = {}) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>`,
    X: ({ size = 22 } = {}) => wrap(size,
      `<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`),
    ChevronLeft: ({ size = 22 } = {}) => wrap(size, `<polyline points="14 6 8 12 14 18"/>`),
    ChevronRight: ({ size = 22 } = {}) => wrap(size, `<polyline points="10 6 16 12 10 18"/>`),
    Edit: ({ size = 18 } = {}) => wrap(size,
      `<path d="M14 5l5 5L9 20H4v-5z"/><path d="M14 5l3-3 5 5-3 3"/>`),
    Clock: ({ size = 14 } = {}) => wrap(size,
      `<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>`),
    Flame: ({ size = 14 } = {}) => wrap(size,
      `<path d="M12 21c-4 0-7-3-7-7 0-3.5 3-5.5 4-9 0 3 2 4 3 5 1.5 1.5 1-2 2-3 1 2 5 4 5 8 0 4-3 6-7 6z"/>`),
    Settings: ({ size = 18 } = {}) => wrap(size, `
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>`),
    LogOut: ({ size = 18 } = {}) => wrap(size, `
      <path d="M9 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>`),
    Check: ({ size = 18 } = {}) => wrap(size,
      `<polyline points="5 12 10 17 19 7"/>`),
    GripV: ({ size = 18 } = {}) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>`,
    Volume: ({ size = 18 } = {}) => wrap(size,
      `<polygon points="4 9 8 9 13 5 13 19 8 15 4 15"/><path d="M16 8c1.5 1 2.5 2.5 2.5 4s-1 3-2.5 4"/>`),
    Trash: ({ size = 18 } = {}) => wrap(size,
      `<polyline points="4 7 20 7"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>`),
    /* Logo "L10b — Pinch con ancore" (4 ancore + 2 archi che si incrociano). 32x32. */
    LogoD: ({ size = 28 } = {}) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M4 9 Q12 9 16 16 Q20 23 28 23" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>
        <path d="M4 23 Q12 23 16 16 Q20 9 28 9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>
        <circle cx="4" cy="9" r="2" fill="currentColor"/>
        <circle cx="28" cy="9" r="2" fill="currentColor"/>
        <circle cx="4" cy="23" r="2" fill="currentColor"/>
        <circle cx="28" cy="23" r="2" fill="currentColor"/>
      </svg>`,
  };

  /* Inietta SVG dentro un elemento (sostituisce eventuali bambini). */
  Icons.set = (el, name, opts) => {
    if (!el || !Icons[name]) return;
    el.innerHTML = Icons[name](opts || {});
  };

  /* Idrata gli elementi con [data-icon="Name"] presenti nel DOM. */
  Icons.hydrate = (root = document) => {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      const name = el.dataset.icon;
      if (Icons[name]) el.innerHTML = Icons[name]({
        size: parseInt(el.dataset.iconSize || '0', 10) || undefined,
      });
    });
  };

  window.Icons = Icons;
})();
