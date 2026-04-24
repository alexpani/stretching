# Stretching — API esterne

API read-only pensate per il consumo da applicazioni terze (es. **Health Tracker**). Espongono sessioni completate, routine ed esercizi — i dati necessari a costruire un `HKWorkout` su Apple HealthKit o a mostrare la storia stretching in una dashboard esterna.

## Caratteristiche generali

| | |
|---|---|
| **Base URL (dev)**      | `http://localhost:3100` |
| **Base URL (prod LAN)** | `http://<stretching-lxc>:3100` (IP da assegnare) |
| **Prefisso**            | `/api/external` |
| **Autenticazione**      | Nessuna (solo LAN, coerente col resto dell'ecosistema domestico) |
| **Formato**             | JSON (UTF-8) |
| **Metodi**              | `GET` solo (read-only) |
| **CORS**                | Non configurato — prevedi chiamate server-to-server o stessa origine |
| **Timezone**            | Tutti i timestamp in **ISO 8601 UTC** (`Z`) |

> ⚠️ Non esporre questi endpoint su internet senza prima aggiungere un livello di auth (es. API key via header `Authorization: Bearer ...`).

---

## Endpoint

### 1. `GET /api/external/sessions`

Restituisce le sessioni completate in un range di date. Ogni sessione è già formattata come "workout" con i campi minimi per creare un `HKWorkout`.

#### Query parameters

| Parametro | Tipo | Obbligatorio | Formato | Descrizione |
|-----------|------|:---:|---------|-------------|
| `from`    | string | ✗ | `YYYY-MM-DD` | Data inizio range (inclusa) |
| `to`      | string | ✗ | `YYYY-MM-DD` | Data fine range (inclusa) |

Se entrambi omessi, ritorna **tutte** le sessioni. Il filtro è applicato su `started_at` in UTC, assumendo la giornata `YYYY-MM-DDT00:00:00Z`–`YYYY-MM-DDT23:59:59Z`.

#### Response `200 OK`

```json
[
  {
    "id": "9093f652-6c3c-4c36-8ab1-16e3c7c2d1d9",
    "routine_id": "4d85e8c0-a123-4d3a-9f0e-5c6a7b8d9e10",
    "routine_name": "Risveglio 5 min",
    "started_at": "2026-04-22T06:30:00.000Z",
    "ended_at":   "2026-04-22T06:35:00.000Z",
    "duration_sec": 300,
    "items_total": 8,
    "items_skipped": 1,
    "notes": null,
    "workout_activity_type": "flexibility"
  }
]
```

#### Campi

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | string | UUID della sessione |
| `routine_id` | string \| null | UUID della routine originale. `null` se la routine è stata poi cancellata o se la sessione era "improvvisata" |
| `routine_name` | string \| null | Nome della routine al momento dell'esecuzione (denormalizzato: sopravvive alla cancellazione della routine) |
| `started_at` | string | ISO 8601 UTC |
| `ended_at`   | string | ISO 8601 UTC |
| `duration_sec` | integer | Durata effettiva in secondi (tempo di parete meno pause) |
| `items_total` | integer | Numero di esercizi previsti nella sessione |
| `items_skipped` | integer | Numero di esercizi saltati dall'utente |
| `notes` | string \| null | Note libere (non ancora esposte dalla UI) |
| `workout_activity_type` | string | Valore fisso `"flexibility"` — corrisponde a `HKWorkoutActivityType.flexibility` |

#### Errori

| Status | Body | Quando |
|--------|------|--------|
| `400` | `{ "error": "from: YYYY-MM-DD richiesto" }` | `from` o `to` forniti con formato non valido |
| `500` | `{ "error": "Errore del server" }` | Errore interno |

#### Esempio

```bash
curl -s "http://localhost:3100/api/external/sessions?from=2026-04-14&to=2026-04-22" | jq
```

---

### 2. `GET /api/external/sessions/:id`

Dettaglio di una singola sessione. Stessa forma dell'elemento dell'elenco.

#### Response `200 OK`

Identico a un elemento della lista dell'endpoint precedente.

#### Errori

| Status | Body | Quando |
|--------|------|--------|
| `404` | `{ "error": "Non trovata" }` | ID inesistente |
| `500` | `{ "error": "Errore del server" }` | Errore interno |

#### Esempio

```bash
curl -s "http://localhost:3100/api/external/sessions/9093f652-6c3c-4c36-8ab1-16e3c7c2d1d9" | jq
```

---

### 3. `GET /api/external/routines`

Catalogo delle routine attive (non cancellate) con statistiche base. Utile per mostrare un elenco nella dashboard Health Tracker o per arricchire la lista sessioni.

#### Response `200 OK`

```json
[
  {
    "id": "4d85e8c0-a123-4d3a-9f0e-5c6a7b8d9e10",
    "name": "Risveglio 5 min",
    "description": "Sveglia il corpo in modo dolce: collo, spalle, schiena, anche.",
    "items_total": 8,
    "duration_sec": 365,
    "created_at": "2026-04-21 18:05:12",
    "updated_at": "2026-04-22 07:14:03"
  }
]
```

#### Campi

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | string | UUID routine |
| `name` | string | Nome routine |
| `description` | string \| null | Descrizione |
| `items_total` | integer | Numero esercizi |
| `duration_sec` | integer | Durata totale stimata (somma esercizi + riposi, escluso l'ultimo riposo) |
| `created_at` | string | Timestamp locale DB |
| `updated_at` | string | Timestamp locale DB |

---

### 4. `GET /api/external/exercises`

Catalogo esercizi attivi (non cancellati).

#### Response `200 OK`

```json
[
  {
    "id": "e7e8f9a0-...",
    "name": "Butterfly",
    "description": "Seduto, piante dei piedi unite, avvicina i talloni...",
    "muscle_group": "glutei e gambe",
    "side": "both",
    "duration_sec": 45,
    "image_path": "/uploads/stretch-e7e8f9a0-....jpg"
  }
]
```

#### Campi

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | string | UUID esercizio |
| `name` | string | Nome |
| `description` | string \| null | Descrizione dell'esecuzione |
| `muscle_group` | string | Uno di: `collo e spalle`, `schiena`, `addominali`, `glutei e gambe`, `braccia e torace` |
| `side` | string | Uno di: `both`, `dx`, `sx` |
| `duration_sec` | integer | Durata di default in secondi |
| `image_path` | string \| null | Path relativo dell'immagine caricata (se presente); `null` → il client usa il fallback SVG `/img/exercises/<slug>.svg` dove `<slug>` è il `muscle_group` con gli spazi sostituiti da `-`. |

---

## Pattern di consumo tipico (Health Tracker)

L'obiettivo è sincronizzare ciascuna sessione stretching come `HKWorkout` su Apple HealthKit. Il flusso, quando l'integrazione sul backend `health-tracker` sarà completata (M10 — vedi `docs/REFERENCE_NOTES.md`), sarà:

1. Il backend `health-tracker` fa polling giornaliero (o su trigger manuale dalla dashboard) di `GET /api/external/sessions?from=...&to=...`.
2. Per ogni sessione, consulta la tabella di tracking `stretching_hk_sync` (analoga a `diario_hk_sync`) per sapere se è già stata sincronizzata.
3. Le nuove sessioni vengono messe in coda come `PendingWorkout` (non `PendingWrite`: la write queue attuale non supporta `HKWorkout`).
4. L'app iOS `HealthTracker` processa la coda, crea `HKWorkout(activityType: .flexibility, start:..., end:..., duration: duration_sec)` e conferma con un `POST /confirm` al backend con l'`hk_uuid` ottenuto.
5. Il backend aggiorna `stretching_hk_sync.hk_uuid` e `posted_at`.

Campi mappati su `HKWorkout`:

| Campo stretching | HKWorkout |
|------------------|-----------|
| `workout_activity_type` (`"flexibility"`) | `HKWorkoutActivityType.flexibility` |
| `started_at` | `startDate` |
| `ended_at` | `endDate` |
| `duration_sec` | `duration` (in secondi) |
| `routine_name` | `metadata["HKWorkoutDisplayName"]` |
| `items_total`, `items_skipped`, `routine_id` | `metadata["stretching.*"]` (custom keys) |

### Esempio Node.js (fetch)

```js
const BASE = 'http://localhost:3100';

async function loadRange(from, to) {
  const res = await fetch(`${BASE}/api/external/sessions?from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

loadRange('2026-04-14', '2026-04-22').then(console.log);
```

### Esempio Python (requests)

```python
import requests

BASE = "http://localhost:3100"

sessions = requests.get(
    f"{BASE}/api/external/sessions",
    params={"from": "2026-04-14", "to": "2026-04-22"}
).json()

for s in sessions:
    print(s["started_at"], s["routine_name"], f"{s['duration_sec']}s")
```

---

## Versioning e stabilità

- L'API è **v1** implicita. Non esiste (ancora) un prefisso di versione.
- I campi elencati sono **stabili**: nuove chiavi possono essere aggiunte in modo non-breaking, ma nomi e semantica di quelli esistenti non cambieranno senza bump esplicito.
- Per cambiamenti breaking si introdurrà `/api/external/v2/...` mantenendo v1 in parallelo per un periodo di transizione.

## Implementazione

Codice: [routes/external.js](../routes/external.js). Montato in [server.js](../server.js) sotto `/api/external`.
