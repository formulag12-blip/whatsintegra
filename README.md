# WhatsApp Baileys Server para Railway

## Deploy no Railway

1. Crie um novo projeto no Railway (railway.app)
2. Conecte este repositório ou faça upload dos arquivos
3. Configure as variáveis de ambiente:
   - `BACKEND_TOKEN` = uma senha forte (mesma que você vai colocar no IntegraZap)
   - `PORT` = 3000
4. Deploy!

## Configuração no IntegraZap

1. Vá em Configurações → WhatsApp Direto (QR Code)
2. Cole a URL do Railway (ex: https://seu-app.up.railway.app)
3. Cole o mesmo BACKEND_TOKEN
4. Clique em "Salvar configuração"
5. Clique em "Gerar QR Code"

## Endpoints

- POST /session/start - Inicia sessão
- GET /session/qr/:id - Obtém QR code
- GET /session/status/:id - Status da conexão
- POST /session/stop - Encerra sessão
- POST /send - Envia mensagem { number, text }
- GET /health - Health check
