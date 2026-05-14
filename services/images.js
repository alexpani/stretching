const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer: salva su disco con nome temporaneo. Il resize avviene nell'handler.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `stretch-tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB (immagini o video brevi)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Sono accettati solo immagini o video'));
  }
});

const VIDEO_EXT_BY_MIME = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'video/ogg': '.ogv'
};

function isVideoFile(file) {
  return !!(file && file.mimetype && file.mimetype.startsWith('video/'));
}

// Sposta il video temp in stretch-<id>.<ext> mantenendo il formato originale
// (no transcoding: serve ffmpeg, lo evitiamo finché non necessario).
function storeVideo(tmpPath, id, file) {
  const ext = VIDEO_EXT_BY_MIME[file.mimetype]
    || (path.extname(file.originalname) || '.mp4').toLowerCase();
  const outName = `stretch-${id}${ext}`;
  const outPath = path.join(uploadsDir, outName);
  fs.renameSync(tmpPath, outPath);
  return `/uploads/${outName}`;
}

// Ridimensiona il file temp a lato lungo 1024 (JPEG 85%), cancella il temp,
// ritorna il path pubblico da salvare in DB.
async function resizeAndStore(tmpPath, id) {
  const outName = `stretch-${id}.jpg`;
  const outPath = path.join(uploadsDir, outName);
  await sharp(tmpPath)
    .rotate() // rispetta l'orientamento EXIF
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(outPath);
  try { fs.unlinkSync(tmpPath); } catch (_) {}
  return `/uploads/${outName}`;
}

// Rimuove il file puntato da image_path (se esiste).
function removeImage(imagePath) {
  if (!imagePath) return;
  const base = path.basename(imagePath);
  const full = path.join(uploadsDir, base);
  try { fs.unlinkSync(full); } catch (_) {}
}

// Copia un file esistente (stretch-<srcId>.jpg) in stretch-<newId>.jpg e
// ritorna il nuovo image_path. Usato per il clone bilaterale degli esercizi.
function copyImage(srcImagePath, newId) {
  if (!srcImagePath) return null;
  const srcFull = path.join(uploadsDir, path.basename(srcImagePath));
  if (!fs.existsSync(srcFull)) return null;
  // Preserva l'estensione originale (jpg per foto, mp4/webm/... per video).
  const ext = (path.extname(srcImagePath) || '.jpg').toLowerCase();
  const outName = `stretch-${newId}${ext}`;
  const outFull = path.join(uploadsDir, outName);
  fs.copyFileSync(srcFull, outFull);
  return `/uploads/${outName}`;
}

// Copia la cover di un piano in cover-<newRoutineId>.<ext>. Usato dal duplica piano.
function copyCoverImage(srcImagePath, newRoutineId) {
  if (!srcImagePath) return null;
  const srcFull = path.join(uploadsDir, path.basename(srcImagePath));
  if (!fs.existsSync(srcFull)) return null;
  const ext = (path.extname(srcImagePath) || '.jpg').toLowerCase();
  const outName = `cover-${newRoutineId}${ext}`;
  const outFull = path.join(uploadsDir, outName);
  fs.copyFileSync(srcFull, outFull);
  return `/uploads/${outName}`;
}

// Variante per le cover dei piani: 16:9, fit 'cover' centrato. File chiamato
// cover-<routineId>.jpg. Stesso pattern naming → soft-delete piani non rimuove
// l'immagine (coerente con esercizi).
async function resizeAndStoreCover(tmpPath, routineId) {
  const outName = `cover-${routineId}.jpg`;
  const outPath = path.join(uploadsDir, outName);
  await sharp(tmpPath)
    .rotate()
    .resize({ width: 1280, height: 720, fit: 'cover', position: 'center' })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(outPath);
  try { fs.unlinkSync(tmpPath); } catch (_) {}
  return `/uploads/${outName}`;
}

module.exports = { upload, resizeAndStore, removeImage, copyImage, copyCoverImage, resizeAndStoreCover, storeVideo, isVideoFile };
