const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { isAuth } = require('./auth');

router.use(isAuth);

async function listZones(db) {
  return db.all('SELECT name, position FROM zones ORDER BY position, name');
}

// GET /api/zones — elenco zone ordinate
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    res.json(await listZones(db));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/zones/:name/usage — n. esercizi (non eliminati) che usano la zona
router.get('/:name/usage', async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get(
      `SELECT COUNT(*) AS count
         FROM exercise_zones ez
         JOIN exercises e ON e.id = ez.exercise_id
        WHERE ez.zone = ? AND e.deleted_at IS NULL`,
      req.params.name
    );
    res.json({ count: row.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/zones — aggiungi una zona
router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nome richiesto' });
    const db = await getDb();
    const exists = await db.get('SELECT name FROM zones WHERE lower(name) = lower(?)', name);
    if (exists) return res.status(400).json({ error: 'Zona già esistente' });
    const maxPos = (await db.get('SELECT MAX(position) AS p FROM zones')).p;
    await db.run('INSERT INTO zones (name, position) VALUES (?, ?)', name, (maxPos == null ? 0 : maxPos + 1));
    res.status(201).json(await listZones(db));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// PUT /api/zones/:name — rinomina (cascata su exercise_zones)
router.put('/:name', async (req, res) => {
  try {
    const oldName = req.params.name;
    const newName = String(req.body.name || '').trim();
    if (!newName) return res.status(400).json({ error: 'Nome richiesto' });
    const db = await getDb();
    const current = await db.get('SELECT name FROM zones WHERE name = ?', oldName);
    if (!current) return res.status(404).json({ error: 'Zona non trovata' });
    if (newName.toLowerCase() !== oldName.toLowerCase()) {
      const dup = await db.get('SELECT name FROM zones WHERE lower(name) = lower(?)', newName);
      if (dup) return res.status(400).json({ error: 'Zona già esistente' });
    }
    await db.run('UPDATE zones SET name = ? WHERE name = ?', newName, oldName);
    await db.run('UPDATE exercise_zones SET zone = ? WHERE zone = ?', newName, oldName);
    res.json(await listZones(db));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// DELETE /api/zones/:name — elimina (rimuove anche le assegnazioni)
router.delete('/:name', async (req, res) => {
  try {
    const db = await getDb();
    const current = await db.get('SELECT name FROM zones WHERE name = ?', req.params.name);
    if (!current) return res.status(404).json({ error: 'Zona non trovata' });
    await db.run('DELETE FROM exercise_zones WHERE zone = ?', req.params.name);
    await db.run('DELETE FROM zones WHERE name = ?', req.params.name);
    res.json(await listZones(db));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

module.exports = router;
