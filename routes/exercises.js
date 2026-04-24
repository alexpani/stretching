const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDb } = require('../database/db');
const { isAuth } = require('./auth');
const { upload, resizeAndStore, removeImage } = require('../services/images');

const MUSCLE_GROUPS = [
  'collo e spalle',
  'schiena',
  'addominali',
  'glutei e gambe',
  'braccia e torace'
];
const SIDES = ['both', 'dx', 'sx'];
// Il campo 'level' nel DB resta (NOT NULL su DB esistenti) ma è deprecato:
// la UI non lo espone più. Scriviamo sempre 'easy' come valore dummy.
const LEVEL_DUMMY = 'easy';

function parseForm(body) {
  const {
    name, description, muscle_group, side, duration_sec, notes
  } = body || {};
  const errors = [];
  if (!name || !String(name).trim()) errors.push('nome richiesto');
  if (!MUSCLE_GROUPS.includes(muscle_group)) errors.push('gruppo muscolare non valido');
  const dur = parseInt(duration_sec, 10);
  if (!dur || dur < 5 || dur > 600) errors.push('durata 5-600 secondi');
  const safeSide = SIDES.includes(side) ? side : 'both';
  return {
    errors,
    data: {
      name: String(name || '').trim(),
      description: description ? String(description).trim() : null,
      muscle_group,
      side: safeSide,
      duration_sec: dur,
      notes: notes ? String(notes).trim() : null
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
    if (req.file) imagePath = await resizeAndStore(req.file.path, id);

    await db.run(
      `INSERT INTO exercises
        (id, name, description, muscle_group, side, level, duration_sec, image_path, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, data.name, data.description, data.muscle_group, data.side,
      LEVEL_DUMMY, data.duration_sec, imagePath, data.notes
    );
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
      imagePath = await resizeAndStore(req.file.path, current.id);
    } else if (req.body.remove_image === '1') {
      if (current.image_path) removeImage(current.image_path);
      imagePath = null;
    }

    await db.run(
      `UPDATE exercises
         SET name = ?, description = ?, muscle_group = ?, side = ?,
             duration_sec = ?, image_path = ?, notes = ?,
             updated_at = datetime('now')
       WHERE id = ?`,
      data.name, data.description, data.muscle_group, data.side,
      data.duration_sec, imagePath, data.notes, current.id
    );
    const row = await db.get('SELECT * FROM exercises WHERE id = ?', current.id);
    res.json(row);
  } catch (err) {
    console.error(err);
    if (req.file) removeImage(`/uploads/${req.file.filename}`);
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
