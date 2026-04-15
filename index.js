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

// 🚀 INICIAR WHATSAPP
app.get('/start', async (req, res) => {
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_sessions')

    sock = makeWASocket({
        logger: P({ level: 'silent' }),
        auth: state,
        browser: ['SaaS Bot', 'Chrome', '1.0.0']
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            currentQR = qr
            console.log('🔐 QR GERADO')
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'open') {
            status = 'conectado'
            console.log('✅ CONECTADO')
        }

        if (connection === 'close') {
            status = 'desconectado'

            const shouldReconnect =
                (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut)

            console.log('❌ CONEXÃO FECHADA')

            if (shouldReconnect) {
                startSock()
            }
        }
    })

    sock.ev.on('creds.update', saveCreds)

    res.json({ message: 'WhatsApp iniciado' })
})

// 📲 PEGAR QR
app.get('/qr', (req, res) => {
    res.json({ qr: currentQR })
})

// 📊 STATUS
app.get('/status', (req, res) => {
    res.json({ status })
})

// ✉️ ENVIAR MENSAGEM
app.post('/send', async (req, res) => {
    try {
        const { number, message } = req.body

        if (!sock) {
            return res.json({ error: 'WhatsApp não iniciado' })
        }

        await sock.sendMessage(number + '@s.whatsapp.net', { text: message })

        res.json({ success: true })
    } catch (err) {
        res.json({ error: err.message })
    }
})

// 🚀 START SERVER
const PORT = process.env.PORT || 3000

app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 SERVIDOR RODANDO NA PORTA ' + PORT)
})
