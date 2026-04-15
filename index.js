const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const QRCode = require('qrcode')
const P = require('pino')

const app = express()
app.use(cors())
app.use(express.json())

let sock
let currentQR = null
let status = 'desconectado'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve a human-readable label for a Baileys DisconnectReason status code.
 */
function disconnectLabel(statusCode) {
    const labels = {
        [DisconnectReason.badSession]:          'BAD_SESSION — credentials are corrupted, clear sessions and reconnect',
        [DisconnectReason.connectionClosed]:    'CONNECTION_CLOSED — server closed the connection',
        [DisconnectReason.connectionLost]:      'CONNECTION_LOST — network interruption',
        [DisconnectReason.connectionReplaced]:  'CONNECTION_REPLACED — another client opened the same session',
        [DisconnectReason.loggedOut]:           'LOGGED_OUT — device was logged out from WhatsApp',
        [DisconnectReason.restartRequired]:     'RESTART_REQUIRED — Baileys requires a socket restart',
        [DisconnectReason.timedOut]:            'TIMED_OUT — connection attempt timed out',
        405:                                    'METHOD_NOT_ALLOWED (405) — WhatsApp rejected the connection; try clearing sessions or updating Baileys',
    }
    return labels[statusCode] || `UNKNOWN (${statusCode})`
}

/**
 * Decide whether a disconnect is recoverable and should trigger an auto-reconnect.
 * Logged-out and bad-session states require manual intervention (new QR scan).
 */
function shouldReconnect(statusCode) {
    const noReconnect = new Set([
        DisconnectReason.loggedOut,
        DisconnectReason.badSession,
        DisconnectReason.connectionReplaced,
        405,
    ])
    return !noReconnect.has(statusCode)
}

/**
 * Create a Baileys socket, wire up all event listeners, and return it.
 * Handles auto-reconnect internally for recoverable disconnects.
 */
async function createSocket(saveCreds, onUpdate) {
    const { state } = await useMultiFileAuthState('/tmp/auth_sessions')

    console.log('[Baileys] Creating new socket...')

    const socket = makeWASocket({
        logger: P({ level: 'warn' }),   // 'warn' surfaces important Baileys internals without noise
        auth: state,
        version: [2, 3000, 1034074495], // current stable WhatsApp Web protocol version
        printQRInTerminal: false,       // we handle QR rendering ourselves
        connectTimeoutMs: 30_000,
        defaultQueryTimeoutMs: 30_000,
        keepAliveIntervalMs: 10_000,
        retryRequestDelayMs: 2_000,
    })

    socket.ev.on('creds.update', saveCreds)

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr, receivedPendingNotifications, isNewLogin } = update

        console.log('[connection.update]', JSON.stringify({
            connection,
            qr: qr ? '<QR_PRESENT>' : undefined,
            isNewLogin,
            receivedPendingNotifications,
            statusCode: lastDisconnect?.error?.output?.statusCode,
            errorMessage: lastDisconnect?.error?.message,
        }))

        if (qr) {
            currentQR = qr
            status = 'aguardando_qr'
            console.log('[Baileys] QR code generated — scan with WhatsApp')
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'connecting') {
            status = 'conectando'
            console.log('[Baileys] Connecting to WhatsApp servers...')
        }

        if (connection === 'open') {
            status = 'conectado'
            currentQR = null
            console.log('[Baileys] Connection established successfully')
        }

        if (connection === 'close') {
            status = 'desconectado'
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const errorMessage = lastDisconnect?.error?.message || 'unknown error'
            const label = disconnectLabel(statusCode)

            console.error(`[Baileys] Connection closed — ${label}`)
            console.error(`[Baileys] Raw error: ${errorMessage}`)

            if (shouldReconnect(statusCode)) {
                console.log('[Baileys] Recoverable disconnect — reconnecting in 3 s...')
                setTimeout(async () => {
                    try {
                        sock = await createSocket(saveCreds, onUpdate)
                    } catch (err) {
                        console.error('[Baileys] Reconnect failed:', err.message)
                    }
                }, 3000)
            } else {
                console.warn('[Baileys] Non-recoverable disconnect — manual intervention required (call /clear-sessions then /start)')
            }
        }

        if (onUpdate) onUpdate(update)
    })

    return socket
}

// ─── Routes ─────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    const connected = status === 'conectado'
    const hasQR     = !!currentQR

    const bodyContent = connected
        ? `<p class="badge connected">✅ Connected</p>
           <p>WhatsApp is connected. No QR code needed.</p>`
        : hasQR
            ? `<p class="badge waiting">📱 Waiting for scan</p>
               <p>Scan the QR code below with WhatsApp to connect.</p>
               <img src="/qr-image" alt="WhatsApp QR Code" />`
            : `<p class="badge disconnected">⏳ Not ready</p>
               <p>No QR code available yet. Call <code>GET /start</code> to begin.</p>`

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="refresh" content="10" />
  <title>WhatsApp QR</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f2f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,.10);
      padding: 40px 48px;
      text-align: center;
      max-width: 420px;
      width: 100%;
    }
    h1 { font-size: 1.4rem; color: #111; margin-bottom: 20px; }
    p  { color: #555; margin-bottom: 16px; line-height: 1.5; }
    code { background: #f0f2f5; padding: 2px 6px; border-radius: 4px; font-size: .9em; }
    img { margin-top: 8px; width: 240px; height: 240px; border-radius: 8px; border: 1px solid #e0e0e0; }
    .badge {
      display: inline-block;
      font-size: .85rem;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 999px;
      margin-bottom: 16px;
    }
    .connected    { background: #d4edda; color: #155724; }
    .waiting      { background: #fff3cd; color: #856404; }
    .disconnected { background: #f8d7da; color: #721c24; }
    .hint { font-size: .78rem; color: #999; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>WhatsApp Connection</h1>
    ${bodyContent}
    <p class="hint">Page refreshes automatically every 10 seconds.</p>
  </div>
</body>
</html>`)
})

app.get('/start', async (req, res) => {
    const { saveCreds } = await useMultiFileAuthState('/tmp/auth_sessions')

    const qrPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout: QR code not generated within 30 seconds'))
        }, 30000)

        const onUpdate = (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr) {
                clearTimeout(timeout)
                resolve(qr)
            }

            if (connection === 'open') {
                clearTimeout(timeout)
                resolve(null)
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode
                const errorMessage = lastDisconnect?.error?.message || 'unknown error'
                clearTimeout(timeout)
                reject(new Error(`Connection closed: ${disconnectLabel(statusCode)} — ${errorMessage}`))
            }
        }

        createSocket(saveCreds, onUpdate)
            .then((s) => { sock = s })
            .catch((err) => {
                clearTimeout(timeout)
                reject(err)
            })
    })

    try {
        await qrPromise
        res.json({ message: 'iniciado', qr: currentQR })
    } catch (err) {
        console.error('[/start] Error:', err.message)
        res.status(504).json({ message: 'iniciado', qr: null, error: err.message })
    }
})

app.get('/qr', (req, res) => {
    res.json({ qr: currentQR })
})

app.get('/qr-image', async (req, res) => {
    if (!currentQR) {
        return res.status(404).json({ error: 'QR code not available. Call /start first.' })
    }

    try {
        const pngBuffer = await QRCode.toBuffer(currentQR, {
            type: 'png',
            width: 512,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
        })

        res.setHeader('Content-Type', 'image/png')
        res.setHeader('Content-Length', pngBuffer.length)
        res.setHeader('Cache-Control', 'no-store')
        res.end(pngBuffer)
    } catch (err) {
        console.error('[/qr-image] Failed to generate PNG:', err.message)
        res.status(500).json({ error: 'Failed to generate QR image' })
    }
})

app.get('/session/qr/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId

    if (!currentQR) {
        return res.status(404).json({ sessionId, qr: null, error: 'QR code not available' })
    }

    res.json({ sessionId, qr: currentQR })
})

app.get('/session/status/:id', (req, res) => {
    const sessionId = req.params.id
    res.json({ sessionId, status, qr: currentQR })
})

app.post('/session/start', async (req, res) => {
    const { saveCreds } = await useMultiFileAuthState('/tmp/auth_sessions')

    try {
        sock = await createSocket(saveCreds, null)
        res.json({ success: true })
    } catch (err) {
        console.error('[/session/start] Error:', err.message)
        res.status(500).json({ success: false, error: err.message })
    }
})

// ─── Session management ──────────────────────────────────────────────────────

const AUTH_SESSIONS_DIR = '/tmp/auth_sessions'

app.post('/clear-sessions', async (req, res) => {
    try {
        if (sock) {
            try {
                sock.ev.removeAllListeners()
                await sock.logout()
            } catch (_) {
                // socket may already be closed; proceed regardless
            }
            sock = null
        }

        currentQR = null
        status = 'desconectado'

        if (fs.existsSync(AUTH_SESSIONS_DIR)) {
            const files = fs.readdirSync(AUTH_SESSIONS_DIR)
            for (const file of files) {
                fs.rmSync(path.join(AUTH_SESSIONS_DIR, file), { recursive: true, force: true })
            }
            console.log(`[sessions] Cleared ${files.length} session file(s) from ${AUTH_SESSIONS_DIR}`)
        }

        res.json({ success: true, message: 'Sessions cleared. Ready to start a fresh connection.' })
    } catch (err) {
        console.error('[/clear-sessions] Error:', err.message)
        res.status(500).json({ success: false, error: err.message })
    }
})

// ─── Server ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Listening on port ${PORT}`)
    console.log(`[server] Baileys version: ${require('@whiskeysockets/baileys/package.json').version}`)
})
