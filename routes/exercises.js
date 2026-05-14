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
// Le zone valide sono gestite dal DB (tabella zones, modificabile dal Profilo).
// Da zona → vecchio muscle_group (per derivare il valore NOT NULL e l'immagine):
// mappa statica best-effort; le zone aggiunte dall'utente ricadono sul fallback.
const ZONE_TO_GROUP = {
  'Collo e cervicale':                   'collo e spalle',
  'Spalle e cingolo scapolare':          'collo e spalle',
  'Braccia e polsi':                     'braccia e torace',
  'Petto':                               'braccia e torace',
  'Dorsale (schiena alta)':              'schiena',
  'Lombare (schiena bassa)':             'schiena',
  'Core e addome':                       'addominali',
  'Anche e flessori dell\'anca':         'glutei e gambe',
  'Glutei e piriforme':                  'glutei e gambe',
  'Quadricipiti':                        'glutei e gambe',
  'Ischiocrurali (femorali posteriori)': 'glutei e gambe',
  'Adduttori e inguine':                 'glutei e gambe',
  'Polpacci e caviglie':                 'glutei e gambe',
  'Catena posteriore completa':          'schiena'
};
const SIDES = ['both', 'dx', 'sx', 'bilaterale'];
const POSIZIONI = ['in piedi', 'da seduto', 'a terra'];
const MODALITA = ['tempo', 'ripetizioni'];
// Il campo 'level' nel DB resta (NOT NULL su DB esistenti) ma è deprecato:
// la UI non lo espone più. Scriviamo sempre 'easy' come valore dummy.
const LEVEL_DUMMY = 'easy';

// Insieme dei nomi zona validi dal DB.
async function loadValidZones(db) {
  const rows = await db.all('SELECT name FROM zones');
  return new Set(rows.map(r => r.name));
}

// zones può arrivare come array (campi ripetuti) o stringa separata da virgola.
function normalizeZones(raw, validSet) {
  let arr = raw == null ? [] : (Array.isArray(raw) ? raw : String(raw).split(','));
  return [...new Set(arr.map(z => String(z).trim()).filter(z => validSet.has(z)))];
}

// Sostituisce l'insieme di zone di un esercizio.
async function writeZones(db, exerciseId, zones) {
  await db.run('DELETE FROM exercise_zones WHERE exercise_id = ?', exerciseId);
  for (const z of zones) {
    await db.run('INSERT OR IGNORE INTO exercise_zones (exercise_id, zone) VALUES (?, ?)', exerciseId, z);
  }
}

// Attacca l'array zones a ciascuna riga esercizio.
async function attachZones(db, rows) {
  if (!rows.length) return rows;
  const all = await db.all('SELECT exercise_id, zone FROM exercise_zones');
  const byEx = {};
  for (const r of all) (byEx[r.exercise_id] = byEx[r.exercise_id] || []).push(r.zone);
  rows.forEach(r => { r.zones = byEx[r.id] || []; });
  return rows;
}

function parseForm(body, validZones) {
  const {
    name, description, side, duration_sec, notes, video_loop, posizione,
    modalita, reps_count
  } = body || {};
  const errors = [];
  if (!name || !String(name).trim()) errors.push('nome richiesto');
  // Zone multiple: almeno una richiesta. muscle_group è derivato dalla prima.
  const zones = normalizeZones(body && body.zones, validZones);
  if (!zones.length) errors.push('seleziona almeno una zona');
  const muscle_group = zones.length ? (ZONE_TO_GROUP[zones[0]] || 'addominali') : 'addominali';
  const safeModalita = MODALITA.includes(modalita) ? modalita : 'tempo';
  // In modalità ripetizioni la durata non è obbligatoria: si tiene comunque
  // un valore valido (default 30) per soddisfare il NOT NULL su duration_sec.
  let dur = parseInt(duration_sec, 10);
  if (safeModalita === 'tempo') {
    if (!dur || dur < 5 || dur > 600) errors.push('durata 5-600 secondi');
  } else {
    if (!dur || dur < 5 || dur > 600) dur = 30;
  }
  let reps = parseInt(reps_count, 10);
  if (safeModalita === 'ripetizioni') {
    if (!reps || reps < 1 || reps > 200) errors.push('ripetizioni 1-200');
  } else {
    reps = (reps && reps >= 1 && reps <= 200) ? reps : null;
  }
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
      posizione: safePosizione,
      modalita: safeModalita,
      reps_count: reps,
      zones
    }
  };
}

// GET /api/exercises?zones=A,B&posizione=...&q=...
router.get('/', isAuth, async (req, res) => {
  try {
    const db = await getDb();
    const where = ['deleted_at IS NULL'];
    const params = [];
    // Filtro zone multi-selezione: esercizi che hanno ALMENO UNA delle zone.
    if (req.query.zones) {
      const wanted = normalizeZones(req.query.zones, await loadValidZones(db));
      if (wanted.length) {
        where.push(`id IN (SELECT exercise_id FROM exercise_zones WHERE zone IN (${wanted.map(() => '?').join(',')}))`);
        params.push(...wanted);
      }
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
    await attachZones(db, rows);
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
    row.zones = (await db.all('SELECT zone FROM exercise_zones WHERE exercise_id = ?', row.id)).map(r => r.zone);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/exercises  (multipart: campi + opzionale "file")
router.post('/', isAuth, upload.single('file'), async (req, res) => {
  try {
    const db = await getDb();
    const { errors, data } = parseForm(req.body, await loadValidZones(db));
    if (errors.length) {
      if (req.file) removeImage(`/uploads/${req.file.filename}`);
      return res.status(400).json({ error: errors.join(', ') });
    }
    const id = crypto.randomUUID();
    let imagePath = null;
    if (req.file) {
      imagePath = isVideoFile(req.file)
        ? storeVideo(req.file.path, id, req.file)
        : await resizeAndStore(req.file.path, id);
    }

    await db.run(
      `INSERT INTO exercises
        (id, name, description, muscle_group, side, level, duration_sec, image_path, notes, video_loop, posizione, modalita, reps_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, data.name, data.description, data.muscle_group, data.side,
      LEVEL_DUMMY, data.duration_sec, imagePath, data.notes, data.video_loop, data.posizione,
      data.modalita, data.reps_count
    );
    await writeZones(db, id, data.zones);

    // M15 — clone bilaterale: se l'originale è dx/sx, crea automaticamente
    // il gemello con lato opposto e foto copiata (file distinto).
    if (data.side === 'dx' || data.side === 'sx') {
      const twinSide = data.side === 'dx' ? 'sx' : 'dx';
      const twinId = crypto.randomUUID();
      const twinImagePath = imagePath ? copyImage(imagePath, twinId) : null;
      await db.run(
        `INSERT INTO exercises
          (id, name, description, muscle_group, side, level, duration_sec, image_path, notes, video_loop, posizione, modalita, reps_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        twinId, data.name, data.description, data.muscle_group, twinSide,
        LEVEL_DUMMY, data.duration_sec, twinImagePath, data.notes, data.video_loop, data.posizione,
        data.modalita, data.reps_count
      );
      await writeZones(db, twinId, data.zones);
    }

    const row = await db.get('SELECT * FROM exercises WHERE id = ?', id);
    row.zones = data.zones;
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
    const { errors, data } = parseForm(req.body, await loadValidZones(db));
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
             posizione = ?, modalita = ?, reps_count = ?, updated_at = datetime('now')
       WHERE id = ?`,
      data.name, data.description, data.muscle_group, data.side,
      data.duration_sec, imagePath, data.notes, data.video_loop, data.posizione,
      data.modalita, data.reps_count, current.id
    );
    await writeZones(db, current.id, data.zones);
    const row = await db.get('SELECT * FROM exercises WHERE id = ?', current.id);
    row.zones = data.zones;
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
    const srcZones = (await db.all('SELECT zone FROM exercise_zones WHERE exercise_id = ?', src.id)).map(r => r.zone);
    const newId = crypto.randomUUID();
    const newImagePath = src.image_path ? copyImage(src.image_path, newId) : null;
    await db.run(
      `INSERT INTO exercises
        (id, name, description, muscle_group, side, level, duration_sec, image_path, notes, video_loop, posizione, modalita, reps_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId, `${src.name} (copia)`, src.description, src.muscle_group, src.side,
      LEVEL_DUMMY, src.duration_sec, newImagePath, src.notes, src.video_loop != null ? src.video_loop : 1,
      src.posizione || 'in piedi', src.modalita || 'tempo', src.reps_count != null ? src.reps_count : null
    );
    await writeZones(db, newId, srcZones);
    const row = await db.get('SELECT * FROM exercises WHERE id = ?', newId);
    row.zones = srcZones;
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
