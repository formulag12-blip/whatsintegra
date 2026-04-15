const express = require('express')
const cors = require('cors')
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
        auth: state
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update

        if (qr) {
            currentQR = qr
            console.log('QR GERADO')
        }

        if (connection === 'open') {
            status = 'conectado'
            console.log('CONECTADO')
        }
    })

    sock.ev.on('creds.update', saveCreds)

    res.json({ success: true })
})


const PORT = process.env.PORT || 3000

app.listen(PORT, '0.0.0.0', () => {
    console.log('SERVIDOR RODANDO NA PORTA ' + PORT)
})
