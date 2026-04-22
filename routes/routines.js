const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDb } = require('../database/db');
const { isAuth } = require('./auth');

router.use(isAuth);

async function loadItems(db, routineId) {
  return db.all(`
    SELECT ri.id, ri.routine_id, ri.exercise_id, ri.position,
           ri.duration_override_sec, ri.rest_after_sec,
           e.name, e.muscle_group, e.side, e.level,
           e.duration_sec AS exercise_duration_sec,
           e.image_path
    FROM routine_items ri
    JOIN exercises e ON e.id = ri.exercise_id
    WHERE ri.routine_id = ?
    ORDER BY ri.position ASC
  `, routineId);
}

function computeStats(items) {
  let total = 0;
  for (const it of items) {
    total += (it.duration_override_sec || it.exercise_duration_sec || 0);
    total += (it.rest_after_sec || 0);
  }
  // L'ultimo riposo va tolto (niente riposo dopo l'ultimo esercizio)
  if (items.length) total -= (items[items.length - 1].rest_after_sec || 0);
  return { items_total: items.length, duration_sec: Math.max(0, total) };
}

// GET /api/routines  — lista con stats
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const routines = await db.all(
      `SELECT * FROM routines WHERE deleted_at IS NULL ORDER BY updated_at DESC`
    );
    const result = [];
    for (const r of routines) {
      const items = await loadItems(db, r.id);
      const stats = computeStats(items);
      result.push({ ...r, ...stats });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/routines/:id  — dettaglio con items
router.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const routine = await db.get(
      `SELECT * FROM routines WHERE id = ? AND deleted_at IS NULL`,
      req.params.id
    );
    if (!routine) return res.status(404).json({ error: 'Non trovata' });
    const items = await loadItems(db, routine.id);
    const stats = computeStats(items);
    res.json({ ...routine, ...stats, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/routines  — crea routine vuota
router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nome richiesto' });
    const description = req.body.description ? String(req.body.description).trim() : null;
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO routines (id, name, description) VALUES (?, ?, ?)`,
      id, name, description
    );
    const row = await db.get('SELECT * FROM routines WHERE id = ?', id);
    res.status(201).json({ ...row, items_total: 0, duration_sec: 0, items: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// PUT /api/routines/:id  — rinomina / descrizione
router.put('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const current = await db.get(
      `SELECT * FROM routines WHERE id = ? AND deleted_at IS NULL`, req.params.id
    );
    if (!current) return res.status(404).json({ error: 'Non trovata' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nome richiesto' });
    const description = req.body.description ? String(req.body.description).trim() : null;
    await db.run(
      `UPDATE routines SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?`,
      name, description, current.id
    );
    const row = await db.get('SELECT * FROM routines WHERE id = ?', current.id);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// DELETE /api/routines/:id  — soft-delete
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get(
      `SELECT id FROM routines WHERE id = ? AND deleted_at IS NULL`, req.params.id
    );
    if (!row) return res.status(404).json({ error: 'Non trovata' });
    await db.run(`UPDATE routines SET deleted_at = datetime('now') WHERE id = ?`, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/routines/:id/duplicate
router.post('/:id/duplicate', async (req, res) => {
  try {
    const db = await getDb();
    const src = await db.get(
      `SELECT * FROM routines WHERE id = ? AND deleted_at IS NULL`, req.params.id
    );
    if (!src) return res.status(404).json({ error: 'Non trovata' });
    const items = await loadItems(db, src.id);
    const newId = crypto.randomUUID();
    await db.run(
      `INSERT INTO routines (id, name, description) VALUES (?, ?, ?)`,
      newId, `${src.name} (copia)`, src.description
    );
    for (const it of items) {
      await db.run(
        `INSERT INTO routine_items
          (id, routine_id, exercise_id, position, duration_override_sec, rest_after_sec)
         VALUES (?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(), newId, it.exercise_id, it.position,
        it.duration_override_sec, it.rest_after_sec
      );
    }
    const row = await db.get('SELECT * FROM routines WHERE id = ?', newId);
    const newItems = await loadItems(db, newId);
    const stats = computeStats(newItems);
    res.status(201).json({ ...row, ...stats, items: newItems });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/routines/:id/items  — aggiungi esercizio in coda
router.post('/:id/items', async (req, res) => {
  try {
    const db = await getDb();
    const routine = await db.get(
      `SELECT id FROM routines WHERE id = ? AND deleted_at IS NULL`, req.params.id
    );
    if (!routine) return res.status(404).json({ error: 'Routine non trovata' });
    const exercise_id = String(req.body.exercise_id || '');
    const ex = await db.get(
      `SELECT id FROM exercises WHERE id = ? AND deleted_at IS NULL`, exercise_id
    );
    if (!ex) return res.status(400).json({ error: 'Esercizio non valido' });
    const duration_override_sec = req.body.duration_override_sec
      ? parseInt(req.body.duration_override_sec, 10) : null;
    const rest_after_sec = req.body.rest_after_sec != null
      ? parseInt(req.body.rest_after_sec, 10) : 10;

    const lastPos = (await db.get(
      `SELECT MAX(position) AS p FROM routine_items WHERE routine_id = ?`, routine.id
    )).p;
    const position = (lastPos == null ? 0 : lastPos + 1);
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO routine_items
        (id, routine_id, exercise_id, position, duration_override_sec, rest_after_sec)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, routine.id, exercise_id, position, duration_override_sec, rest_after_sec
    );
    await db.run(`UPDATE routines SET updated_at = datetime('now') WHERE id = ?`, routine.id);
    const items = await loadItems(db, routine.id);
    res.status(201).json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// PUT /api/routines/:id/items/:itemId  — modifica override/riposo
router.put('/:id/items/:itemId', async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get(
      `SELECT id FROM routine_items WHERE id = ? AND routine_id = ?`,
      req.params.itemId, req.params.id
    );
    if (!row) return res.status(404).json({ error: 'Item non trovato' });
    const duration_override_sec = req.body.duration_override_sec
      ? parseInt(req.body.duration_override_sec, 10) : null;
    const rest_after_sec = req.body.rest_after_sec != null
      ? parseInt(req.body.rest_after_sec, 10) : 10;
    await db.run(
      `UPDATE routine_items SET duration_override_sec = ?, rest_after_sec = ? WHERE id = ?`,
      duration_override_sec, rest_after_sec, req.params.itemId
    );
    await db.run(`UPDATE routines SET updated_at = datetime('now') WHERE id = ?`, req.params.id);
    const items = await loadItems(db, req.params.id);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// DELETE /api/routines/:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get(
      `SELECT id FROM routine_items WHERE id = ? AND routine_id = ?`,
      req.params.itemId, req.params.id
    );
    if (!row) return res.status(404).json({ error: 'Item non trovato' });
    await db.run(`DELETE FROM routine_items WHERE id = ?`, req.params.itemId);
    // compatta posizioni
    const remaining = await db.all(
      `SELECT id FROM routine_items WHERE routine_id = ? ORDER BY position ASC`, req.params.id
    );
    for (let i = 0; i < remaining.length; i++) {
      await db.run(`UPDATE routine_items SET position = ? WHERE id = ?`, i, remaining[i].id);
    }
    await db.run(`UPDATE routines SET updated_at = datetime('now') WHERE id = ?`, req.params.id);
    const items = await loadItems(db, req.params.id);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// PUT /api/routines/:id/reorder  body: { order: [itemId, ...] }
router.put('/:id/reorder', async (req, res) => {
  try {
    const db = await getDb();
    const routine = await db.get(
      `SELECT id FROM routines WHERE id = ? AND deleted_at IS NULL`, req.params.id
    );
    if (!routine) return res.status(404).json({ error: 'Non trovata' });
    const order = Array.isArray(req.body.order) ? req.body.order : null;
    if (!order) return res.status(400).json({ error: 'order[] richiesto' });

    const existing = await db.all(
      `SELECT id FROM routine_items WHERE routine_id = ?`, routine.id
    );
    const existingSet = new Set(existing.map(r => r.id));
    if (order.length !== existingSet.size || order.some(id => !existingSet.has(id))) {
      return res.status(400).json({ error: 'order[] non corrisponde agli item correnti' });
    }
    for (let i = 0; i < order.length; i++) {
      await db.run(`UPDATE routine_items SET position = ? WHERE id = ?`, i, order[i]);
    }
    await db.run(`UPDATE routines SET updated_at = datetime('now') WHERE id = ?`, routine.id);
    const items = await loadItems(db, routine.id);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

module.exports = router;
