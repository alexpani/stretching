# CLAUDE.md — Stretching PWA

Guida per Claude quando lavora su questo progetto in conversazioni future. Convenzioni, architettura, gotcha, e come contribuire senza rompere le abitudini consolidate.

## Contesto

PWA personale di **stretching** single-user, deployata in LXC Proxmox casalingo. Fa parte di un ecosistema self-hosted salute composto da 3 repo:

| Repo | Ruolo |
|------|-------|
| `alexpani/stretching` (questo) | Libreria esercizi, routine, sessione guidata, storico. Espone `/api/external/*` in LAN. |
| `alexpani/diario-alimentare` | Diario nutrizionale. Pattern/stack che replichiamo qui. |
| `alexpani/health-tracker` | Hub centrale. Consuma le API esterne del diario e (in futuro) della stretching app. Gestisce sync HealthKit via app iOS. |

La stretching app è **passiva rispetto all'ecosistema**: espone dati in LAN ma non chiama nessuno. È il backend `health-tracker` che pulla e orchestra.

## Branch di lavoro

Lavora direttamente su **`main`**. Niente feature branch. Commit piccoli, frequenti, in italiano stile Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `ui:`, `chore:`). Il remote è `origin → github.com/alexpani/stretching`.

## Stack

| Item | Versione | Note |
|------|:--------:|------|
| Node | 25.x (Mac) / 22.x (LXC) | evitare `better-sqlite3` — non compatibile Node 25 |
| Express | 4.18.x | |
| DB | SQLite via `sqlite` + `sqlite3` (async wrapper) | **non** `better-sqlite3` |
| Session | `express-session` memory store, cookie `httpOnly`, 30 gg | |
| Auth | plaintext in `.env`, no bcrypt, no tabella users | coerente col diario |
| Upload | `multer` + `sharp` per immagini (lato lungo 1024px, JPEG 85%). Video accettati senza transcoding (limite 50 MB, estensione preservata: mp4/webm/mov/m4v/ogv) | |
| Client | vanilla JS + HTML + CSS, mobile-first max-width 430px | |
| Drag-drop | SortableJS via CDN | |
| Grafici | Chart.js 4.4.0 via CDN | |
| Audio | Web Audio API (oscillator + gain) | no file mp3 |
| Wake Lock | `navigator.wakeLock` (screen) con re-acquire su `visibilitychange` | |
| PWA | manifest + service worker a mano, 4 bucket versionati (`v2`) | |
| Process manager | PM2 | |

Nessuna dipendenza fuori da questo elenco senza motivo esplicito.

## Struttura progetto

```
stretching/
├── server.js                 # Entry Express (~60 righe)
├── setup.js                  # Init DB + seed esercizi/routine (idempotente)
├── database/
│   ├── db.js                 # Singleton + migrazioni idempotenti
│   └── stretching.sqlite     # (gitignored)
├── routes/
│   ├── auth.js               # isAuth middleware + /login /logout /api/me
│   ├── exercises.js          # CRUD + multipart upload
│   ├── routines.js           # CRUD + items + /reorder + /duplicate
│   ├── sessions.js           # POST sessioni completate (protetto)
│   └── external.js           # /api/external/* read-only no-auth LAN
├── services/
│   └── images.js             # multer + sharp + removeImage
├── public/
│   ├── index.html            # SPA shell unica
│   ├── exercises-table.html  # Foglio di lavoro esercizi (desktop, max-width 1680)
│   ├── manifest.json         # PWA (theme-color #15161A, icone 192/512/maskable)
│   ├── sw.js                 # Service worker (VERSION = 'vN', bump a ogni asset change)
│   ├── apple-touch-icon.png
│   ├── icons/                # 192, 512 (rese da img/brand/app-icon-source.svg)
│   ├── img/
│   │   ├── exercises/        # 1 default.svg + 8 gruppi muscolari (placeholder)
│   │   └── brand/            # logo-d.svg + app-icon-source.svg (sorgente PNG)
│   ├── css/
│   │   ├── tokens.css        # Design system v2: token + 12 palette + dark
│   │   ├── style.css         # Reset + componenti (no :root, vive su tokens.css)
│   │   └── exercises-table.css
│   └── js/
│       ├── icons.js          # Set SVG inline (porting icons.jsx) + Icons.hydrate()
│       ├── settings.js       # Palette grid + theme picker + session toggles + volume voce
│       ├── app.js            # apiFetch, auth, tab switching (4 tab), SW register + banner
│       ├── library.js        # Tab Esercizi + modal esercizio
│       ├── routines.js       # Tab Piani + dettaglio + SortableJS + picker (plan-card cover full)
│       ├── session.js        # Overlay sessione + countdown + Wake Lock + audio + done state
│       └── history.js        # Tab Storico + streak + heatmap + Chart.js
├── uploads/                  # immagini esercizi (gitignored)
├── docs/
│   ├── REFERENCE_NOTES.md    # analisi dei repo diario e health-tracker
│   ├── EXTERNAL_API.md       # contratto /api/external/* (stile diario)
│   ├── HEALTH_TRACKER_INTEGRATION.md  # specifiche PR futuro
│   └── DEPLOY.md             # guida LXC + NPM
├── install.sh                # Bootstrap LXC
├── update.sh                 # git pull + npm ci + pm2 restart
├── rotate-lxc-token.sh       # Rotazione GitHub PAT (dal Mac)
└── .env.example
```

File-size budget: **max ~300 righe**; splitta in moduli se cresce.

## Database

Schema (tutte le migrazioni idempotenti in `database/db.js`, applicate a ogni `getDb()`):

- `exercises`: id UUID, name, description, muscle_group (collo|spalle|schiena|core|gambe|anche|polpacci|braccia), side (both|dx|sx), level (easy|medium|hard), duration_sec, image_path, notes, soft-delete via `deleted_at`
- `routines`: id UUID, name, description, soft-delete
- `routine_items`: id, routine_id FK CASCADE, exercise_id, position, duration_override_sec, rest_after_sec; indice `(routine_id, position)`
- `sessions`: id UUID, routine_id nullable, routine_name denormalizzato, started_at/ended_at ISO 8601 UTC, duration_sec, items_total/skipped, notes; **hard-delete** (a differenza di exercises/routines)
- `settings`: chiave/valore

### Gotcha DB

- `PRAGMA foreign_keys = ON` va riapplicato a ogni connessione (SQLite default è OFF).
- `sqlite` async vuole parametri **spread**: `db.run(sql, a, b, c)` — NON array `[a, b, c]` (eccezione: `all`/`get` accettano entrambi).
- Migrazioni pattern: `PRAGMA table_info(x)` + `ALTER TABLE ADD COLUMN` condizionale, oppure `SELECT name FROM sqlite_master` + `CREATE TABLE IF NOT EXISTS`. **Mai cancellare blocchi vecchi**: il DB esistente se ne aspetta l'esecuzione.
- Soft-delete: `UPDATE SET deleted_at = datetime('now')`. Le query di dominio filtrano `WHERE deleted_at IS NULL`. Le immagini dei soft-deleted **non** vengono rimosse (solo su sostituzione esplicita).

## API

- `/api/*` tutti protetti da `isAuth` **eccetto** `/api/external/*` che è read-only no-auth (LAN only).
- Formato JSON UTF-8.
- Su 401 gli endpoint `/api/*` ritornano JSON, gli HTML redirigono a `/`.
- Timestamp sempre **ISO 8601 UTC** (`Z`). La conversione fuso locale avviene solo client-side quando serve (heatmap, streak).

## UI

- Container app `max-width: 430px` centrato (foglio di lavoro `max-width: 1680px`).
- **Design system v2** (Apr 2026): token in `public/css/tokens.css` (Apple Health-meets-Calm, Geist + Geist Mono via Google Fonts). Light + dark + **12 palette** accent selezionabili runtime via `[data-palette="..."]` su `<html>`. `style.css` non contiene più `:root`: vive sui token e mantiene alias retrocompat (`--color-primary` → `var(--accent)`, `--space-N` → `var(--s-N)`, `--text-*` → `var(--t-*)`, `--shadow-*` → `var(--sh-*)`).
- Palette ID disponibili: `indaco` (default), `salvia`, `terracotta`, `carbone`, `rosa`, `oliva`, `oceano`, `lavanda`, `ambra`, `muschio`, `corallo`, `notte`. Per aggiungerne una serve sia il blocco `[data-palette="X"]` (light + dark) in `tokens.css` sia l'entry in `PALETTES` in `settings.js`.
- Tema (`auto`|`light`|`dark`) persistito in `localStorage.st-theme`; palette in `localStorage.st-palette`. Default toggles sessione (Beep / Voice / Wake Lock / Voice Volume 0–100%) in `localStorage.st-session-opts`. **Boot apply** in `settings.js` (IIFE) prima del primo render per evitare FOUC.
- Tab bar a 4 voci: **Piani** (`routines`) · **Esercizi** (`library`) · **Storico** (`history`) · **Profilo** (`profile`, ospita Aspetto + Sessione + Esci).
- Touch target minimo 44px per input/button, 56-76px per i control di sessione.
- Disclaimer medico **rimosso** dalla shell e dal login (Apr 2026, scelta utente). Non reintrodurlo senza una nuova decisione esplicita.

### Gotcha UI

- **Chart.js**: sempre in un wrapper con altezza fissa (`height: 180px`), altrimenti con `maintainAspectRatio: false` si espande all'infinito in loop di resize.
- **Safe area iPhone**: la sessione overlay usa `100dvh` + `env(safe-area-inset-*)`. Tutto scrollabile dentro `.session-inner`. Il FAB include `env(safe-area-inset-bottom)` nel `bottom:` calc, altrimenti su iOS PWA finisce sotto la tabbar.
- **Text-size-adjust + viewport**: iOS PWA standalone scala il testo se non blocchi `-webkit-text-size-adjust: 100%` in CSS e `maximum-scale=1` nel meta viewport.
- **Service Worker update**: bump `VERSION` in `sw.js` a ogni release di asset/shell. Il client mostra banner "Nuova versione" + `SKIP_WAITING` + reload automatico via `controllerchange`. Stato attuale: `v25`.
- **Pagine extra**: ogni HTML standalone (es. `exercises-table.html`) deve linkare `tokens.css` PRIMA di `style.css`, altrimenti gli alias legacy (`--color-*`, `--space-N` ecc.) sono indefiniti e il layout collassa.
- **Icone**: SVG inline via `Icons.hydrate()` su nodi `<span data-icon="Name" data-icon-size="22">`. Idratazione una volta su `DOMContentLoaded`; per nodi creati dinamicamente, chiamare `Icons.hydrate(parentEl)`.
- **Overlay descrizione (sessione)**: `.ss-desc` è dentro `.session-image`, mostrato al tap. Background `rgba(15,16,20,0.45)` + `backdrop-filter: blur(12px)` lascia la foto visibile dietro. Su iOS reso correttamente solo con `border-radius` esplicito (non `inherit`).

## Sessione guidata (core)

Il cuore dell'app è `public/js/session.js`. Non toccarlo senza aver capito:

- **Fasi**: una routine viene trasformata in sequenza `[exercise, rest, exercise, rest, ..., exercise]` (nessun riposo dopo l'ultimo).
- **Timer**: `requestAnimationFrame` loop con `pausedAccumMs` per isolare il tempo di pausa.
- **Countdown SVG**: `stroke-dasharray = 2πr`, animato via `stroke-dashoffset = C * progress`. Rotazione `-90°` per partire dalle ore 12.
- **Wake Lock**: richiesto al start/resume, rilasciato al pause/stop, ri-richiesto su `visibilitychange → visible`. iOS 16.4+, Safari < 16.4 degrada silenziosamente.
- **Web Audio**: `AudioContext` creato al primo tap del bottone Avvia (requisito user-gesture). Beep sinusoide con busta ADSR (attack 10ms, decay exp).
- **Default sessione globali**: i toggle Beep / Voice / Wake Lock e il volume voce vivono in `localStorage.st-session-opts` (gestiti dal Profilo). Il flag `routine.voice_guide` per piano ha priorità se valorizzato; altrimenti vince il default globale.
- **Done state**: schermata riepilogo con medaglia 96px + halo (`color-mix(in srgb, var(--accent) 12%, transparent)`), eyebrow "SESSIONE COMPLETATA", H1 "Bel lavoro.", stat trio (durata `m:ss`, esercizi, saltati). CTA "Fatto" salva la sessione.
- **Salvataggio**: Stop/fine-naturale vanno entrambi alla schermata riepilogo. Bottone "Fatto" fa `POST /api/sessions` con ISO UTC + duration calcolata da `performance.now()`.

## PWA

- `sw.js` con 4 bucket versionati: `st-shell`, `st-runtime`, `st-api`, `st-uploads`.
- Strategie: navigazioni HTML → network-first fallback shell; API whitelist (`/api/me`, `/api/exercises`, `/api/routines`, `/api/sessions` solo GET) → network-first + cache fallback; uploads e asset same-origin → stale-while-revalidate; CDN → network-first + cache fallback.
- API write (`POST/PUT/DELETE`) e `/api/external/*` **non** passano dal SW.
- CDN precachati con `mode: 'no-cors'` (response opache, ok per `cache.put`).

## Deploy produzione

- LXC Debian 13 @ `192.168.68.150`, utente `stretchapp`, porta `3100`.
- Reverse proxy Nginx Proxy Manager su dominio `https://stretching.activeproxy.it`.
- NPM config: scheme **http** (l'app non fa TLS), Force SSL on, HSTS on, HTTP/2 on.
- `pm2 start ecosystem.config.js` come `stretchapp`, `pm2 startup systemd` per restart al boot.
- Aggiornamenti: `git push` → `ssh root@192.168.68.150 bash /opt/stretching/update.sh`.
- Rotazione PAT: `LXC_HOST=root@192.168.68.150 bash rotate-lxc-token.sh` dal Mac.

## Integrazione health-tracker

**Non in questo repo**. Specifiche del PR futuro (backend FastAPI + dashboard React) in [docs/HEALTH_TRACKER_INTEGRATION.md](docs/HEALTH_TRACKER_INTEGRATION.md).

Punti fermi:

- La write queue del backend health-tracker accetta solo `HKQuantityTypeIdentifier*` — **HKWorkout no**. Serve passare per `pending_workouts`.
- iOS HealthKit già gestisce `HKWorkout`. Serve solo il backend che enqueue.
- Nessuna modifica a questa stretching app prevista — tutto il lavoro è sul repo health-tracker.

## Backup

Due path da salvare:

```
/opt/stretching/database/stretching.sqlite
/opt/stretching/uploads/
```

Esempio rsync in `docs/DEPLOY.md`.

## Release 1.0 — stato

Tutte le milestone chiuse (M0–M10). L'app è in produzione stabile. Le modifiche future dovrebbero:

1. Restare nello scope single-user (no multi-tenant, no Oauth).
2. Preservare il pattern "SQLite idempotent migrations".
3. Non introdurre framework client (continuare vanilla JS).
4. Non aggiungere dipendenze senza motivo dichiarato.
5. ~~Mantenere il disclaimer medico visibile~~ — rimosso ad Apr 2026 (scelta utente).

## Troubleshooting rapido

| Sintomo | Causa tipica | Fix |
|---------|--------------|-----|
| Login KO dopo install.sh | credenziali in `.env` diverse | `sudo nano /opt/stretching/.env && pm2 restart stretching` |
| 502 Bad Gateway dopo NPM save | "Scheme" tornato a https | Edit Proxy Host → Details → Scheme = http |
| Grafico storico cresce infinito | wrapper senza altezza fissa + `maintainAspectRatio: false` | assicurati `.chart-wrap { height: 180px }` |
| Layout iOS oversize in PWA | manca `text-size-adjust: 100%` o `maximum-scale=1` | verifica CSS body e meta viewport |
| SW non aggiorna | `VERSION` in `sw.js` non bumpato | incrementa VERSION, commit, deploy |
| Sessione perde Wake Lock | tab minimizzata e riaperta | verificato: `visibilitychange → visible` lo ri-acquisisce |
| Sharp errore su LXC dopo update | rebuild nativo | `cd /opt/stretching && su stretchapp -c "npm rebuild sharp"` |
