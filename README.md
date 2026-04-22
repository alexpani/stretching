# Stretching

PWA personale di stretching con libreria esercizi, routine componibili e **sessione guidata** full-screen (countdown, Wake Lock, beep, salvataggio).

Parte di un ecosistema self-hosted salute: espone in LAN `/api/external/*` read-only per permettere a `alexpani/health-tracker` di sincronizzare le sessioni come `HKWorkout` su Apple HealthKit.

**Live**: <https://stretching.activeproxy.it>

## Funzionalità

- **Libreria esercizi** — CRUD con immagini (resize server-side 1024 px), filtro per gruppo muscolare e livello, seed iniziale di 23 esercizi, 8 SVG placeholder per gruppo muscolare.
- **Routine componibili** — CRUD, drag-and-drop dei singoli item (SortableJS), durata-override per esercizio, riposi configurabili, duplicazione, seed di 3 routine d'esempio.
- **Sessione guidata** — overlay full-screen con immagine, countdown circolare SVG animato, label "Esercizio / Riposo", anteprima del prossimo. Pausa / Salta / Stop. Screen Wake Lock con re-acquire su `visibilitychange`. Beep Web Audio a 3-2-1 e al cambio esercizio. Salvataggio sessione completata o parziale.
- **Storico** — streak corrente, streak max, tempo totale 30 gg, heatmap mensile, grafico 7 giorni Chart.js, lista cronologica con delete.
- **API esterne read-only in LAN** — `GET /api/external/sessions|routines|exercises` senza auth, JSON pronto per costruire `HKWorkout`. Vedi [docs/EXTERNAL_API.md](docs/EXTERNAL_API.md).
- **PWA** — manifest, service worker scritto a mano con 4 bucket versionati, installabile su iPhone con icona e splash, funziona offline per shell + dati in cache.
- **Dark mode** coerente col resto dell'ecosistema.

## Stack

Node LTS + Express + SQLite (`sqlite` + `sqlite3` async) + `express-session` memory store + `multer` + `sharp` + PM2. Client: vanilla JS + HTML + CSS (nessun framework), mobile-first `max-width: 430px`. CDN: SortableJS + Chart.js. Deploy in LXC Proxmox dietro Nginx Proxy Manager.

Nessuna dipendenza fuori da questo set. Vedi [CLAUDE.md](CLAUDE.md) per il razionale.

## Quick start (locale)

Richiede Node 22+ (testato fino a 25.x).

```bash
git clone https://github.com/alexpani/stretching.git
cd stretching
npm install
cp .env.example .env
# modifica .env: SESSION_SECRET, ADMIN_USER, ADMIN_PASSWORD
node setup.js        # crea DB + seed esercizi + routine
node server.js
```

Apri <http://localhost:3100>, login con le credenziali di `.env`.

## Deploy in produzione

Sul container LXC Debian 12/13 o Ubuntu 22.04, come root:

```bash
git clone https://<user>:<pat>@github.com/alexpani/stretching.git /opt/stretching
sudo bash /opt/stretching/install.sh
```

Lo script chiede porta, utente admin, password; installa Node + PM2, crea utente di sistema `stretchapp`, inizializza DB, configura PM2 con restart automatico al boot, apre ufw.

Per aggiornamenti futuri:

```bash
sudo bash /opt/stretching/update.sh
```

Guida dettagliata (Nginx Proxy Manager, SSL Let's Encrypt, backup, rotazione GitHub PAT) in [docs/DEPLOY.md](docs/DEPLOY.md).

## Struttura repo

```
server.js                 # Entry Express
setup.js                  # Init DB + seed idempotente
database/db.js            # Singleton + migrazioni idempotenti
routes/{auth,exercises,routines,sessions,external}.js
services/images.js        # multer + sharp
public/
├── index.html            # Shell SPA unica
├── manifest.json, sw.js  # PWA
├── css/style.css         # Tema via CSS vars + dark mode
├── img/exercises/*.svg   # Placeholder fallback per gruppo muscolare
└── js/{app,library,routines,session,history}.js
docs/
├── REFERENCE_NOTES.md
├── EXTERNAL_API.md
├── HEALTH_TRACKER_INTEGRATION.md
└── DEPLOY.md
install.sh, update.sh, rotate-lxc-token.sh
CLAUDE.md                 # Convenzioni e gotcha (da leggere prima di contribuire)
```

## Schema dati (SQLite)

- `exercises` — UUID, nome, descrizione, `muscle_group`, `side`, `level`, `duration_sec`, `image_path`, `notes`, soft-delete.
- `routines` — UUID, nome, descrizione, soft-delete.
- `routine_items` — FK routine + FK esercizio, `position`, `duration_override_sec`, `rest_after_sec`.
- `sessions` — UUID, `routine_id` nullable + `routine_name` denormalizzato (sopravvive alla cancellazione della routine), `started_at`/`ended_at` ISO 8601 UTC, `duration_sec`, `items_total`, `items_skipped`.
- `settings` — key/value.

## Integrazione Apple HealthKit

Non direttamente: le sessioni vengono esposte via `/api/external/sessions` in LAN. Il backend `alexpani/health-tracker` le pullerà, enqueue in `pending_workouts`, e l'app iOS dell'ecosistema le salverà come `HKWorkout(.flexibility)`. Specifiche complete per il PR di integrazione in [docs/HEALTH_TRACKER_INTEGRATION.md](docs/HEALTH_TRACKER_INTEGRATION.md).

## Documentazione

- [CLAUDE.md](CLAUDE.md) — convenzioni, architettura, gotcha, troubleshooting rapido. Leggere prima di contribuire.
- [docs/REFERENCE_NOTES.md](docs/REFERENCE_NOTES.md) — analisi dei repo di riferimento (`diario-alimentare`, `health-tracker`) da cui derivano le scelte di questo progetto.
- [docs/EXTERNAL_API.md](docs/EXTERNAL_API.md) — contratto delle API esterne read-only.
- [docs/HEALTH_TRACKER_INTEGRATION.md](docs/HEALTH_TRACKER_INTEGRATION.md) — specifiche del PR futuro sul repo `alexpani/health-tracker`.
- [docs/DEPLOY.md](docs/DEPLOY.md) — installazione LXC, Nginx Proxy Manager, backup, rotazione PAT, troubleshooting produzione.

## Stato

Release 1.0 — in produzione su `https://stretching.activeproxy.it`. Tutte le milestone (M0–M10) chiuse. Single-user, non multi-tenant. Nessun build step: `node server.js` serve file e API dallo stesso processo.

## Disclaimer

Le indicazioni e gli esercizi mostrati dall'app **non sono consigli medici**. Questa è un'app personale; se hai patologie o dubbi sulla tua mobilità, consulta un professionista prima di eseguire gli esercizi.
