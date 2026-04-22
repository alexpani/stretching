# REFERENCE_NOTES — convenzioni da clonare dai repo di riferimento

Questo documento raccoglie, con citazioni puntuali, i pattern che la PWA stretching deve replicare dal progetto `alexpani/diario-alimentare` e i punti di integrazione con `alexpani/health-tracker`.

I path sotto sono relativi al checkout locale:

- **diario**: `/Users/alessandro/Claude Code/food diary/` (repo `alexpani/diario-alimentare`)
- **health-tracker**: `/Users/alessandro/Claude Code/ealth-tracker/` (repo `alexpani/health-tracker`)

---

## 1. Stack e versioni (diario)

Da `food diary/package.json`:

| Dipendenza | Versione | Note |
|---|---|---|
| `express` | `^4.18.3` | HTTP framework |
| `express-session` | `^1.18.0` | Sessioni, **memory store** (no store esterno) |
| `sqlite` | `^5.1.1` | Wrapper async/await su sqlite3 |
| `sqlite3` | `^6.0.1` | Driver nativo SQLite |
| `multer` | `^1.4.5-lts.1` | Upload file |
| `sharp` | `^0.34.5` | Resize immagini |
| `dotenv` | `^16.4.5` | Caricamento `.env` |
| `node-fetch` | `^3.3.2` | Fetch server-side (proxy esterno) |
| `@anthropic-ai/sdk` | `^0.80.0` | **Non replicare** — IA vision, fuori scope stretching |
| `@google/generative-ai` | `^0.24.1` | **Non replicare** — idem |

Niente dev dependencies, niente bundler, niente framework client.

**Node**: Node 22+ in install.sh; sul Mac locale gira su **25.5.0**. `better-sqlite3` è **evitato** perché incompatibile con Node 25 — il diario usa intenzionalmente `sqlite` + `sqlite3` async.

**Scelta per stretching**: **identica**. Solo le dep che servono (no SDK IA, no node-fetch finché non serve).

---

## 2. Struttura directory (diario)

```
food diary/
├── server.js                 # Entry Express, 57 righe
├── setup.js                  # Init DB (una tantum)
├── database/
│   ├── db.js                 # Singleton + migrazioni idempotenti
│   └── food_diary.sqlite     # gitignored
├── routes/
│   ├── auth.js               # login/logout + isAuth middleware
│   ├── diary.js              # /api/diary/*
│   ├── foods.js              # /api/foods/* (multipart upload)
│   ├── plan.js               # /api/plan, /api/plans/*
│   ├── settings.js           # /api/settings/*  (anche password)
│   └── external.js           # /api/external/* read-only no-auth
├── services/
│   └── vision.js             # astrazione IA (non ci serve)
├── public/
│   ├── index.html            # SPA shell unica
│   ├── manifest.json         # PWA
│   ├── sw.js                 # service worker a mano
│   ├── apple-touch-icon.png
│   ├── icons/{192,512}.png
│   ├── img/{logo.png,meals/*.svg}
│   ├── css/style.css
│   └── js/{app,diary,diarylog,foods,plan,settings,barcode,scanner-config}.js
├── uploads/                  # gitignored
├── docs/EXTERNAL_API.md
├── install.sh
├── update.sh
├── rotate-lxc-token.sh
├── CLAUDE.md
├── README.md
├── logo.png
├── .env                      # gitignored
├── .env.example              # (non presente nel diario — noi lo aggiungiamo)
└── .gitignore
```

**Scelta per stretching**: clonare l'albero 1:1, rinominando i file specifici (`diary.js → session.js`, `foods.js → exercises.js`, `plan.js → routines.js`, ecc.).

---

## 3. `server.js` — ordine middleware e mount

Da `food diary/server.js:1-57`:

```js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);                          // dietro NPM

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'food-diary-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',  // true in prod (HTTPS)
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000                // 30 giorni
  }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/', authRoutes);
app.use('/api/diary', diaryRoutes);
app.use('/api/foods', foodsRoutes);
app.use('/api/plan', planRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/external', externalRoutes);

// SPA fallback: tutto ciò che non è /api/ → index.html
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.listen(PORT, ...);
```

**Punti chiave**:

1. `trust proxy`=1 perché l'app sta dietro Nginx Proxy Manager (serve per cookie `secure` + IP client giusto).
2. Session cookie `httpOnly`, durata **30 gg**, `secure` solo in produzione.
3. Nessun CORS configurato — è un'app single-origin.
4. Fallback SPA: 404 JSON per `/api/*`, `index.html` per tutto il resto.

**Scelta per stretching**: stesso pattern, porta `3100` (evita collisione col diario se giri entrambi in locale). Router: `/api/auth` (niente mount su `/`? vedi sotto), `/api/exercises`, `/api/routines`, `/api/sessions`, `/api/settings`, `/api/external`.

> **Divergenza da valutare a M2**: il diario monta `authRoutes` su `/` perché espone `/login`, `/logout`, `/api/me`. Noi possiamo fare uguale (più breve) o usare `/api/auth/login` per uniformità. Propongo **uguale al diario** per minimizzare sorprese.

---

## 4. `database/db.js` — singleton + migrazioni idempotenti

Pattern da `food diary/database/db.js:1-125`:

```js
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = path.join(__dirname, 'food_diary.sqlite');
let _db = null;

async function getDb() {
  if (!_db) {
    _db = await open({ filename: DB_PATH, driver: sqlite3.Database });
    await _db.run('PRAGMA foreign_keys = ON');

    // Pattern migrazione: ispeziona schema, aggiungi se manca
    const cols = await _db.all("PRAGMA table_info(foods)");
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('deleted_at'))
      await _db.run("ALTER TABLE foods ADD COLUMN deleted_at TEXT");
    // ...altre ALTER TABLE...

    // Nuove tabelle:
    const tables = (await _db.all(
      "SELECT name FROM sqlite_master WHERE type='table'"
    )).map(t => t.name);
    if (!tables.includes('plans')) {
      await _db.run(`CREATE TABLE plans (...)`);
    }
  }
  return _db;
}

module.exports = { getDb };
```

**Punti chiave**:

1. `let _db = null` al modulo → singleton per-processo.
2. `PRAGMA foreign_keys = ON` deve essere ripetuto ogni connessione (SQLite non lo ricorda).
3. Migrazioni **idempotenti**: `PRAGMA table_info(x)` per le colonne, `SELECT name FROM sqlite_master` per le tabelle, `ALTER TABLE ... IF NOT EXISTS` quando possibile.
4. **Niente versioning migrazioni esplicito** (no `schema_version`): ogni check è autodescrittivo. Basta non cancellare mai i blocchi vecchi.
5. Le migrazioni girano alla **prima chiamata** di `getDb()` nel processo, non a ogni request.

**Scelta per stretching**: stesso pattern. Tabelle `exercises`, `routines`, `routine_items`, `sessions`, `settings` (vedi schema nel plan).

**Gotcha documentato in CLAUDE.md del diario**: con `sqlite` async **i parametri sono passati spread**, non come array: `db.run(sql, a, b, c)` non `db.run(sql, [a, b, c])`. Fa eccezione `db.all`/`db.get` che accettano entrambi.

---

## 5. `setup.js` — init una-tantum

Da `food diary/setup.js:1-91`:

- Crea `database/` e `uploads/`.
- Apre DB e crea tabelle con `CREATE TABLE IF NOT EXISTS`.
- Crea indici (`idx_diary_date`, `idx_foods_name`, `idx_foods_barcode`).
- Seed piano default se non esiste.
- **Output istruttivo**: stampa il contenuto consigliato del `.env` e i comandi successivi.

**Scelta per stretching**: stesso stile. Seed ~20 esercizi + 3 routine d'esempio (i seed saranno aggiunti a M3/M4, non già a M1).

---

## 6. Auth — `routes/auth.js`

Da `food diary/routes/auth.js:1-42`:

```js
function isAuth(req, res, next) {
  if (process.env.AUTH_ENABLED === 'false') return next();   // bypass dev
  if (req.session && req.session.authenticated) return next();
  if (req.xhr || req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  res.redirect('/');
}

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || 'admin';
  const validPass = process.env.ADMIN_PASSWORD || 'password123';
  if (username === validUser && password === validPass) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Credenziali non valide' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/api/me', isAuth, (req, res) => {
  res.json({ username: req.session.username });
});

module.exports = router;
module.exports.isAuth = isAuth;
```

**Punti chiave**:

1. Credenziali **plaintext** in `.env` (single-user homelab). Niente bcrypt, niente tabella `users`.
2. `AUTH_ENABLED=false` bypassa tutto per dev.
3. `isAuth` distingue risposta per API (401 JSON) vs HTML (redirect).
4. Sessione `authenticated = true` + `username` in sessione per `/api/me`.
5. `isAuth` è esportato come property su `module.exports`, così gli altri router lo importano con `const { isAuth } = require('./auth')`.

**Cambio password** (non in `auth.js`, cercare in `routes/settings.js`): riscrive `.env` e distrugge la sessione corrente → force logout. Pattern: `PUT /api/settings/password { old, new }`.

**Scelta per stretching**: identica. `ADMIN_USER` / `ADMIN_PASSWORD` in `.env`. Disclaimer in `.env.example`.

---

## 7. Upload immagini (da `routes/foods.js`)

Pattern multer + sharp:

```js
const multer = require('multer');
const sharp = require('sharp');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `food-tmp-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },                        // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo immagini'));
  }
});

// Dentro l'handler POST:
const outPath = `uploads/food-${id}.jpg`;
await sharp(req.file.path)
  .resize(192, 192, { fit: 'cover' })
  .jpeg({ quality: 85 })
  .toFile(outPath);
fs.unlinkSync(req.file.path);                                   // tmp
```

**Scelta per stretching**: stesso pattern ma con resize **lato lungo 1024px** (per gli esercizi è utile la risoluzione):

```js
await sharp(req.file.path)
  .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toFile(outPath);
```

Naming `stretch-{id}.jpg`.

---

## 8. PWA

### `public/manifest.json` (diario, 13 righe)

```json
{
  "name": "FoodDiary",
  "short_name": "FoodDiary",
  "description": "Il tuo diario alimentare personale",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F5F5F5",
  "theme_color": "#4CAF50",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**Per stretching**: colori da definire (propongo verde-azzurro `#2DB6A8` per differenziarla visivamente).

### `public/sw.js` (diario) — 4 bucket versionati

Da `food diary/public/sw.js:1-60`:

```js
const VERSION = 'v21';
const SHELL_CACHE    = `fd-shell-${VERSION}`;
const RUNTIME_CACHE  = `fd-runtime-${VERSION}`;
const API_CACHE      = `fd-api-${VERSION}`;
const UPLOADS_CACHE  = `fd-uploads-${VERSION}`;

const SHELL_ASSETS = [
  '/', '/index.html', '/manifest.json',
  '/apple-touch-icon.png',
  '/icons/icon-192.png', '/icons/icon-512.png',
  '/img/logo.png',
  '/img/meals/colazione.svg', /* ... */
];

// CDN cross-origin da precachare con mode: 'no-cors' (opaque response)
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/cropperjs@1.6.1/dist/cropper.min.css',
  'https://cdn.jsdelivr.net/npm/cropperjs@1.6.1/dist/cropper.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:...',
];
```

**Strategie per url** (dichiarate in testa al file):

- **Navigazioni HTML**: network-first, fallback shell in cache.
- `GET /api/*` whitelist (diary, plan, range): **stale-while-revalidate** per lettura offline.
- Altre `/api/*`, `/uploads/*`: network-only.
- Asset same-origin: stale-while-revalidate.
- CDN cross-origin: network-first con fallback cache.

**Update UX**: niente `skipWaiting()` automatico. Il SW entra in `waiting`; il client (in `app.js`) mostra banner "Nuova versione", su click `postMessage({type:'SKIP_WAITING'})` → SW `self.skipWaiting()` + reload pagina.

**Chart.js caricato da CDN** (non da npm): `chart.js@4.4.0` via jsdelivr. Per coerenza la stretching app farà lo stesso (CDN + SRI, precache tra `CDN_ASSETS`).

**Scelta per stretching**:

- Bucket: `st-shell`, `st-runtime`, `st-api`, `st-uploads`.
- `VERSION = 'v1'`, incrementare a ogni cambio shell.
- Whitelist API: `/api/exercises`, `/api/routines`, `/api/sessions` (GET lista/dettaglio).
- CDN assets: Chart.js + SortableJS (stesso pattern `no-cors` precache).
- Stesso update banner con `SKIP_WAITING`.

---

## 9. Client vanilla JS — `public/js/app.js`

Pattern fetch wrapper (semplificato, dal diario):

```js
async function apiFetch(url, options = {}) {
  options.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  options.credentials = 'same-origin';
  const res = await fetch(url, options);
  if (res.status === 401) {
    localStorage.removeItem('fd-auth-ok');
    showLogin();
    throw new Error('unauthenticated');
  }
  return res;
}
const apiGet    = (url)         => apiFetch(url).then(r => r.json());
const apiPost   = (url, body)   => apiFetch(url, { method: 'POST',   body: JSON.stringify(body) }).then(r => r.json());
const apiPut    = (url, body)   => apiFetch(url, { method: 'PUT',    body: JSON.stringify(body) }).then(r => r.json());
const apiPatch  = (url, body)   => apiFetch(url, { method: 'PATCH',  body: JSON.stringify(body) }).then(r => r.json());
const apiDelete = (url)         => apiFetch(url, { method: 'DELETE' }).then(r => r.json());
```

Utility presenti:

- `fmt(n, decimals=1)` numeri.
- `formatDate(dateStr)` → "OGGI, 22 apr" / "IERI" / "lunedì, 22 apr".
- `todayStr()` → `YYYY-MM-DD`.
- `shiftDate(dateStr, days)`.
- `showMsg(el, text, type)` feedback temporaneo.
- `showConfirm(title, message)` → Promise<bool>.

Tab switching con classi `.active`.

**Scelta per stretching**: clonare l'intero blocco utility + fetch. Ripropongo anche `formatDate` invariato (funziona già per noi).

---

## 10. CSS — `public/css/style.css`

- `max-width: 430px` sulla root dell'app.
- CSS vars per tema: `--color-primary`, `--color-bg`, `--color-card`, `--color-text`, `--color-text-secondary`, `--color-border`, `--color-danger`, `--color-warning`, `--color-success-bg`.
- Scala spacing base 4px (`--space-1..--space-10`).
- Radius `--radius-xs..--radius-full`.
- Font stack Inter + system.
- Dark mode via `[data-theme="dark"]` su `<html>`.
- Palette WCAG AA.

**Scelta per stretching**: copiare il blocco `:root` + `[data-theme="dark"]` 1:1, modificando solo `--color-primary` / `--color-primary-dark` / `--color-primary-surface` per differenziare (proposta: verde-azzurro `#2DB6A8` / `#1E7F75` / `#80CFC4`).

---

## 11. docs/EXTERNAL_API.md — stile da replicare

Struttura usata nel diario (`food diary/docs/EXTERNAL_API.md`):

1. **Titolo** + 1 paragrafo scopo (read-only, consumo da app terze).
2. Tabella **Caratteristiche generali** (Base URL dev/prod, prefisso, auth, formato, metodi, CORS).
3. ⚠️ Avviso "non esporre su internet".
4. Sezione **Endpoint**. Per ciascuno:
   - path + verbo in header
   - 1-2 righe di scopo
   - **Query parameters** (tabella)
   - **Response 200 OK** (JSON di esempio)
   - **Campi** (tabella)
   - **Errori** (tabella)
   - Esempio `curl`
5. **Pattern di consumo tipico** (scenario concreto, es. Health Tracker).
6. Esempio **Node.js (fetch)**.
7. Esempio **Python (requests)**.
8. **Versioning e stabilità**.
9. **Implementazione**: link a `routes/external.js` e `server.js`.

**Scelta per stretching**: replicare esattamente questa scaletta a M7 con 4 endpoint:

- `GET /api/external/sessions?from&to`
- `GET /api/external/sessions/:id`
- `GET /api/external/routines`
- `GET /api/external/exercises`

Base URL prod LAN: `http://<stretching-lxc>:3100` (IP da assegnare).

---

## 12. Deploy — `install.sh` / `update.sh` / `rotate-lxc-token.sh`

Dal diario:

- **`install.sh`**: bootstrap LXC. Chiede porta, utente admin, password, `SESSION_SECRET`. Installa Node, PM2, crea user `fooddiary`, clona repo, `npm ci`, genera `.env` chmod 600, `node setup.js`, scrive `ecosystem.config.js`, `pm2 start` + `pm2 startup` + `pm2 save`, apre ufw.

- **`update.sh`** (da `food diary/update.sh:1-40`):
  ```bash
  APP_DIR="/opt/diario-alimentare"
  APP_USER="fooddiary"
  [[ $EUID -eq 0 ]] || die "Esegui come root: sudo bash update.sh"
  su - "$APP_USER" -c "git -C '$APP_DIR' pull --ff-only"
  su - "$APP_USER" -c "npm ci --prefix '$APP_DIR' --omit=dev --silent"
  su - "$APP_USER" -c "pm2 restart food-diary"
  ```

- **`rotate-lxc-token.sh`**: sul Mac, legge nuovo PAT da stdin senza eco, lo passa via SSH all'LXC, aggiorna `git remote set-url` **senza** mai esporre il token in argv/history. Compat bash 3.2 per macOS (confermato nel commit `c4b8f44 fix: compatibilità bash 3.2 (macOS) in rotate-lxc-token.sh`).

**Scelta per stretching**:

- `APP_DIR="/opt/stretching"`, `APP_USER="stretchapp"`, PM2 app name `stretching`, porta `3100`.
- Clonare i 3 script 1:1, sed sulle variabili.

---

## 13. Stile commit (diario, ultimi 20)

```
2bdd346 fix: calendario Home non si apriva dopo aggiunta Cal.pick()
80cf626 fix: media 7 giorni esclude il giorno corrente
eb053a1 feat: card 'Media 7 giorni' nel tab Diario
f5778a1 docs: cambia giorno/pasto nella modale di modifica voce diario
7a6b19d fix: calendar picker usabile su iOS, bottone stilizzato, giorni futuri
5b55a3e feat: cambia giorno via calendario nella modale modifica voce
ab74b09 docs: API esterne per Health Tracker
b0d57ec feat: API esterne read-only per Health Tracker
0c7d9f8 fix: limite token per escludere prodotti composti dal match locale
3c7c0e6 fix: priorità APP/CREA su OpenFoodFacts nel matching locale
c4b8f44 fix: compatibilità bash 3.2 (macOS) in rotate-lxc-token.sh
```

**Regole**:

- Lingua **italiana**.
- Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `ui:`, `chore:`.
- Subject imperativo, descrittivo del **cosa**, con contesto (nome componente / tab / area).
- Max una riga breve. Niente body salvo eccezioni.
- Co-author di Claude **sì, ma solo se l'utente lo chiede esplicitamente** (nel diario i commit di Claude hanno `Co-Authored-By: Claude <...>`, ma vanno contestualizzati).

**Esempi attesi per stretching**:

- `feat: scaffold progetto con Express + sqlite`
- `feat: sessione guidata con countdown SVG e Wake Lock`
- `fix: re-acquire Wake Lock su visibilitychange`
- `docs: API esterne stretching per Health Tracker`

---

## 14. Integrazione `health-tracker` — punti fermi

Dal repo `ealth-tracker/`:

### Backend FastAPI — write queue

- `backend/app/routers/write.py:14-31` contiene la whitelist **`ALLOWED_WRITE_TYPES`** che accetta **solo `HKQuantityTypeIdentifier*`** (peso, energia, macro, ecc.).
- **`HKWorkout` e `HKCategoryType` NON passano dalla write queue**. L'endpoint `POST /api/v1/write` rifiuta tipi fuori whitelist (`write.py:36-40`).
- Schema `WriteIn` (backend/app/schemas.py): `{ type, value, unit, start_date, end_date, source_name, notes }` — incompatibile con workout composti.

### HKWorkout — gestione iOS

- Il path è diverso: **`POST /api/v1/workouts/batch`** (non la write queue). Gestito da `ios/HealthTracker/APIClient.swift` + `HealthKitManager.swift:669-703`.
- `HealthKitManager` già supporta `HKWorkout` con `activityType`, `duration`, `energyBurned`, `distance`, `startDate`, `endDate`, metadata, `activities` (iOS 17+ `HKWorkoutActivity`).
- **Implicazione**: per sincronizzare le sessioni stretching come `HKWorkout` su HealthKit, il lavoro grosso è già fatto lato iOS. Lato backend serve **solo un mittente** che inserisca `PendingWorkout` o usi un path analogo.

### Tabella `diario_hk_sync` (pattern di tracking)

- In `ealth-tracker/backend/app/models.py:178-203`:
  - Colonne: `id, date, type, value, hk_uuid, pending_write_id (FK→pending_writes.id), posted_at, updated_at`.
  - `UniqueConstraint(date, type)` → dedup.
- Logica **delete+recreate idempotente** in `backend/app/routers/diario.py:78-188`:
  - Fetch daily totals da `http://192.168.68.173:3000/api/external/daily-totals` via `httpx.AsyncClient` timeout 10s.
  - Per ogni `(date, type)`:
    - Confronta con tracked.value (**tolleranza 0.5**).
    - Se diverso → enqueue `PendingDeletion(old hk_uuid)` + `PendingWrite(new value)`, reset `hk_uuid=NULL`, link nuovo `pending_write_id`.
    - Se entro tolleranza → skip.
  - Commit atomico al termine (`diario.py:181`).

### Dashboard React

- Stack: React 18 + Vite + TS + Tailwind + shadcn/ui + Recharts + TanStack Query 5.
- Pagina Nutrizione (`dashboard/src/pages/Nutrition.tsx`): usa hook `useDiarioDailyTotals`, `useDiarioSyncToHK` (in `dashboard/src/lib/queries.ts`).
- Bottone "Sincronizza con Apple Salute" → `useDiarioSyncToHK().mutate()` → `POST /api/v1/diario/sync-to-hk`.
- Sidebar (`dashboard/src/components/Sidebar.tsx:18-31`) ha 12 voci — per aggiungere "Stretching" basta appendere.

### Flusso end-to-end

```
[stretching PWA]
   └─ GET /api/external/sessions (read-only, LAN)
        ↓
[health-tracker backend FastAPI]
   └─ POST /api/v1/stretching/sync-to-hk  (da creare)
        ↓ (diff vs stretching_hk_sync)
        ↓ enqueue in `pending_workouts` (tabella da creare, analoga a pending_writes)
[iOS HealthTracker app]
   └─ SyncService → processPendingWorkouts → HKHealthStore.save(HKWorkout)
        ↓ POST /confirm(uuid) → backend
[backend]
   └─ aggiorna stretching_hk_sync.hk_uuid + posted_at
```

### Domande aperte sull'integrazione (da chiarire a M10)

1. **Esiste già una tabella `pending_workouts`** nel backend health-tracker, o va creata? Cercare in `backend/app/models.py` e `alembic/versions/` — la migration `871fe89fe31f_workout_activities.py` suggerisce che i workout sono già modellati, ma il flusso "enqueue server→iOS" per workout non è ancora implementato.
2. **Endpoint di conferma** (`/confirm`, `/fail`) per i workout: esistono? Se sì, riusarli; altrimenti creare `/api/v1/workouts/{id}/confirm`.
3. **Activity type**: `HKWorkoutActivityType.flexibility` (65) vs `.preparationAndRecovery` (65) vs `.mindAndBody` (13). Propongo **`.flexibility`** come primario; la UI stretching potrebbe permettere override in futuro.
4. **Energia stimata**: HealthKit richiede `totalEnergyBurned` opzionale. Per lo stretching possiamo stimarlo grezzo: `duration_min × 2 kcal/min ≈ 2 kcal/min` (MET ~2.3 per stretching leggero). Lasciare `null` e far stimare da HealthKit (iOS lo fa se null).
5. **Granularità sessione**: una session = un HKWorkout con `activities` opzionali (uno per esercizio) o un solo workout monolitico? iOS 17+ supporta `HKWorkoutActivity` per split → meglio sfruttarlo, così vedo anche lo split per esercizio in Salute.

Queste 5 domande vanno nel `docs/HEALTH_TRACKER_INTEGRATION.md` alla M10 come nodi da sciogliere prima di aprire il PR.

---

## 15. Riepilogo domande aperte (tutte, ordinate per milestone)

Domande che **non bloccano l'inizio** ma vanno chiarite al momento opportuno:

| # | Domanda | Milestone |
|---|---|---|
| 1 | Mount `auth` su `/` (come diario) o su `/api/auth`? | M2 |
| 2 | SortableJS via CDN (con SRI) o npm + servito statico? Propongo **CDN** per coerenza. | M4 |
| 3 | `side` su `routine_items` o solo su `exercises`? Oggi solo su exercises nel plan, OK. | M4 |
| 4 | Timezone `started_at/ended_at`: ISO con offset locale Europe/Rome o sempre UTC (Z)? Propongo **UTC + conversione client**. | M5b |
| 5 | Heatmap: binaria o graduata per durata? Propongo **binaria con tooltip durata**. | M6 |
| 6 | Chart.js: stessa versione del diario (`4.4.0` via jsdelivr) o versione più recente? Propongo **stessa del diario**. | M6 |
| 7 | Campo `workout_activity_type` nell'output `/api/external/sessions` già fisso `flexibility` o configurabile per sessione? Propongo **fisso** per ora. | M7 |
| 8 | `pending_workouts` esiste già in health-tracker? (vedi sopra) | M10 |
| 9 | Granularità sessione → workout: monolitico vs con `HKWorkoutActivity` per esercizio. | M10 |

---

## 16. Checklist di riuso per la stretching app

Ogni voce cita il file del diario da **consultare** (non copiare/incollare ciecamente, ma tenere come riferimento vivo):

- [ ] `server.js` → ordine middleware + session config → `food diary/server.js`
- [ ] `database/db.js` → singleton + migrazioni idempotenti → `food diary/database/db.js`
- [ ] `routes/auth.js` → `isAuth`, login/logout, `/api/me` → `food diary/routes/auth.js`
- [ ] `services/images.js` → multer + sharp (adattare 1024px lato lungo) → `food diary/routes/foods.js` (storage + resize)
- [ ] `public/js/app.js` → `apiFetch`, utility date, tab switching → `food diary/public/js/app.js`
- [ ] `public/css/style.css` → CSS vars + dark mode + 430px → `food diary/public/css/style.css`
- [ ] `public/sw.js` → 4 bucket versionati, whitelist API, SKIP_WAITING → `food diary/public/sw.js`
- [ ] `public/manifest.json` → `food diary/public/manifest.json`
- [ ] `install.sh` / `update.sh` / `rotate-lxc-token.sh` → `food diary/*.sh`
- [ ] `docs/EXTERNAL_API.md` → scaletta doc API → `food diary/docs/EXTERNAL_API.md`
- [ ] `CLAUDE.md` → struttura + convenzioni → `food diary/CLAUDE.md`
