const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BACKEND_TOKEN = process.env.BACKEND_TOKEN || '';
const AUTH_DIR = process.env.AUTH_DIR || './auth_sessions';

// Auth middleware
function authMiddleware(req, res, next) {
  if (!BACKEND_TOKEN) return next();
  const token = req.headers['x-backend-token'] || req.query.token;
  if (token !== BACKEND_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }
  next();
}

app.use(authMiddleware);

// Session state
let sock = null;
let qrDataUrl = null;
let connectionStatus = 'disconnected';
let lastError = null;

const sessionDir = path.resolve(AUTH_DIR, 'default');

async function startSession() {
  if (sock) {
    try { sock.end(); } catch {}
    sock = null;
  }

  qrDataUrl = null;
  connectionStatus = 'connecting';
  lastError = null;

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        qrDataUrl = await QRCode.toDataURL(qr);
        connectionStatus = 'connecting';
      } catch (e) {
        lastError = 'Erro ao gerar QR: ' + e.message;
      }
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      qrDataUrl = null;
      lastError = null;
      console.log('WhatsApp connected!');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      connectionStatus = 'disconnected';
      lastError = `Disconnected (code: ${statusCode})`;
      console.log('Disconnected:', statusCode);

      if (statusCode === DisconnectReason.loggedOut || statusCode === 405) {
        // Clear session
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        lastError = `Session cleared (code: ${statusCode}). Reconnect with new QR.`;
      }
    }
  });
}

// Routes
app.post('/session/start', async (req, res) => {
  try {
    await startSession();
    res.json({ ok: true, status: connectionStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/session/qr/:id', (req, res) => {
  res.json({
    connected: connectionStatus === 'connected',
    qr: qrDataUrl,
    status: connectionStatus,
    lastError,
  });
});

app.get('/session/status/:id', (req, res) => {
  res.json({
    connected: connectionStatus === 'connected',
    status: connectionStatus,
    lastError,
  });
});

app.post('/session/stop', (req, res) => {
  try {
    if (sock) { sock.end(); sock = null; }
    connectionStatus = 'disconnected';
    qrDataUrl = null;
    lastError = null;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/send', async (req, res) => {
  const { number, text } = req.body || {};
  if (!number || !text) {
    return res.status(400).json({ error: 'number e text são obrigatórios' });
  }
  if (connectionStatus !== 'connected' || !sock) {
    return res.status(400).json({ error: 'WhatsApp não conectado' });
  }
  try {
    const jid = number.includes('@') ? number : `${number.replace(/\D/g, '')}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text });
    res.json({ ok: true, jid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, status: connectionStatus });
});

app.listen(PORT, () => {
  console.log(`WhatsApp server running on port ${PORT}`);
});
