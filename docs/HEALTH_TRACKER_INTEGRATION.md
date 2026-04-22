# Integrazione con `alexpani/health-tracker`

Specifiche per il PR futuro sul repo `alexpani/health-tracker` che aggancia la PWA Stretching all'ecosistema salute. **Questo documento non è codice della stretching app**: è il piano per il lavoro da fare altrove. Non serve deploy per leggerlo.

## Scopo

Sincronizzare automaticamente ogni sessione completata nella PWA Stretching come `HKWorkout` su Apple HealthKit, e mostrarla nella dashboard React del `health-tracker`. La stretching app resta passiva: espone `/api/external/*` in LAN, il resto lo fa `health-tracker`.

## Architettura risultante

```
[stretching PWA]
   └─ SQLite locale + API read-only
        ↓ httpx (poll / trigger)
[health-tracker backend FastAPI]           ← PR FUTURO QUI
   └─ nuovo modulo routers/stretching.py
   └─ nuova tabella stretching_hk_sync
   └─ enqueue in pending_workouts (tabella esistente/da estendere)
        ↓ polling iOS
[HealthTracker iOS]                         ← NESSUNA MODIFICA
   └─ HealthKitManager già gestisce HKWorkout
   └─ POST /api/v1/workouts/batch esiste già
        ↓ save
[HealthKit → HKWorkout(.flexibility)]
```

## Vincoli confermati dal repo attuale

Da `/Users/alessandro/Claude Code/ealth-tracker/`:

1. **`routers/write.py:14-31`**: `ALLOWED_WRITE_TYPES` accetta solo `HKQuantityTypeIdentifier*`. **HKWorkout NON passa dalla write queue**. ✓ La stretching va quindi verso il path workout.
2. **`ios/HealthTracker/HealthKitManager.swift:669-703`**: iOS già costruisce `HKWorkout` con `activityType`, `duration`, `energyBurned`, `startDate/endDate`, metadata, `activities` (iOS 17+). ✓ Lato iOS non serve toccare nulla.
3. **`routers/diario.py:78-188`**: pattern delete+recreate idempotente con tolleranza. Lo replichiamo (senza tolleranza, usiamo id sessione).
4. **`alembic/versions/6677af61441c_diario_hk_sync.py`**: come scrivere una migration. Lo cloniamo.

## Scope del PR

### Backend FastAPI

#### 1. Nuovo modello `StretchingHkSync`

In `backend/app/models.py`, accanto a `DiarioHkSync`:

```python
class StretchingHkSync(Base):
    __tablename__ = "stretching_hk_sync"

    id = Column(Integer, primary_key=True)
    session_id = Column(String, nullable=False, unique=True)   # UUID dalla stretching app
    started_at = Column(DateTime(timezone=True), nullable=False)
    duration_sec = Column(Integer, nullable=False)
    routine_name = Column(String)
    items_total = Column(Integer, nullable=False)
    items_skipped = Column(Integer, nullable=False, default=0)

    hk_uuid = Column(String)                                    # popolato dopo /confirm iOS
    pending_workout_id = Column(Integer, ForeignKey("pending_workouts.id"))
    posted_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_stretching_hk_sync_pending", "pending_workout_id"),
        Index("idx_stretching_hk_sync_started", "started_at"),
    )
```

> **Nota sul `session_id` UNIQUE**: a differenza di `DiarioHkSync` che usa `(date, type)` perché i totali giornalieri cambiano nel tempo, qui ogni sessione è immutabile una volta creata. `session_id` univoco è sufficiente, niente delete+recreate.

#### 2. Migration alembic

`backend/alembic/versions/<rev>_stretching_hk_sync.py`:

```python
"""stretching_hk_sync

Revision ID: XXXXXXXXXXXX
Revises: <ultima-rev>
Create Date: 2026-XX-XX
"""
from alembic import op
import sqlalchemy as sa

revision = "XXXXXXXXXXXX"
down_revision = "<ultima-rev>"

def upgrade() -> None:
    op.create_table(
        "stretching_hk_sync",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.String(), nullable=False, unique=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_sec", sa.Integer(), nullable=False),
        sa.Column("routine_name", sa.String()),
        sa.Column("items_total", sa.Integer(), nullable=False),
        sa.Column("items_skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hk_uuid", sa.String()),
        sa.Column("pending_workout_id", sa.Integer(), sa.ForeignKey("pending_workouts.id")),
        sa.Column("posted_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_stretching_hk_sync_pending", "stretching_hk_sync", ["pending_workout_id"])
    op.create_index("idx_stretching_hk_sync_started", "stretching_hk_sync", ["started_at"])

def downgrade() -> None:
    op.drop_index("idx_stretching_hk_sync_started", "stretching_hk_sync")
    op.drop_index("idx_stretching_hk_sync_pending", "stretching_hk_sync")
    op.drop_table("stretching_hk_sync")
```

**Prerequisito**: verificare che `pending_workouts` esista già nel backend. Se non esiste (solo `pending_writes` e `pending_deletions`), va creata con una migration separata **prima**. Stima: analoga a `pending_writes` ma senza `unit`/`value`, con in più `activity_type`, `duration_sec`, `metadata_json`. Vedi `backend/app/models.py` della versione attuale per il modello `Workout` esistente: lì ci sono già `activity_type`, `duration`, `total_energy`, `metadata`. La tabella `pending_workouts` replica quei campi + lo stato lifecycle (`status`, `created_at`, `written_at`, `failed_at`).

Questa domanda è la **#8 del REFERENCE_NOTES sezione 15**. Da chiudere prima di iniziare il PR.

#### 3. Router `routers/stretching.py`

Con 3 endpoint (proxy + sync):

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import httpx
from datetime import datetime, timezone
from app.database import get_db
from app.models import StretchingHkSync, PendingWorkout  # pending_workouts assunto

router = APIRouter(prefix="/api/v1/stretching", tags=["stretching"])

STRETCHING_BASE = os.getenv("STRETCHING_BASE_URL", "http://192.168.68.150:3100")
TIMEOUT = httpx.Timeout(10.0)

# 1. Proxy lista sessioni (per la dashboard)
@router.get("/sessions")
async def list_sessions(from_: str | None = None, to: str | None = None):
    params = {}
    if from_: params["from"] = from_
    if to:    params["to"]   = to
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(f"{STRETCHING_BASE}/api/external/sessions", params=params)
        r.raise_for_status()
        return r.json()

# 2. Stato sync (per la dashboard: quali sessioni sono già in HealthKit)
@router.get("/sync-status")
def sync_status(db: Session = Depends(get_db)):
    rows = db.query(StretchingHkSync).order_by(StretchingHkSync.started_at.desc()).limit(100).all()
    return [
        {
            "session_id": r.session_id,
            "hk_uuid": r.hk_uuid,
            "posted_at": r.posted_at.isoformat() if r.posted_at else None,
            "pending": r.pending_workout_id is not None and r.hk_uuid is None,
        }
        for r in rows
    ]

# 3. Trigger sync
@router.post("/sync-to-hk")
async def sync_to_hk(db: Session = Depends(get_db)):
    # Fetch ultime 30 gg di sessioni dalla stretching app
    today = datetime.now(timezone.utc).date()
    from_date = (today - timedelta(days=30)).isoformat()
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(f"{STRETCHING_BASE}/api/external/sessions",
                             params={"from": from_date, "to": today.isoformat()})
        r.raise_for_status()
        sessions = r.json()

    tracked = {
        row.session_id: row for row in
        db.query(StretchingHkSync).filter(
            StretchingHkSync.session_id.in_([s["id"] for s in sessions])
        ).all()
    }

    queued = 0
    for s in sessions:
        if s["id"] in tracked:
            continue   # già gestita
        # Enqueue in pending_workouts
        pw = PendingWorkout(
            activity_type="flexibility",
            started_at=datetime.fromisoformat(s["started_at"].replace("Z", "+00:00")),
            ended_at=datetime.fromisoformat(s["ended_at"].replace("Z", "+00:00")),
            duration_sec=s["duration_sec"],
            metadata_json={
                "stretching.routine_name": s.get("routine_name"),
                "stretching.routine_id": s.get("routine_id"),
                "stretching.items_total": s["items_total"],
                "stretching.items_skipped": s.get("items_skipped", 0),
                "HKWorkoutDisplayName": s.get("routine_name") or "Stretching",
            },
            status="pending",
        )
        db.add(pw)
        db.flush()
        tracking = StretchingHkSync(
            session_id=s["id"],
            started_at=pw.started_at,
            duration_sec=s["duration_sec"],
            routine_name=s.get("routine_name"),
            items_total=s["items_total"],
            items_skipped=s.get("items_skipped", 0),
            pending_workout_id=pw.id,
        )
        db.add(tracking)
        queued += 1

    db.commit()
    return {"queued": queued, "total_fetched": len(sessions)}
```

#### 4. Mount router

`backend/app/main.py`:

```python
from app.routers import stretching
app.include_router(stretching.router)
```

#### 5. Env var + docker-compose

`backend/.env.example`:

```
STRETCHING_BASE_URL=http://192.168.68.150:3100
```

In produzione, aggiungere anche a `docker-compose.yml` se il backend gira in container e deve raggiungere l'LXC stretching (probabilmente sì, passando dal bridge di rete del container).

#### 6. Confirm callback (se non esiste già per workout)

Quando l'iOS salva un `HKWorkout` e riceve l'UUID, chiama probabilmente `POST /api/v1/workouts/{id}/confirm {hk_uuid}`. Se esiste già, il callback deve aggiornare anche `StretchingHkSync`:

```python
# In routers/workouts.py (già esistente)
@router.post("/{workout_id}/confirm")
def confirm_workout(workout_id: int, body: ConfirmIn, db: Session = Depends(get_db)):
    pw = db.query(PendingWorkout).get(workout_id)
    pw.status = "written"
    pw.hk_uuid = body.hk_uuid
    pw.written_at = datetime.now(timezone.utc)

    # AGGIUNGI: aggiorna anche il tracking stretching se esiste
    sync_row = db.query(StretchingHkSync).filter_by(pending_workout_id=pw.id).first()
    if sync_row:
        sync_row.hk_uuid = body.hk_uuid
        sync_row.posted_at = datetime.now(timezone.utc)

    db.commit()
    return {"ok": True}
```

### iOS HealthTracker app

**Nessuna modifica richiesta.** L'app già:
- fa polling di `pending_writes` e `pending_deletions` in `SyncService.performFullSync`
- costruisce `HKWorkout` in `HealthKitManager.swift`
- salva in HealthKit con `HKHealthStore.save()`
- conferma al backend

Se il backend espone `pending_workouts` con lo stesso protocollo dei `pending_writes` (polling GET + POST confirm), l'iOS li processerà uguale. Da verificare: il `SyncService` attuale itera su entrambi o solo su `pending_writes`?

### Dashboard React

#### 1. Route nuova in `dashboard/src/App.tsx`

```tsx
import Stretching from "./pages/Stretching";
// ...
<Route path="/stretching" element={<Stretching />} />
```

#### 2. Sidebar in `dashboard/src/components/Sidebar.tsx`

Appendere una voce dopo "Nutrition":

```tsx
{ icon: StretchIcon, label: "Stretching", path: "/stretching" },
```

(Icona Lucide: `Activity` o `Flame` se non esiste `Stretch`.)

#### 3. Hook in `dashboard/src/lib/queries.ts`

```ts
export function useStretchingSessions(from: string, to: string) {
  return useQuery({
    queryKey: ["stretching-sessions", from, to],
    queryFn: () => apiGet(`/api/v1/stretching/sessions?from=${from}&to=${to}`),
    staleTime: 30_000,
  });
}

export function useStretchingSyncStatus() {
  return useQuery({
    queryKey: ["stretching-sync-status"],
    queryFn: () => apiGet("/api/v1/stretching/sync-status"),
  });
}

export function useStretchingSyncToHK() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost("/api/v1/stretching/sync-to-hk", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stretching-sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["stretching-sessions"] });
    },
  });
}
```

#### 4. Componente `dashboard/src/pages/Stretching.tsx`

Ricalcato su `DiarioSection.tsx`. Contenuto:

- Header con range date (ultimi 30 gg di default)
- Card stats: sessioni totali, tempo totale, streak (calcolabile client-side)
- Grafico `ComposedChart` Recharts con bar duration per day
- Lista sessioni con colonna "sync HK" (badge "Sincronizzata" o "In coda" da `sync-status`)
- Pulsante `Button` "Sincronizza con Apple Salute" → `useStretchingSyncToHK().mutate()`
- Toast di conferma (libreria di toast già nel progetto)

## Testing plan

### Unit (backend)

- `tests/test_stretching_router.py`:
  - `list_sessions` forward correttamente query params
  - `sync-to-hk` skippa sessioni già tracciate
  - `sync-to-hk` enqueue corretto e crea `StretchingHkSync` + `PendingWorkout`

### Integration (staging)

1. Avvia stretching app in locale, crea 3 sessioni.
2. Avvia health-tracker backend con `STRETCHING_BASE_URL=http://localhost:3100`.
3. `curl -X POST http://localhost:8000/api/v1/stretching/sync-to-hk` → atteso `{"queued": 3, ...}`
4. Riesegui → atteso `{"queued": 0, ...}` (idempotente)
5. Query DB: 3 righe in `stretching_hk_sync` e 3 in `pending_workouts` con status `pending`.

### E2E (produzione iPhone)

1. Fai una sessione stretching sul dispositivo reale.
2. Aspetta polling iOS (o forza pulsante "Sync" nell'app iOS).
3. Apri Salute → Allenamenti → verifica HKWorkout con `routine_name` come display name e `activityType: flexibility`.
4. Torna alla dashboard → sessione mostra badge "Sincronizzata".

## Rollout plan

1. **PR 1**: migration `pending_workouts` (se non esiste) + test.
2. **PR 2**: migration `stretching_hk_sync` + modello.
3. **PR 3**: router backend + env var + mount.
4. **PR 4**: `/confirm` hook per aggiornare tracking.
5. **PR 5**: dashboard route/hook/pagina.
6. Verifica staging.
7. Deploy produzione, eseguire una prima volta `POST /sync-to-hk` manuale dalla dashboard.
8. Opzionale: cron/job periodico lato backend che chiama `sync-to-hk` ogni notte (analogo al diario).

## Cosa NON va in questo PR

- Modifiche a `alexpani/stretching`: la stretching app espone già tutto ciò che serve con `/api/external/*`. Se emergono bisogni (es. esporre anche i singoli `routine_items` con nome esercizio per popolare `HKWorkoutActivity` iOS 17+), aprire PR separato lì.
- Modifiche iOS HealthTracker: come detto, se `SyncService` gestisce già `pending_workouts` niente da fare. Altrimenti PR separato su iOS.
- Write-back (da health-tracker verso stretching): non previsto. Stretching è source-of-truth delle proprie sessioni.

## Domande da chiudere prima di aprire il PR

Queste sono le 5 dall'ultima colonna di `docs/REFERENCE_NOTES.md` sezione 14, riportate qui per comodità:

1. Esiste già `pending_workouts` in `backend/app/models.py`? (Grep `pending_workouts`, `class PendingWorkout`.)
2. Esiste già un endpoint `/confirm` per workout? (Grep `routers/workouts.py`.)
3. Activity type fisso `.flexibility` va bene o il client vuole poter scegliere (es. `.mindAndBody` per routine meditative)?
4. Energia stimata: lasciamo `null` e facciamo stimare iOS, oppure calcoliamo `duration_min × 2 kcal` lato backend?
5. Granularità: workout monolitico o con `HKWorkoutActivity` per esercizio? Il secondo richiede di esporre `routine_items` nell'API esterna.

Rispondere alle prime due leggendo il codice, alle ultime tre con decisione di prodotto.

## Dipendenze tra repo

| Repo | Ruolo | Tocca questo PR |
|------|-------|:---:|
| `alexpani/stretching` | Produce sessioni, espone `/api/external/*` | ✗ |
| `alexpani/health-tracker` (backend) | Sync orchestration, tracking DB, router | ✓ |
| `alexpani/health-tracker` (dashboard) | UI per visualizzare e triggerare sync | ✓ |
| `alexpani/health-tracker` (ios) | Salva `HKWorkout`, conferma al backend | (solo se `SyncService` non gestisce già workout) |

## Riferimenti

- Stretching API: [`docs/EXTERNAL_API.md`](EXTERNAL_API.md)
- Analisi repo esistenti: [`docs/REFERENCE_NOTES.md`](REFERENCE_NOTES.md) sezioni 14-15
- Pattern diario-alimentare (da cui mutuiamo): `routers/diario.py` e `models.py::DiarioHkSync` nel repo `ealth-tracker`.
