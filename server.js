require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3100;

// Fidati del reverse proxy (Nginx Proxy Manager in produzione)
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'stretching-secret-cambiami',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 giorni
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Endpoint di salute minimale (utile per curl/monitor da LXC)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'stretching', version: require('./package.json').version });
});

// Auth: espone /login, /logout, /api/me (montato su '/' come nel diario)
const authRoutes = require('./routes/auth');
app.use('/', authRoutes);

// I router di dominio arriveranno nelle milestone successive:
//   M3  → ./routes/exercises
//   M4  → ./routes/routines
//   M5b → ./routes/sessions
//   M6  → ./routes/settings
//   M7  → ./routes/external

// SPA fallback: tutto ciò che non è /api/* → index.html
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.listen(PORT, () => {
  console.log(`Stretching avviato su http://localhost:${PORT}`);
});
