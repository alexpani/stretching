const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDb } = require('../database/db');
const { isAuth } = require('./auth');
const { upload, resizeAndStore, removeImage, copyImage, storeVideo, isVideoFile } = require('../services/images');

const MUSCLE_GROUPS = [
  'collo e spalle',
  'schiena',
  'addominali',
  'glutei e gambe',
  'braccia e torace'
];
const SIDES = ['both', 'dx', 'sx', 'bilaterale'];
const POSIZIONI = ['in piedi', 'da seduto', 'a terra'];
// Il campo 'level' nel DB resta (NOT NULL su DB esistenti) ma è deprecato:
// la UI non lo espone più. Scriviamo sempre 'easy' come valore dummy.
const LEVEL_DUMMY = 'easy';

function parseForm(body) {
  const {
    name, description, muscle_group, side, duration_sec, notes, video_loop, posizione
  } = body || {};
  const errors = [];
  if (!name || !String(name).trim()) errors.push('nome richiesto');
  if (!MUSCLE_GROUPS.includes(muscle_group)) errors.push('gruppo muscolare non valido');
  const dur = parseInt(duration_sec, 10);
  if (!dur || dur < 5 || dur > 600) errors.push('durata 5-600 secondi');
  const safeSide = SIDES.includes(side) ? side : 'both';
  const safePosizione = POSIZIONI.includes(posizione) ? posizione : 'in piedi';
  // Accetta '1'/'0', 'true'/'false', undefined → default 1 (loop)
  const loopVal = (video_loop === undefined || video_loop === null || video_loop === '')
    ? 1
    : (video_loop === '0' || video_loop === 'false' || video_loop === false ? 0 : 1);
  return {
    errors,
    data: {
      name: String(name || '').trim(),
      description: description ? String(description).trim() : null,
      muscle_group,
      side: safeSide,
      duration_sec: dur,
      notes: notes ? String(notes).trim() : null,
      video_loop: loopVal,
      posizione: safePosizione
    }
  };
}

// GET /api/exercises?muscle_group=...&q=...
router.get('/', isAuth, async (req, res) => {
  try {
    const db = await getDb();
    const where = ['deleted_at IS NULL'];
    const params = [];
    if (req.query.muscle_group && MUSCLE_GROUPS.includes(req.query.muscle_group)) {
      where.push('muscle_group = ?'); params.push(req.query.muscle_group);
    }
    if (req.query.posizione && POSIZIONI.includes(req.query.posizione)) {
      where.push('posizione = ?'); params.push(req.query.posizione);
    }
    if (req.query.q) {
      where.push('(name LIKE ? OR description LIKE ?)');
      const q = `%${req.query.q}%`;
      params.push(q, q);
    }
    const rows = await db.all(
      `SELECT * FROM exercises WHERE ${where.join(' AND ')} ORDER BY muscle_group, name`,
      ...params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/exercises/:id
router.get('/:id', isAuth, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get(
      'SELECT * FROM exercises WHERE id = ? AND deleted_at IS NULL',
      req.params.id
    );
    if (!row) return res.status(404).json({ error: 'Non trovato' });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/exercises  (multipart: campi + opzionale "file")
router.post('/', isAuth, upload.single('file'), async (req, res) => {
  try {
    const { errors, data } = parseForm(req.body);
    if (errors.length) {
      if (req.file) removeImage(`/uploads/${req.file.filename}`);
      return res.status(400).json({ error: errors.join(', ') });
    }
    const db = await getDb();
    const id = crypto.randomUUID();
    let imagePath = null;
    if (req.file) {
      imagePath = isVideoFile(req.file)
        ? storeVideo(req.file.path, id, req.file)
        : await resizeAndStore(req.file.path, id);
    }

    await db.run(
      `INSERT INTO exercises
        (id, name, description, muscle_group, side, level, duration_sec, image_path, notes, video_loop, posizione)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, data.name, data.description, data.muscle_group, data.side,
      LEVEL_DUMMY, data.duration_sec, imagePath, data.notes, data.video_loop, data.posizione
    );

    // M15 — clone bilaterale: se l'originale è dx/sx, crea automaticamente
    // il gemello con lato opposto e foto copiata (file distinto).
    if (data.side === 'dx' || data.side === 'sx') {
      const twinSide = data.side === 'dx' ? 'sx' : 'dx';
      const twinId = crypto.randomUUID();
      const twinImagePath = imagePath ? copyImage(imagePath, twinId) : null;
      await db.run(
        `INSERT INTO exercises
          (id, name, description, muscle_group, side, level, duration_sec, image_path, notes, video_loop, posizione)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        twinId, data.name, data.description, data.muscle_group, twinSide,
        LEVEL_DUMMY, data.duration_sec, twinImagePath, data.notes, data.video_loop, data.posizione
      );
    }

    const row = await db.get('SELECT * FROM exercises WHERE id = ?', id);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    if (req.file) removeImage(`/uploads/${req.file.filename}`);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// PUT /api/exercises/:id  (multipart: campi + opzionale "file" o remove_image=1)
router.put('/:id', isAuth, upload.single('file'), async (req, res) => {
  try {
    const db = await getDb();
    const current = await db.get(
      'SELECT * FROM exercises WHERE id = ? AND deleted_at IS NULL',
      req.params.id
    );
    if (!current) {
      if (req.file) removeImage(`/uploads/${req.file.filename}`);
      return res.status(404).json({ error: 'Non trovato' });
    }
    const { errors, data } = parseForm(req.body);
    if (errors.length) {
      if (req.file) removeImage(`/uploads/${req.file.filename}`);
      return res.status(400).json({ error: errors.join(', ') });
    }

    let imagePath = current.image_path;
    if (req.file) {
      if (current.image_path) removeImage(current.image_path);
      imagePath = isVideoFile(req.file)
        ? storeVideo(req.file.path, current.id, req.file)
        : await resizeAndStore(req.file.path, current.id);
    } else if (req.body.remove_image === '1') {
      if (current.image_path) removeImage(current.image_path);
      imagePath = null;
    }

    await db.run(
      `UPDATE exercises
         SET name = ?, description = ?, muscle_group = ?, side = ?,
             duration_sec = ?, image_path = ?, notes = ?, video_loop = ?,
             posizione = ?, updated_at = datetime('now')
       WHERE id = ?`,
      data.name, data.description, data.muscle_group, data.side,
      data.duration_sec, imagePath, data.notes, data.video_loop, data.posizione, current.id
    );
    const row = await db.get('SELECT * FROM exercises WHERE id = ?', current.id);
    res.json(row);
  } catch (err) {
    console.error(err);
    if (req.file) removeImage(`/uploads/${req.file.filename}`);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/exercises/:id/duplicate
router.post('/:id/duplicate', isAuth, async (req, res) => {
  try {
    const db = await getDb();
    const src = await db.get(
      'SELECT * FROM exercises WHERE id = ? AND deleted_at IS NULL',
      req.params.id
    );
    if (!src) return res.status(404).json({ error: 'Non trovato' });
    const newId = crypto.randomUUID();
    const newImagePath = src.image_path ? copyImage(src.image_path, newId) : null;
    await db.run(
      `INSERT INTO exercises
        (id, name, description, muscle_group, side, level, duration_sec, image_path, notes, video_loop, posizione)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId, `${src.name} (copia)`, src.description, src.muscle_group, src.side,
      LEVEL_DUMMY, src.duration_sec, newImagePath, src.notes, src.video_loop != null ? src.video_loop : 1,
      src.posizione || 'in piedi'
    );
    const row = await db.get('SELECT * FROM exercises WHERE id = ?', newId);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/exercises/:id/routines — routine (non eliminate) che usano l'esercizio
router.get('/:id/routines', isAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT DISTINCT r.id, r.name
         FROM routine_items ri
         JOIN routines r ON r.id = ri.routine_id
        WHERE ri.exercise_id = ? AND r.deleted_at IS NULL
        ORDER BY r.name`,
      req.params.id
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// DELETE /api/exercises/:id  — soft-delete
router.delete('/:id', isAuth, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get(
      'SELECT id FROM exercises WHERE id = ? AND deleted_at IS NULL',
      req.params.id
    );
    if (!row) return res.status(404).json({ error: 'Non trovato' });
    await db.run(
      `UPDATE exercises SET deleted_at = datetime('now') WHERE id = ?`,
      req.params.id
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

module.exports = router;
