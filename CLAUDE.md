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
| Upload | `multer` + `sharp` (resize lato lungo 1024px, JPEG 85%) | |
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
│   ├── manifest.json         # PWA
│   ├── sw.js                 # Service worker (VERSION = 'vN')
│   ├── apple-touch-icon.png
│   ├── icons/                # 192, 512
│   ├── img/exercises/        # 1 default.svg + 8 gruppi muscolari
│   ├── css/style.css         # CSS vars + dark mode + 430px
│   └── js/
│       ├── app.js            # apiFetch, auth, tab switching, SW register + banner
│       ├── library.js        # Tab libreria + modal esercizio
│       ├── routines.js       # Tab routine + dettaglio + SortableJS + picker
│       ├── session.js        # Overlay sessione + countdown + Wake Lock + audio + save
│       └── history.js        # Tab storico + streak + heatmap + Chart.js
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

- Container app `max-width: 430px` centrato.
- Tutto in CSS vars (`--color-*`, `--space-*`, `--radius-*`, `--text-*`); dark mode tramite `[data-theme="dark"]` su `<html>`. Il tema segue il sistema di default, persistito in `localStorage.st-theme`.
- Touch target minimo 44px per input/button, 56-76px per i control di sessione.
- Il disclaimer "Le indicazioni fornite non sono consigli medici" è visibile in fondo alla shell sempre.

### Gotcha UI

- **Chart.js**: sempre in un wrapper con altezza fissa (`height: 180px`), altrimenti con `maintainAspectRatio: false` si espande all'infinito in loop di resize.
- **Safe area iPhone**: la sessione overlay usa `100dvh` + `env(safe-area-inset-*)`. Tutto scrollabile dentro `.session-inner`.
- **Text-size-adjust + viewport**: iOS PWA standalone scala il testo se non blocchi `-webkit-text-size-adjust: 100%` in CSS e `maximum-scale=1` nel meta viewport.
- **Service Worker update**: bump `VERSION` in `sw.js` a ogni release di asset/shell. Il client mostra banner "Nuova versione" + `SKIP_WAITING` + reload automatico via `controllerchange`.

## Sessione guidata (core)

Il cuore dell'app è `public/js/session.js`. Non toccarlo senza aver capito:

- **Fasi**: una routine viene trasformata in sequenza `[exercise, rest, exercise, rest, ..., exercise]` (nessun riposo dopo l'ultimo).
- **Timer**: `requestAnimationFrame` loop con `pausedAccumMs` per isolare il tempo di pausa.
- **Countdown SVG**: `stroke-dasharray = 2πr`, animato via `stroke-dashoffset = C * progress`. Rotazione `-90°` per partire dalle ore 12.
- **Wake Lock**: richiesto al start/resume, rilasciato al pause/stop, ri-richiesto su `visibilitychange → visible`. iOS 16.4+, Safari < 16.4 degrada silenziosamente.
- **Web Audio**: `AudioContext` creato al primo tap del bottone Avvia (requisito user-gesture). Beep sinusoide con busta ADSR (attack 10ms, decay exp).
- **Salvataggio**: Stop/fine-naturale vanno entrambi alla schermata riepilogo. Bottone "Salva" fa `POST /api/sessions` con ISO UTC + duration calcolata da `performance.now()`.

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
5. Mantenere il disclaimer medico visibile.

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
