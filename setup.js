require('dotenv').config();
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = path.join(__dirname, 'database', 'stretching.sqlite');

async function main() {
  const dbDir = path.join(__dirname, 'database');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run('PRAGMA foreign_keys = ON');

  console.log('Creazione tabelle base...');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Le tabelle di dominio (exercises, routines, routine_items, sessions)
  // saranno aggiunte nelle milestone successive (M3/M4/M5b).

  await db.close();

  console.log('\n✅ Database creato: database/stretching.sqlite\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PASSO SUCCESSIVO: copia .env.example in .env e modifica i valori');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('  cp .env.example .env');
  console.log('  # apri .env e cambia SESSION_SECRET, ADMIN_USER, ADMIN_PASSWORD\n');
  console.log('Poi avvia il server con: node server.js');
  console.log('E apri nel browser:       http://localhost:3100\n');
}

main().catch(err => {
  console.error('Errore durante il setup:', err);
  process.exit(1);
});
