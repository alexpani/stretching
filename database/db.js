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

  // ──────────────────────────────────────────────────────────────────
  // Qui arriveranno le migrazioni incrementali nelle prossime milestone:
  //   M3 → exercises
  //   M4 → routines, routine_items
  //   M5b → sessions
  // In M1 non serve ancora nulla: setup.js crea le tabelle base e settings.
  // ──────────────────────────────────────────────────────────────────

  return _db;
}

module.exports = { getDb };
