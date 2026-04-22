const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDb } = require('../database/db');
const { isAuth } = require('./auth');

router.use(isAuth);

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function validate(body) {
  const errors = [];
  const routine_id   = body.routine_id   || null;
  const routine_name = body.routine_name ? String(body.routine_name).trim() : null;
  const started_at   = String(body.started_at || '').trim();
  const ended_at     = String(body.ended_at || '').trim();
  const duration_sec = parseInt(body.duration_sec, 10);
  const items_total  = parseInt(body.items_total, 10);
  const items_skipped = parseInt(body.items_skipped, 10) || 0;
  const notes        = body.notes ? String(body.notes).trim() : null;

  if (!ISO_RE.test(started_at)) errors.push('started_at: ISO 8601 richiesto');
  if (!ISO_RE.test(ended_at))   errors.push('ended_at: ISO 8601 richiesto');
  if (!Number.isFinite(duration_sec) || duration_sec < 0) errors.push('duration_sec invalido');
  if (!Number.isFinite(items_total) || items_total < 0)  errors.push('items_total invalido');

  return { errors, data: {
    routine_id, routine_name, started_at, ended_at, duration_sec,
    items_total, items_skipped, notes
  }};
}

// GET /api/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=N
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const where = [];
    const params = [];
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (DATE_RE.test(req.query.from || '')) {
      where.push('started_at >= ?'); params.push(req.query.from + 'T00:00:00Z');
    }
    if (DATE_RE.test(req.query.to || '')) {
      where.push('started_at <= ?'); params.push(req.query.to + 'T23:59:59Z');
    }
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
    const sql = `
      SELECT * FROM sessions
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY started_at DESC
      LIMIT ?
    `;
    params.push(limit);
    const rows = await db.all(sql, ...params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/sessions/:id
router.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get('SELECT * FROM sessions WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Non trovata' });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/sessions
router.post('/', async (req, res) => {
  try {
    const { errors, data } = validate(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join(', ') });

    const db = await getDb();
    // Se routine_id è fornito ma la routine non esiste più, non bloccare:
    // la denormalizzazione di routine_name sopravvive al delete (by design).
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO sessions
        (id, routine_id, routine_name, started_at, ended_at, duration_sec,
         items_total, items_skipped, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, data.routine_id, data.routine_name, data.started_at, data.ended_at,
      data.duration_sec, data.items_total, data.items_skipped, data.notes
    );
    const row = await db.get('SELECT * FROM sessions WHERE id = ?', id);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// DELETE /api/sessions/:id (hard-delete: il diario sessioni è personale,
// niente motivi per tenere fantasmi)
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get('SELECT id FROM sessions WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Non trovata' });
    await db.run('DELETE FROM sessions WHERE id = ?', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

module.exports = router;
