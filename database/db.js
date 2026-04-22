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

  // M5b → sessions                    (in arrivo)

  return _db;
}

module.exports = { getDb };
