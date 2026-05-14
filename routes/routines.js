const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDb } = require('../database/db');
const { isAuth } = require('./auth');
const { upload, resizeAndStoreCover, removeImage } = require('../services/images');

router.use(isAuth);

// Restituisce il nome "speculare" invertendo destro/sinistro e destra/sinistra
// (parole intere, case-insensitive). Serve a trovare il gemello del lato opposto
// quando i due esercizi hanno nomi descrittivi anziché identici.
function mirrorSideInName(name) {
  const map = {
    destro: 'sinistro', sinistro: 'destro',
    destra: 'sinistra', sinistra: 'destra'
  };
  return String(name || '').replace(/\b(destr[oa]|sinistr[oa])\b/gi, (m) => {
    const swapped = map[m.toLowerCase()];
    return swapped ? swapped : m;
  });
}

async function loadItems(db, routineId) {
  return db.all(`
    SELECT ri.id, ri.routine_id, ri.exercise_id, ri.position,
           ri.duration_override_sec, ri.rest_after_sec,
           e.name, e.description, e.muscle_group, e.side, e.level,
           e.duration_sec AS exercise_duration_sec,
           e.image_path, e.notes, e.video_loop, e.updated_at
    FROM routine_items ri
    JOIN exercises e ON e.id = ri.exercise_id
    WHERE ri.routine_id = ?
    ORDER BY ri.position ASC
  `, routineId);
}

// Parse del campo rest_standard_sec:
//   null | '' | undefined → null (= nessun override, usa item-per-item)
//   0..600 → intero
//   altri → null (difensivo)
function parseRestStandard(v) {
  if (v === null || v === undefined || v === '' || v === 'null') return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0 || n > 600) return null;
  return n;
}

function computeStats(items, restStandard) {
  let total = 0;
  const hasOverride = restStandard != null;
  for (const it of items) {
    total += (it.duration_override_sec || it.exercise_duration_sec || 0);
    const r = hasOverride ? restStandard : (it.rest_after_sec || 0);
    total += r;
  }
  // L'ultimo riposo va tolto (niente riposo dopo l'ultimo esercizio)
  if (items.length) {
    const last = items[items.length - 1];
    const lastRest = hasOverride ? restStandard : (last.rest_after_sec || 0);
    total -= lastRest;
  }
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
      const stats = computeStats(items, r.rest_standard_sec);
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
    const stats = computeStats(items, routine.rest_standard_sec);
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
    const restStd = parseRestStandard(req.body.rest_standard_sec);
    const voiceGuide = req.body.voice_guide ? 1 : 0;
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO routines (id, name, description, rest_standard_sec, voice_guide)
       VALUES (?, ?, ?, ?, ?)`,
      id, name, description, restStd, voiceGuide
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
    const restStd = parseRestStandard(req.body.rest_standard_sec);
    const voiceGuide = req.body.voice_guide ? 1 : 0;
    await db.run(
      `UPDATE routines
         SET name = ?, description = ?, rest_standard_sec = ?, voice_guide = ?, updated_at = datetime('now')
       WHERE id = ?`,
      name, description, restStd, voiceGuide, current.id
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
      `INSERT INTO routines (id, name, description, rest_standard_sec, voice_guide)
       VALUES (?, ?, ?, ?, ?)`,
      newId, `${src.name} (copia)`, src.description, src.rest_standard_sec, src.voice_guide || 0
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
    const stats = computeStats(newItems, row.rest_standard_sec);
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
      `SELECT id, name, side FROM exercises WHERE id = ? AND deleted_at IS NULL`, exercise_id
    );
    if (!ex) return res.status(400).json({ error: 'Esercizio non valido' });
    const duration_override_sec = req.body.duration_override_sec
      ? parseInt(req.body.duration_override_sec, 10) : null;
    const rest_after_sec = req.body.rest_after_sec != null
      ? parseInt(req.body.rest_after_sec, 10) : 10;

    // Lista degli esercizi da inserire: l'esercizio scelto e, se è dx/sx,
    // anche il gemello del lato opposto subito a seguire.
    const toInsert = [ex.id];
    if (ex.side === 'dx' || ex.side === 'sx') {
      const twinSide = ex.side === 'dx' ? 'sx' : 'dx';
      // Il gemello può avere lo stesso nome (esercizi auto-clonati) oppure
      // un nome "speculare" con destro/sinistra invertiti.
      const mirrored = mirrorSideInName(ex.name);
      const twin = await db.get(
        `SELECT id FROM exercises
           WHERE side = ? AND deleted_at IS NULL
             AND lower(name) IN (lower(?), lower(?))
           LIMIT 1`,
        twinSide, ex.name, mirrored
      );
      if (twin) toInsert.push(twin.id);
    }

    const lastPos = (await db.get(
      `SELECT MAX(position) AS p FROM routine_items WHERE routine_id = ?`, routine.id
    )).p;
    let position = (lastPos == null ? 0 : lastPos + 1);
    for (const exId of toInsert) {
      await db.run(
        `INSERT INTO routine_items
          (id, routine_id, exercise_id, position, duration_override_sec, rest_after_sec)
         VALUES (?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(), routine.id, exId, position, duration_override_sec, rest_after_sec
      );
      position++;
    }
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

// PUT /api/routines/:id/cover  — upload immagine di copertina (multipart "file")
router.put('/:id/cover', upload.single('file'), async (req, res) => {
  try {
    const db = await getDb();
    const routine = await db.get(
      `SELECT * FROM routines WHERE id = ? AND deleted_at IS NULL`, req.params.id
    );
    if (!routine) {
      if (req.file) removeImage(`/uploads/${req.file.filename}`);
      return res.status(404).json({ error: 'Piano non trovato' });
    }
    if (!req.file) return res.status(400).json({ error: 'File mancante' });

    if (routine.cover_image_path) removeImage(routine.cover_image_path);
    const newPath = await resizeAndStoreCover(req.file.path, routine.id);
    await db.run(
      `UPDATE routines SET cover_image_path = ?, updated_at = datetime('now') WHERE id = ?`,
      newPath, routine.id
    );
    const updated = await db.get('SELECT * FROM routines WHERE id = ?', routine.id);
    res.json(updated);
  } catch (err) {
    console.error(err);
    if (req.file) removeImage(`/uploads/${req.file.filename}`);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// DELETE /api/routines/:id/cover  — rimuovi immagine di copertina
router.delete('/:id/cover', async (req, res) => {
  try {
    const db = await getDb();
    const routine = await db.get(
      `SELECT * FROM routines WHERE id = ? AND deleted_at IS NULL`, req.params.id
    );
    if (!routine) return res.status(404).json({ error: 'Piano non trovato' });
    if (routine.cover_image_path) removeImage(routine.cover_image_path);
    await db.run(
      `UPDATE routines SET cover_image_path = NULL, updated_at = datetime('now') WHERE id = ?`,
      routine.id
    );
    res.json({ ok: true });
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
