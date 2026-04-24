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
    // collo e spalle
    ['Rotazione lenta del collo',  'Ruota la testa descrivendo un cerchio largo.',                       'collo e spalle', 'both', 30],
    ['Flessione laterale collo',   'Porta l\'orecchio verso la spalla, senza alzare la spalla.',         'collo e spalle', 'dx',   30],
    ['Flessione laterale collo',   'Porta l\'orecchio verso la spalla, senza alzare la spalla.',         'collo e spalle', 'sx',   30],
    ['Circonduzione spalle',       'Grandi cerchi con le spalle, in avanti e indietro.',                 'collo e spalle', 'both', 40],
    ['Cross-body stretch',         'Porta un braccio disteso davanti al petto, accompagnalo con l\'altro.', 'collo e spalle', 'dx', 30],
    ['Cross-body stretch',         'Porta un braccio disteso davanti al petto, accompagnalo con l\'altro.', 'collo e spalle', 'sx', 30],
    // schiena
    ['Cat-cow',                    'In quadrupedia alterna inarcamento e curvatura dorsale.',            'schiena', 'both', 45],
    ['Child\'s pose',              'Seduto sui talloni, allunga le braccia in avanti e rilassa la schiena.', 'schiena', 'both', 45],
    ['Rotazione lombare supina',   'Supino, ginocchia piegate, porta le ginocchia da un lato mantenendo le spalle a terra.', 'schiena', 'dx', 30],
    ['Rotazione lombare supina',   'Supino, ginocchia piegate, porta le ginocchia da un lato mantenendo le spalle a terra.', 'schiena', 'sx', 30],
    // addominali
    ['Cobra stretch',              'Prono, mani sotto le spalle, solleva il petto mantenendo il bacino a terra.', 'addominali', 'both', 30],
    ['Hip flexor lunge',           'Affondo basso: allunga l\'anca della gamba arretrata spingendo il bacino avanti.', 'addominali', 'dx', 40],
    ['Hip flexor lunge',           'Affondo basso: allunga l\'anca della gamba arretrata spingendo il bacino avanti.', 'addominali', 'sx', 40],
    // glutei e gambe
    ['Quadricipite in piedi',      'In piedi, afferra la caviglia portando il tallone al gluteo.',       'glutei e gambe', 'dx', 30],
    ['Quadricipite in piedi',      'In piedi, afferra la caviglia portando il tallone al gluteo.',       'glutei e gambe', 'sx', 30],
    ['Ischiocrurali seduto',       'Seduto, gamba tesa davanti, piegati in avanti dall\'anca.',          'glutei e gambe', 'both', 40],
    ['Butterfly',                  'Seduto, piante dei piedi unite, avvicina i talloni e lascia scendere le ginocchia.', 'glutei e gambe', 'both', 45],
    ['Pigeon pose',                'In quadrupedia porta il ginocchio avanti sotto il petto, distendi la gamba opposta indietro.', 'glutei e gambe', 'dx', 45],
    ['Pigeon pose',                'In quadrupedia porta il ginocchio avanti sotto il petto, distendi la gamba opposta indietro.', 'glutei e gambe', 'sx', 45],
    ['Polpaccio al muro',          'In piedi, mani al muro, gamba dietro tesa con tallone a terra.',     'glutei e gambe', 'dx', 30],
    ['Polpaccio al muro',          'In piedi, mani al muro, gamba dietro tesa con tallone a terra.',     'glutei e gambe', 'sx', 30],
    // braccia e torace
    ['Tricipite sopra testa',      'Braccio sopra la testa, mano dietro la nuca; aiuta con l\'altra mano al gomito.', 'braccia e torace', 'dx', 25],
    ['Tricipite sopra testa',      'Braccio sopra la testa, mano dietro la nuca; aiuta con l\'altra mano al gomito.', 'braccia e torace', 'sx', 25]
  ];

  for (const [name, description, muscle_group, side, duration_sec] of seed) {
    await db.run(
      `INSERT INTO exercises (id, name, description, muscle_group, side, level, duration_sec)
       VALUES (?, ?, ?, ?, ?, 'easy', ?)`,
      crypto.randomUUID(), name, description, muscle_group, side, duration_sec
    );
  }
  console.log(`✓ Inseriti ${seed.length} esercizi`);
}

async function findExId(db, name, side) {
  const row = await db.get(
    `SELECT id FROM exercises WHERE name = ? AND side = ? AND deleted_at IS NULL LIMIT 1`,
    name, side
  );
  return row ? row.id : null;
}

async function seedRoutinesIfEmpty(db) {
  const count = (await db.get('SELECT COUNT(*) AS n FROM routines WHERE deleted_at IS NULL')).n;
  if (count > 0) {
    console.log(`Seed routine saltato: ${count} routine già presenti.`);
    return;
  }
  console.log('Seed routine iniziali...');

  const routines = [
    {
      name: 'Risveglio 5 min',
      description: 'Sveglia il corpo in modo dolce: collo, spalle, schiena, anche.',
      items: [
        ['Rotazione lenta del collo', 'both'],
        ['Circonduzione spalle',      'both'],
        ['Cross-body stretch',        'dx'],
        ['Cross-body stretch',        'sx'],
        ['Cat-cow',                   'both'],
        ['Child\'s pose',             'both'],
        ['Butterfly',                 'both'],
        ['Cobra stretch',             'both']
      ]
    },
    {
      name: 'Schiena scrivania 10 min',
      description: 'Decompressione per chi sta seduto tutto il giorno.',
      items: [
        ['Rotazione lenta del collo',    'both'],
        ['Flessione laterale collo',     'dx'],
        ['Flessione laterale collo',     'sx'],
        ['Circonduzione spalle',         'both'],
        ['Cross-body stretch',           'dx'],
        ['Cross-body stretch',           'sx'],
        ['Cat-cow',                      'both'],
        ['Child\'s pose',                'both'],
        ['Rotazione lombare supina',     'dx'],
        ['Rotazione lombare supina',     'sx'],
        ['Cobra stretch',                'both'],
        ['Hip flexor lunge',             'dx'],
        ['Hip flexor lunge',             'sx']
      ]
    },
    {
      name: 'Gambe post-workout 8 min',
      description: 'Allungamento completo dopo una corsa o sessione gambe.',
      items: [
        ['Quadricipite in piedi',   'dx'],
        ['Quadricipite in piedi',   'sx'],
        ['Ischiocrurali seduto',    'both'],
        ['Butterfly',               'both'],
        ['Pigeon pose',             'dx'],
        ['Pigeon pose',             'sx'],
        ['Hip flexor lunge',        'dx'],
        ['Hip flexor lunge',        'sx'],
        ['Polpaccio al muro',       'dx'],
        ['Polpaccio al muro',       'sx']
      ]
    }
  ];

  for (const r of routines) {
    const routineId = crypto.randomUUID();
    await db.run(
      `INSERT INTO routines (id, name, description) VALUES (?, ?, ?)`,
      routineId, r.name, r.description
    );
    let pos = 0;
    let skipped = 0;
    for (const [exName, exSide] of r.items) {
      const exId = await findExId(db, exName, exSide);
      if (!exId) { skipped++; continue; }
      await db.run(
        `INSERT INTO routine_items
          (id, routine_id, exercise_id, position, rest_after_sec)
         VALUES (?, ?, ?, ?, 10)`,
        crypto.randomUUID(), routineId, exId, pos++
      );
    }
    console.log(`✓ "${r.name}" (${pos} esercizi${skipped ? `, ${skipped} saltati` : ''})`);
  }
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
  await seedRoutinesIfEmpty(db);

  console.log('\n✅ Setup completato.');
  console.log('  Copia .env.example in .env e avvia con: node server.js');
  console.log('  Apri:                                   http://localhost:3100\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Errore durante il setup:', err);
  process.exit(1);
});
