const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

// API read-only no-auth per consumo da Health Tracker (LAN).
// Non montare questo router dietro isAuth: il backend health-tracker
// consuma via httpx senza sessione.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Tipo workout HealthKit fisso per ora (vedi docs/REFERENCE_NOTES.md
// sezione 15, domanda #7). Valori possibili: "flexibility", "mindAndBody".
const WORKOUT_TYPE = 'flexibility';

function toWorkout(s) {
  return {
    id: s.id,
    routine_id: s.routine_id || null,
    routine_name: s.routine_name || null,
    started_at: s.started_at,
    ended_at: s.ended_at,
    duration_sec: s.duration_sec,
    items_total: s.items_total,
    items_skipped: s.items_skipped || 0,
    notes: s.notes || null,
    workout_activity_type: WORKOUT_TYPE
  };
}

// GET /api/external/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/sessions', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (from && !DATE_RE.test(from)) {
      return res.status(400).json({ error: 'from: YYYY-MM-DD richiesto' });
    }
    if (to && !DATE_RE.test(to)) {
      return res.status(400).json({ error: 'to: YYYY-MM-DD richiesto' });
    }
    const db = await getDb();
    const where = [];
    const params = [];
    if (from) { where.push('started_at >= ?'); params.push(`${from}T00:00:00Z`); }
    if (to)   { where.push('started_at <= ?'); params.push(`${to}T23:59:59Z`);   }
    const sql = `
      SELECT * FROM sessions
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY started_at ASC
    `;
    const rows = await db.all(sql, ...params);
    res.json(rows.map(toWorkout));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/external/sessions/:id
router.get('/sessions/:id', async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get('SELECT * FROM sessions WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Non trovata' });
    res.json(toWorkout(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/external/routines  — elenco routine attive
router.get('/routines', async (req, res) => {
  try {
    const db = await getDb();
    const routines = await db.all(
      `SELECT id, name, description, created_at, updated_at
       FROM routines WHERE deleted_at IS NULL ORDER BY updated_at DESC`
    );
    const result = [];
    for (const r of routines) {
      const items = await db.all(`
        SELECT ri.duration_override_sec, ri.rest_after_sec, e.duration_sec AS exercise_duration_sec
        FROM routine_items ri
        JOIN exercises e ON e.id = ri.exercise_id
        WHERE ri.routine_id = ?
        ORDER BY ri.position ASC
      `, r.id);
      let total = 0;
      for (const it of items) {
        total += (it.duration_override_sec || it.exercise_duration_sec || 0);
        total += (it.rest_after_sec || 0);
      }
      if (items.length) total -= (items[items.length - 1].rest_after_sec || 0);
      result.push({
        ...r,
        items_total: items.length,
        duration_sec: Math.max(0, total)
      });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/external/exercises  — catalogo esercizi attivi
router.get('/exercises', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT id, name, description, muscle_group, side, level, duration_sec, image_path
       FROM exercises WHERE deleted_at IS NULL ORDER BY muscle_group, name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

module.exports = router;
