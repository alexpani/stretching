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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo immagini sono accettate'));
  }
});

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

module.exports = { upload, resizeAndStore, removeImage };
