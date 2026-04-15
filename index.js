const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const P = require('pino')

const app = express()
app.use(cors())
app.use(express.json())

let sock
let currentQR = null
let status = 'desconectado'

app.get('/', (req, res) => {
    res.send('OK')
})

app.get('/start', async (req, res) => {
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_sessions')

    sock = makeWASocket({
        logger: P({ level: 'silent' }),
        auth: state
    })

    const qrPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout: QR code not generated within 30 seconds'))
        }, 30000)

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr) {
                currentQR = qr
                console.log('QR GERADO')
                qrcode.generate(qr, { small: true })
                clearTimeout(timeout)
                resolve(qr)
            }

            if (connection === 'open') {
                status = 'conectado'
                console.log('CONECTADO')
                clearTimeout(timeout)
                resolve(null)
            }

            if (connection === 'close') {
                status = 'desconectado'
                const statusCode = lastDisconnect?.error?.output?.statusCode
                const errorMessage = lastDisconnect?.error?.message || 'unknown error'
                console.error(`Connection closed — reason: ${errorMessage} (status: ${statusCode})`)
                clearTimeout(timeout)
                reject(new Error(`Connection closed: ${errorMessage} (status: ${statusCode})`))
            }
        })
    })

    sock.ev.on('creds.update', saveCreds)

    try {
        await qrPromise
        res.json({ message: 'iniciado', qr: currentQR })
    } catch (err) {
        console.error(err.message)
        res.status(504).json({ message: 'iniciado', qr: null, error: err.message })
    }
})

app.get('/qr', (req, res) => {
    res.json({ qr: currentQR })
})
app.get('/session/qr/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId

    if (!currentQR) {
        return res.status(404).json({ sessionId, qr: null, error: 'QR code not available' })
    }

    res.json({
        sessionId,
        qr: currentQR
    })
})
app.get('/session/status/:id', (req, res) => {
    const sessionId = req.params.id

    res.json({
        sessionId,
        status: status,
        qr: currentQR
    })
})
app.post('/session/start', async (req, res) => {
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_sessions')

    sock = makeWASocket({
        logger: P({ level: 'silent' }),
        auth: state
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            currentQR = qr
            console.log('QR GERADO')
        }

        if (connection === 'open') {
            status = 'conectado'
            console.log('CONECTADO')
        }

        if (connection === 'close') {
            status = 'desconectado'
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const errorMessage = lastDisconnect?.error?.message || 'unknown error'
            console.error(`Connection closed — reason: ${errorMessage} (status: ${statusCode})`)
        }
    })

    sock.ev.on('creds.update', saveCreds)

    res.json({ success: true })
})

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
            console.log(`Cleared ${files.length} session file(s) from ${AUTH_SESSIONS_DIR}`)
        }

        res.json({ success: true, message: 'Sessions cleared. Ready to start a fresh connection.' })
    } catch (err) {
        console.error('Error clearing sessions:', err.message)
        res.status(500).json({ success: false, error: err.message })
    }
})


const PORT = process.env.PORT || 3000

app.listen(PORT, '0.0.0.0', () => {
    console.log('SERVIDOR RODANDO NA PORTA ' + PORT)
})
