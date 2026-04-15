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

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            currentQR = qr
            console.log('QR GERADO')
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'open') {
            status = 'conectado'
            console.log('CONECTADO')
        }

        if (connection === 'close') {
            status = 'desconectado'
        }
    })

    sock.ev.on('creds.update', saveCreds)

    res.json({ message: 'iniciado' })
})

app.get('/qr', (req, res) => {
    res.json({ qr: currentQR })
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
