# Stretching — Guida al deploy su LXC Proxmox

Questa guida descrive il deploy iniziale su un container LXC dedicato dietro Nginx Proxy Manager (NPM), seguendo lo stesso pattern del `diario-alimentare`.

## Prerequisiti

- Container LXC Debian 12 / Ubuntu 22.04 su Proxmox con IP LAN (es. `192.168.68.XXX`).
- 1 GB RAM, 2 GB disco, 1 vCPU sono più che sufficienti.
- Accesso SSH `root` al container.
- Nginx Proxy Manager già in esecuzione su un altro LXC del tuo setup.
- Record DNS `stretching.activeproxy.it` già puntato all'IP pubblico (o al tuo reverse tunnel) e risolvibile.
- GitHub Personal Access Token (PAT) con scope `Contents: Read` sul repo `alexpani/stretching`.

## 1. Installazione

Sul Mac:

```bash
# Clona il tuo repo e aggiungi il token all'URL (solo per il primo fetch da LXC)
# oppure salta e fallo direttamente da install.sh via prompt
```

Sull'LXC, come root:

```bash
# Il token viene passato via URL solo la prima volta; install.sh farà il clone:
git clone "https://alexpani:${PAT}@github.com/alexpani/stretching.git" /tmp/stretching-bootstrap
sudo bash /tmp/stretching-bootstrap/install.sh
rm -rf /tmp/stretching-bootstrap
```

Lo script chiede:

- porta HTTP (default **3100**),
- username admin (default `admin`),
- password admin (confermata due volte),
- genera `SESSION_SECRET` random.

Al termine:

- crea utente di sistema `stretchapp`,
- installa Node 22, PM2, clona il repo in `/opt/stretching`,
- `npm ci --omit=dev`, genera `.env` (chmod 600), esegue `node setup.js` (seed esercizi + routine d'esempio),
- configura PM2 con `ecosystem.config.js`, avvia come `stretchapp`, abilita `pm2 startup systemd` per restart al boot,
- apre `ufw` sulla porta scelta se presente.

> ⚠️ L'URL del remote contiene il token in chiaro. Se il primo bootstrap lo lasciasse embedded, usa subito `rotate-lxc-token.sh` per impostarne uno "lungo" senza tracce nella history.

## 2. Nginx Proxy Manager

In NPM → **Hosts → Proxy Hosts → Add Proxy Host**:

### Details
- **Domain Names**: `stretching.activeproxy.it`
- **Scheme**: `http`
- **Forward Hostname / IP**: `<IP-LXC-stretching>`
- **Forward Port**: `3100` (o quanto scelto in install.sh)
- **Cache Assets**: **off** (il service worker gestisce la cache client-side)
- **Block Common Exploits**: on
- **Websockets Support**: off (non ne usiamo)

### SSL
- **SSL Certificate**: *Request a new SSL Certificate* (Let's Encrypt)
- **Force SSL**: on
- **HTTP/2 Support**: on
- **HSTS Enabled**: on

### Advanced (opzionale)
Se vuoi imporre un limite dimensione upload più alto di default:

```nginx
client_max_body_size 10m;
```

Dopo `Save`, testa l'URL: `https://stretching.activeproxy.it` → deve mostrare la login screen.

## 3. Aggiornamenti futuri

Dal Mac:

```bash
git push                                   # pusha le modifiche al repo
ssh root@<IP-LXC-stretching> bash /opt/stretching/update.sh
```

Lo script `update.sh`:

1. `git pull --ff-only` come `stretchapp`,
2. `npm ci --omit=dev --silent`,
3. `pm2 restart stretching` (zero downtime tra i due secondi del restart).

## 4. Rotazione del GitHub PAT

Quando il token è in scadenza:

```bash
# Sul Mac:
LXC_HOST=root@<IP-LXC-stretching> bash rotate-lxc-token.sh
```

Il token nuovo viene letto via prompt silenzioso, passato via SSH su stdin (mai in argv né in history) e scritto solo in `.git/config` di `stretchapp`. Dopo la rotazione ricordati di **revocare il vecchio PAT** su GitHub.

## 5. Troubleshooting

**L'app non parte dopo install.sh**
```bash
su -s /bin/bash stretchapp -c "pm2 logs stretching --lines 100"
```

**Errore "Cannot find module 'sharp'" o simili**
Dipendenze mancanti dal rebuild nativo. Dal dir dell'app, come `stretchapp`:
```bash
cd /opt/stretching && npm rebuild sharp
```

**Session cookie non funziona dietro NPM**
Verifica che `app.set('trust proxy', 1)` sia attivo in `server.js` (lo è già). In NPM, sotto **Advanced**, **non** aggiungere `proxy_set_header X-Forwarded-Proto https;` manualmente: NPM lo fa già.

**Reset password admin senza ricordarsi la vecchia**
```bash
sudo nano /opt/stretching/.env            # modifica ADMIN_PASSWORD
sudo pm2 restart stretching
```

## 6. Backup

Il file da salvare è uno solo:

```
/opt/stretching/database/stretching.sqlite
```

Plus le immagini caricate:

```
/opt/stretching/uploads/
```

Esempio di backup rsync verso un NAS:

```bash
rsync -azh --delete \
  root@<IP-LXC-stretching>:/opt/stretching/database/ \
  /mnt/backup/stretching/database/
rsync -azh --delete \
  root@<IP-LXC-stretching>:/opt/stretching/uploads/ \
  /mnt/backup/stretching/uploads/
```
