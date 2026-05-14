const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = path.join(__dirname, 'stretching.sqlite');

let _db = null;

// Singleton + migrazioni idempotenti (pattern diario-alimentare).
// Ogni blocco ispeziona lo schema corrente con PRAGMA table_info / sqlite_master
// e applica l'ALTER TABLE / CREATE TABLE solo se serve. Sicuro da rieseguire.
async function getDb() {
  if (_db) return _db;

  _db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await _db.run('PRAGMA foreign_keys = ON');

  // ── Migrazioni idempotenti ───────────────────────────────────────
  // Ogni blocco ispeziona lo schema e applica solo le differenze.
  // Sicuro da rieseguire a ogni avvio.

  // M3 — esercizi
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS exercises (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT,
      muscle_group TEXT NOT NULL,
      side         TEXT,
      level        TEXT NOT NULL,
      duration_sec INTEGER NOT NULL DEFAULT 30,
      image_path   TEXT,
      notes        TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now')),
      deleted_at   TEXT
    )
  `);
  await _db.exec(`CREATE INDEX IF NOT EXISTS idx_exercises_muscle ON exercises(muscle_group)`);
  await _db.exec(`CREATE INDEX IF NOT EXISTS idx_exercises_level  ON exercises(level)`);

  // M4 — routine + items
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS routines (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      deleted_at  TEXT
    )
  `);
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS routine_items (
      id                    TEXT PRIMARY KEY,
      routine_id            TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
      exercise_id           TEXT NOT NULL REFERENCES exercises(id),
      position              INTEGER NOT NULL,
      duration_override_sec INTEGER,
      rest_after_sec        INTEGER DEFAULT 10
    )
  `);
  await _db.exec(`CREATE INDEX IF NOT EXISTS idx_routine_items_routine ON routine_items(routine_id, position)`);

  // M5b — sessioni completate
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      routine_id    TEXT REFERENCES routines(id),
      routine_name  TEXT,
      started_at    TEXT NOT NULL,
      ended_at      TEXT NOT NULL,
      duration_sec  INTEGER NOT NULL,
      items_total   INTEGER NOT NULL,
      items_skipped INTEGER NOT NULL DEFAULT 0,
      notes         TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    )
  `);
  await _db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)`);

  // Video loop per esercizio (default 1 = loop, 0 = stop sull'ultimo frame)
  const excols = (await _db.all("PRAGMA table_info(exercises)")).map(c => c.name);
  if (!excols.includes('video_loop')) {
    await _db.run(`ALTER TABLE exercises ADD COLUMN video_loop INTEGER NOT NULL DEFAULT 1`);
  }

  // Posizione di esecuzione: 'in piedi' | 'da seduto' | 'a terra'
  if (!excols.includes('posizione')) {
    await _db.run(`ALTER TABLE exercises ADD COLUMN posizione TEXT NOT NULL DEFAULT 'in piedi'`);
  }

  // Modalità esercizio: 'tempo' (countdown) | 'ripetizioni' (avanzamento manuale)
  if (!excols.includes('modalita')) {
    await _db.run(`ALTER TABLE exercises ADD COLUMN modalita TEXT NOT NULL DEFAULT 'tempo'`);
  }
  if (!excols.includes('reps_count')) {
    await _db.run(`ALTER TABLE exercises ADD COLUMN reps_count INTEGER`);
  }

  // Override ripetizioni per singolo item di routine (analogo a duration_override_sec)
  const ricols = (await _db.all("PRAGMA table_info(routine_items)")).map(c => c.name);
  if (!ricols.includes('reps_override')) {
    await _db.run(`ALTER TABLE routine_items ADD COLUMN reps_override INTEGER`);
  }

  // Zone muscolari multiple per esercizio (tag). Sostituisce concettualmente
  // muscle_group lato UI; muscle_group resta come valore derivato (NOT NULL,
  // usato per le immagini placeholder).
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS exercise_zones (
      exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
      zone        TEXT NOT NULL,
      PRIMARY KEY (exercise_id, zone)
    )
  `);
  await _db.exec(`CREATE INDEX IF NOT EXISTS idx_exercise_zones_zone ON exercise_zones(zone)`);
  // Backfill grezzo: ogni esercizio senza zone ne riceve una derivata da
  // muscle_group. Idempotente: dopo il primo giro tutti hanno ≥1 zona.
  const GROUP_TO_ZONE = {
    'collo e spalle':   'Spalle e cingolo scapolare',
    'schiena':          'Dorsale (schiena alta)',
    'addominali':       'Core e addome',
    'glutei e gambe':   'Glutei e piriforme',
    'braccia e torace': 'Braccia e polsi'
  };
  const exNoZones = await _db.all(`
    SELECT e.id, e.muscle_group FROM exercises e
    WHERE NOT EXISTS (SELECT 1 FROM exercise_zones z WHERE z.exercise_id = e.id)
  `);
  for (const e of exNoZones) {
    const zone = GROUP_TO_ZONE[e.muscle_group] || 'Core e addome';
    await _db.run(`INSERT OR IGNORE INTO exercise_zones (exercise_id, zone) VALUES (?, ?)`, e.id, zone);
  }

  // Round 2 — M16/M17: campi aggiuntivi su routine (idempotente).
  const rcols = (await _db.all("PRAGMA table_info(routines)")).map(c => c.name);
  if (!rcols.includes('rest_standard_sec')) {
    await _db.run(`ALTER TABLE routines ADD COLUMN rest_standard_sec INTEGER`);
  }
  if (!rcols.includes('voice_guide')) {
    await _db.run(`ALTER TABLE routines ADD COLUMN voice_guide INTEGER NOT NULL DEFAULT 0`);
  }
  if (!rcols.includes('cover_image_path')) {
    await _db.run(`ALTER TABLE routines ADD COLUMN cover_image_path TEXT`);
  }

  // Round 2 — M12: migrazione categorie muscolari (8 vecchie → 5 nuove).
  // Idempotente: gli UPDATE matchano solo i valori vecchi; se non presenti, no-op.
  await _db.run(`UPDATE exercises SET muscle_group = 'collo e spalle'  WHERE muscle_group IN ('collo', 'spalle')`);
  await _db.run(`UPDATE exercises SET muscle_group = 'addominali'      WHERE muscle_group = 'core'`);
  await _db.run(`UPDATE exercises SET muscle_group = 'glutei e gambe'  WHERE muscle_group IN ('gambe', 'anche', 'polpacci')`);
  await _db.run(`UPDATE exercises SET muscle_group = 'braccia e torace' WHERE muscle_group = 'braccia'`);
  // 'schiena' resta invariata.

  return _db;
}

module.exports = { getDb };
