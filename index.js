const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BACKEND_TOKEN = process.env.BACKEND_TOKEN || '';
const AUTH_DIR = path.join(__dirname, 'auth_sessions');

// Auth middleware
function authMiddleware(req, res, next) {
  if (!BACKEND_TOKEN) return next();
  const token = req.headers['x-backend-token'] || req.query.token;
  if (token !== BACKEND_TOKEN) return res.status(401).json({ error: 'Token inválido' });
  next();
}
app.use(authMiddleware);

// Session state
let sock = null;
let qrCodeData = null;
let connected = false;
let lastError = null;
let sessionId = 'default';

async function startSession() {
  const authDir = path.join(AUTH_DIR, sessionId);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const logger = pino({ level: 'silent' });

  sock = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    printQRInTerminal: false,
    browser: ['IntegraZap', 'Chrome', '22.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeData = await qrcode.toDataURL(qr);
      connected = false;
      lastError = null;
      console.log('[WA] QR code generated');
    }

    if (connection === 'open') {
      connected = true;
      qrCodeData = null;
      lastError = null;
      console.log('[WA] Connected!');
    }

    if (connection === 'close') {
      connected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      lastError = lastDisconnect?.error?.message || 'Disconnected';
      console.log(`[WA] Disconnected: ${statusCode} - ${lastError}`);

      if (statusCode === DisconnectReason.loggedOut || statusCode === 405) {
        // Clear session on logout or 405
        if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true });
        qrCodeData = null;
        sock = null;
        console.log('[WA] Session cleared (logged out or 405)');
      } else if (statusCode !== DisconnectReason.loggedOut) {
        // Auto-reconnect on transient errors
        setTimeout(() => startSession(), 3000);
      }
    }
  });
}

// Routes
app.post('/session/start', async (req, res) => {
  try {
    if (connected) return res.json({ connected: true, status: 'already_connected' });
    qrCodeData = null;
    lastError = null;
    await startSession();
    res.json({ status: 'starting' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/session/qr/:id', (req, res) => {
  if (connected) return res.json({ connected: true });
  if (qrCodeData) return res.json({ qr: qrCodeData, connected: false, status: 'waiting_scan' });
  res.json({ qr: null, connected: false, status: 'generating', lastError });
});

app.get('/session/status/:id', (req, res) => {
  res.json({ connected, status: connected ? 'connected' : 'disconnected', lastError });
});

app.post('/session/stop', (req, res) => {
  if (sock) { sock.end(); sock = null; }
  connected = false;
  qrCodeData = null;
  lastError = null;
  res.json({ status: 'stopped' });
});

app.post('/send', async (req, res) => {
  if (!connected || !sock) return res.status(400).json({ error: 'WhatsApp não conectado' });
  const { number, text } = req.body;
  if (!number || !text) return res.status(400).json({ error: 'number e text são obrigatórios' });
  try {
    const jid = number.replace(/\D/g, '') + '@s.whatsapp.net';
    await sock.sendMessage(jid, { text });
    res.json({ success: true, jid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, connected }));

app.listen(PORT, () => console.log(`[Server] Running on port ${PORT}`));
