require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDb } = require('./database/db');

async function seedIfEmpty(db) {
  const count = (await db.get('SELECT COUNT(*) AS n FROM exercises WHERE deleted_at IS NULL')).n;
  if (count > 0) {
    console.log(`Seed saltato: ${count} esercizi già presenti.`);
    return;
  }
  console.log('Seed esercizi iniziali...');

  const seed = [
    // collo
    ['Rotazione lenta del collo',  'Ruota la testa descrivendo un cerchio largo.', 'collo',    'both', 'easy',   30],
    ['Flessione laterale collo',   'Porta l\'orecchio verso la spalla, senza alzare la spalla.', 'collo',    'dx',   'easy',   30],
    ['Flessione laterale collo',   'Porta l\'orecchio verso la spalla, senza alzare la spalla.', 'collo',    'sx',   'easy',   30],
    // spalle
    ['Circonduzione spalle',       'Grandi cerchi con le spalle, in avanti e indietro.',        'spalle',   'both', 'easy',   40],
    ['Cross-body stretch',         'Porta un braccio disteso davanti al petto, accompagnalo con l\'altro.', 'spalle', 'dx', 'easy',   30],
    ['Cross-body stretch',         'Porta un braccio disteso davanti al petto, accompagnalo con l\'altro.', 'spalle', 'sx', 'easy',   30],
    // schiena
    ['Cat-cow',                    'In quadrupedia alterna inarcamento e curvatura dorsale.',   'schiena',  'both', 'easy',   45],
    ['Child\'s pose',              'Seduto sui talloni, allunga le braccia in avanti e rilassa la schiena.', 'schiena', 'both', 'easy', 45],
    ['Rotazione lombare supina',   'Supino, ginocchia piegate, porta le ginocchia da un lato mantenendo le spalle a terra.', 'schiena', 'dx', 'medium', 30],
    ['Rotazione lombare supina',   'Supino, ginocchia piegate, porta le ginocchia da un lato mantenendo le spalle a terra.', 'schiena', 'sx', 'medium', 30],
    // core
    ['Cobra stretch',              'Prono, mani sotto le spalle, solleva il petto mantenendo il bacino a terra.', 'core', 'both', 'medium', 30],
    ['Hip flexor lunge',           'Affondo basso: allunga l\'anca della gamba arretrata spingendo il bacino avanti.', 'core', 'dx', 'medium', 40],
    ['Hip flexor lunge',           'Affondo basso: allunga l\'anca della gamba arretrata spingendo il bacino avanti.', 'core', 'sx', 'medium', 40],
    // gambe
    ['Quadricipite in piedi',      'In piedi, afferra la caviglia portando il tallone al gluteo.', 'gambe', 'dx', 'medium', 30],
    ['Quadricipite in piedi',      'In piedi, afferra la caviglia portando il tallone al gluteo.', 'gambe', 'sx', 'medium', 30],
    ['Ischiocrurali seduto',       'Seduto, gamba tesa davanti, piegati in avanti dall\'anca.', 'gambe', 'both', 'medium', 40],
    // anche
    ['Butterfly',                  'Seduto, piante dei piedi unite, avvicina i talloni e lascia scendere le ginocchia.', 'anche', 'both', 'easy', 45],
    ['Pigeon pose',                'In quadrupedia porta il ginocchio avanti sotto il petto, distendi la gamba opposta indietro.', 'anche', 'dx', 'hard', 45],
    ['Pigeon pose',                'In quadrupedia porta il ginocchio avanti sotto il petto, distendi la gamba opposta indietro.', 'anche', 'sx', 'hard', 45],
    // polpacci
    ['Polpaccio al muro',          'In piedi, mani al muro, gamba dietro tesa con tallone a terra.', 'polpacci', 'dx', 'easy', 30],
    ['Polpaccio al muro',          'In piedi, mani al muro, gamba dietro tesa con tallone a terra.', 'polpacci', 'sx', 'easy', 30],
    // braccia
    ['Tricipite sopra testa',      'Braccio sopra la testa, mano dietro la nuca; aiuta con l\'altra mano al gomito.', 'braccia', 'dx', 'easy', 25],
    ['Tricipite sopra testa',      'Braccio sopra la testa, mano dietro la nuca; aiuta con l\'altra mano al gomito.', 'braccia', 'sx', 'easy', 25]
  ];

  for (const [name, description, muscle_group, side, level, duration_sec] of seed) {
    await db.run(
      `INSERT INTO exercises (id, name, description, muscle_group, side, level, duration_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), name, description, muscle_group, side, level, duration_sec
    );
  }
  console.log(`✓ Inseriti ${seed.length} esercizi`);
}

async function main() {
  const dbDir = path.join(__dirname, 'database');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // getDb() applica le migrazioni idempotenti (settings, exercises, ...).
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await seedIfEmpty(db);

  console.log('\n✅ Setup completato.');
  console.log('  Copia .env.example in .env e avvia con: node server.js');
  console.log('  Apri:                                   http://localhost:3100\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Errore durante il setup:', err);
  process.exit(1);
});
