require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const path = require('path')
const { sendMessage, sendMedia } = require('./whatsapp')
const { handleMessage } = require('./intents')
const { initDefaults, addLog, addTicket, addTransfer, addRating, updateRating, getTransfers, updateTransfer, getConfig, setConfig, logFunnelEvent, getFunnel, getLastMessageTimes, getLogs, readJSON, writeJSON } = require('./admin/storage')
const { getOrderStatus, creditBalance } = require('./v2board')
const adminRoutes = require('./admin-routes')
const tg = require('./telegram')

// Initialize data files if they don't exist
initDefaults()

const app = express()
app.use(bodyParser.json())

// Serve static files (admin panel)
app.use(express.static(path.join(__dirname, 'public')))

// Admin API routes
app.use('/admin', adminRoutes)

// Telegram's legacy Markdown parse_mode treats _ * ` [ as formatting delimiters —
// an unmatched one anywhere in the message (e.g. a single "_" in a user's email)
// makes Telegram reject the WHOLE message with 400 "can't parse entities" and the
// admin never gets notified. Escape these in any user-typed value before interpolating.
function escapeMarkdown(text) {
  return String(text == null ? '' : text).replace(/([_*`[])/g, '\\$1')
}

// Helper: send admin notification via Telegram (falls back to HUMAN_WA)
async function notifyAdmin(msg, mediaUrl, mediaMimeType) {
  const cfg = getConfig()
  const tgToken = (cfg.TELEGRAM_BOT_TOKEN || '').trim()
  const tgChatId = (cfg.TELEGRAM_CHAT_ID || '').trim()
  if (tgToken && tgChatId) {
    await tg.sendMessage(tgToken, tgChatId, msg)
    if (mediaUrl) {
      const isImage = (mediaMimeType || '').startsWith('image/')
      if (isImage) {
        await tg.sendPhoto(tgToken, tgChatId, mediaUrl)
      } else {
        await tg.sendDocument(tgToken, tgChatId, mediaUrl)
      }
    }
  } else if (cfg.HUMAN_WA) {
    await sendMessage(cfg.HUMAN_WA, msg)
    if (mediaUrl) {
      const mediaType = (mediaMimeType || '').startsWith('image/') ? 'image' : 'document'
      await sendMedia(cfg.HUMAN_WA, mediaType, mediaUrl)
    }
  }
}

// Telegram webhook — captura el chat_id del admin automáticamente
app.post('/telegram/webhook', async (req, res) => {
  res.sendStatus(200)
  const message = req.body?.message
  if (!message) return
  const chatId = String(message.chat?.id || '')
  if (!chatId) return
  const cfg = getConfig()
  if (!cfg.TELEGRAM_CHAT_ID || message.text === '/start') {
    setConfig({ ...cfg, TELEGRAM_CHAT_ID: chatId })
    console.log('[TELEGRAM] Chat ID guardado:', chatId)
    const tgToken = cfg.TELEGRAM_BOT_TOKEN
    if (tgToken) {
      tg.sendMessage(tgToken, chatId, '✅ *Bot conectado*\n\nAhora recibirás las notificaciones de comprobantes y tickets aquí.').catch(() => {})
    }
  }
})

// Verificación Meta
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge)
  }
  res.sendStatus(403)
})

// Mensajes entrantes
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0]
    const change = entry?.changes?.[0]
    const message = change?.value?.messages?.[0]

    if (!message) return res.sendStatus(200)

    const from = message.from
    const text = message.text?.body || message.image?.caption || message.document?.caption || ''
    const adRef = message.referral?.ref || null

    // Log the raw payload for message types we don't extract text from,
    // so unusual messages (e.g. Meta verification/system messages) aren't lost
    if (!text && message.type !== 'image' && message.type !== 'document') {
      console.log(`[WEBHOOK] Mensaje sin texto extraído (type=${message.type}) de ${from}, value completo:`, JSON.stringify(change.value))
    }

    // Extract media info if message contains image or document
    let mediaInfo = null
    if (message.type === 'image' && message.image) {
      mediaInfo = { type: 'image', mediaId: message.image.id, mimeType: message.image.mime_type }
    } else if (message.type === 'document' && message.document) {
      mediaInfo = { type: 'document', mediaId: message.document.id, mimeType: message.document.mime_type }
    }

    const { reply, intent, ticket, notifyHuman, media, transfer, rating, logMessage, followUp } = await handleMessage(text, from, mediaInfo, adRef)
    await sendMessage(from, reply)

    if (media) {
      const delay = ms => new Promise(r => setTimeout(r, ms))
      await delay(1000)
      const items = Array.isArray(media) ? media : [media]
      for (const m of items) {
        try {
          await sendMedia(from, m.type, m.url, m.caption)
        } catch (e) {
          console.error('Error enviando media:', e.response?.data || e.message)
        }
      }
    }

    if (followUp) {
      const delay = ms => new Promise(r => setTimeout(r, ms))
      await delay(1500)
      await sendMessage(from, followUp)
    }

    addLog({ from, message: logMessage || text, reply, intent })

    // If a flow created a ticket, save it and notify the admin
    if (ticket) {
      const saved = addTicket(ticket)
      const cfg = getConfig()
      const baseUrl = cfg.BOT_BASE_URL || 'https://bot.demianred.com'
      const varsText = Object.entries(ticket.vars)
        .map(([k, v]) => `*${escapeMarkdown(k)}:* ${escapeMarkdown(v)}`)
        .join('\n')
      const msg = `🎫 *Nuevo ticket de soporte*\n\n📋 *Flujo:* ${escapeMarkdown(ticket.flowName)}\n📱 *De:* +${ticket.from}\n\n${varsText}\n\n📅 ${new Date(saved.createdAt).toLocaleString('es-MX')}\n\n👉 Responder: https://wa.me/${ticket.from}`
      try {
        await notifyAdmin(msg)
        console.log('Ticket enviado a asesor')
      } catch (e) {
        console.error('Error enviando ticket a asesor:', JSON.stringify(e.response?.data) || e.message)
      }
    }

    // If a purchase flow returned a transfer receipt, save it and notify admin
    if (transfer) {
      logFunnelEvent(from, 'purchase_completed')
      const saved = addTransfer(transfer)
      const cfg = getConfig()
      const baseUrl = cfg.BOT_BASE_URL || 'https://bot.demianred.com'
      const receiptUrl = `${baseUrl}/receipts/${saved.receiptFilename}`
      const msg = `🧾 Comprobante de +${saved.from}\n👉 https://wa.me/${saved.from}`
      try {
        await notifyAdmin(msg, receiptUrl, saved.receiptMimeType)
      } catch (e) {
        console.error('Error enviando comprobante a asesor:', e.response?.data || e.message)
      }
    }

    // If a rating flow completed, save + notify admin for manual review
    if (rating) {
      const saved = addRating(rating)
      const cfg = getConfig()
      const display = cfg.RATING_CREDIT_DISPLAY || '$30'
      const baseUrl = cfg.BOT_BASE_URL || 'https://bot.demianred.com'
      const screenshotUrl = saved.ratingFilename ? `${baseUrl}/receipts/${saved.ratingFilename}` : null
      const adminMsg = `⭐ *Calificación pendiente de revisión*\n\n📱 De: +${saved.from}\n📧 Correo: ${escapeMarkdown(saved.email)}\n💰 Premio: ${display} MXN\n\n✅ Aprueba desde el panel para acreditar\n👉 https://wa.me/${saved.from}`
      try {
        await notifyAdmin(adminMsg, screenshotUrl, saved.ratingMimeType)
      } catch (e) { console.error('[RATING] Error notificando calificación:', e.message) }
    }

    // If an option has notifyHuman, alert the admin
    if (notifyHuman) {
      const msg = `📩 *Un usuario quiere contactarte*\n\n📱 *De:* +${notifyHuman.from}\n📋 *Opción:* ${escapeMarkdown(notifyHuman.optionLabel)}\n\n👉 Responder: https://wa.me/${notifyHuman.from}`
      try {
        await notifyAdmin(msg)
      } catch (e) {
        console.error('Error notificando a asesor:', e.response?.data || e.message)
      }
    }

    res.sendStatus(200)
  } catch (e) {
    console.error('Error:', e.response?.data || e.message)
    res.sendStatus(200)
  }
})

// --- 24h follow-up for users who didn't purchase ---
const FOLLOWUP_MIN_MS = 20 * 60 * 60 * 1000   // send between 20h
const FOLLOWUP_MAX_MS = 23.5 * 60 * 60 * 1000 // and 23.5h after last message

async function checkFollowUps() {
  const now = Date.now()
  const lastMsgTimes = getLastMessageTimes()
  const funnelEvents = getFunnel()

  const purchased = new Set(funnelEvents.filter(e => e.event === 'purchase_completed').map(e => e.whatsapp))
  const followedUp = new Set(funnelEvents.filter(e => e.event === 'followup_sent').map(e => e.whatsapp))

  const cfg = getConfig()
  const android = cfg.PLAY_STORE_URL ? `🤖 Android: ${cfg.PLAY_STORE_URL}` : ''
  const apple = cfg.APP_STORE_URL ? `🍎 iPhone: ${cfg.APP_STORE_URL}` : ''
  const links = [android, apple].filter(Boolean).join('\n')
  const followupMsg = cfg.FOLLOWUP_MESSAGE ||
    `¡Hola! 👋 Por si te quedaron dudas sobre *VPNMax*...\n\nRecuerda que al registrarte en la app recibes *1 GB gratis* sin fecha de vencimiento 🎁\n\n${links}\n\n¿Tienes alguna pregunta? Escríbeme o escribe *hola* para ver el menú.`

  for (const [whatsapp, lastTime] of Object.entries(lastMsgTimes)) {
    const elapsed = now - lastTime
    if (elapsed < FOLLOWUP_MIN_MS || elapsed > FOLLOWUP_MAX_MS) continue
    if (purchased.has(whatsapp)) continue
    if (followedUp.has(whatsapp)) continue

    try {
      await sendMessage(whatsapp, followupMsg)
      logFunnelEvent(whatsapp, 'followup_sent')
      console.log('[FOLLOWUP] Sent to', whatsapp)
    } catch (e) {
      console.error('[FOLLOWUP] Error sending to', whatsapp, e.message)
    }
  }
}

setInterval(checkFollowUps, 30 * 60 * 1000)
setTimeout(checkFollowUps, 60 * 1000) // first check 1 min after startup

// --- 3-4h follow-up for high-interest users who haven't purchased ---
const INTEREST_FOLLOWUP_MIN_MS = 3 * 60 * 60 * 1000   // 3h
const INTEREST_FOLLOWUP_MAX_MS = 4 * 60 * 60 * 1000   // 4h

async function checkInterestFollowUps() {
  const now = Date.now()
  const lastMsgTimes = getLastMessageTimes()
  const funnelEvents = getFunnel()

  const purchased = new Set(funnelEvents.filter(e => e.event === 'purchase_completed').map(e => e.whatsapp))
  const alreadySent = new Set(funnelEvents.filter(e => e.event === 'interest_followup_sent').map(e => e.whatsapp))
  const interested = new Set(funnelEvents.filter(e => e.event === 'interest_shown').map(e => e.whatsapp))
  const requestedHuman = new Set(funnelEvents.filter(e => e.event === 'requested_human').map(e => e.whatsapp))

  const cfg = getConfig()
  const android = cfg.PLAY_STORE_URL ? `🤖 Android: ${cfg.PLAY_STORE_URL}` : ''
  const apple = cfg.APP_STORE_URL ? `🍎 iPhone: ${cfg.APP_STORE_URL}` : ''
  const links = [android, apple].filter(Boolean).join('\n')
  const msg = `¡Hola! 👋 ¿Quedaste con alguna duda sobre *VPNMax*?\n\nRecuerda que puedes probarlo gratis — al registrarte en la app recibes *1 GB sin fecha de vencimiento* 🎁\n\n${links}\n\n¿Tienes alguna pregunta? Escríbeme aquí o contacta con un asesor.`

  for (const [whatsapp, lastTime] of Object.entries(lastMsgTimes)) {
    const elapsed = now - lastTime
    if (elapsed < INTEREST_FOLLOWUP_MIN_MS || elapsed > INTEREST_FOLLOWUP_MAX_MS) continue
    if (!interested.has(whatsapp)) continue
    if (purchased.has(whatsapp)) continue
    if (alreadySent.has(whatsapp)) continue
    if (requestedHuman.has(whatsapp)) continue

    try {
      await sendMessage(whatsapp, msg)
      logFunnelEvent(whatsapp, 'interest_followup_sent')
      console.log('[INTEREST-FOLLOWUP] Sent to', whatsapp)
    } catch (e) {
      console.error('[INTEREST-FOLLOWUP] Error sending to', whatsapp, e.message)
    }
  }
}

setInterval(checkInterestFollowUps, 30 * 60 * 1000)
setTimeout(checkInterestFollowUps, 90 * 1000)

// --- Poll pending transfers against V2Board order status ---
const POLL_INTERVAL = 2 * 60 * 1000 // 2 minutes

async function checkPendingTransfers() {
  const transfers = getTransfers().filter(t => t.status === 'pending' && t.tradeNo)
  if (!transfers.length) return

  for (const t of transfers) {
    try {
      const order = await getOrderStatus(t.tradeNo)
      if (!order) continue

      // status: 0=pending, 1=paid, 2=cancelled, 3=completed
      if (order.status >= 1 && order.status !== 2) {
        updateTransfer(t.id, { status: 'verified', reviewedAt: new Date().toISOString() })
        console.log('[TRANSFER-POLL] Order paid, verified:', t.tradeNo)

        if (t.from) {
          try {
            await sendMessage(t.from, `🎉 *¡Pago confirmado!*\n\nTu transferencia ha sido verificada.\n\n📦 Plan: ${t.planName || ''} — ${t.periodLabel || ''}\n📋 Orden: ${t.tradeNo}\n\nTu servicio está activo. ¡Gracias por tu compra!\n\nEscribe *hola* para volver al menú.`)
          } catch (e) {
            console.error('[TRANSFER-POLL] Error notifying user:', e.message)
          }
        }
      }
    } catch (e) {
      console.error('[TRANSFER-POLL] Error checking order', t.tradeNo, e.message)
    }
  }
}

setInterval(checkPendingTransfers, POLL_INTERVAL)
// Run once after startup (wait 30s for v2board token to be ready)
setTimeout(checkPendingTransfers, 30000)

// --- Daily digest: flag conversations where the bot likely gave a poor/incomplete answer ---
const BAD_ANSWER_PHRASES = [
  'no tengo información', 'no tengo info', 'no cuento con información',
  'no tengo esa información', 'no tengo datos', 'no tengo detalles',
  'te recomendaría contactar', 'te recomiendo contactar a un asesor',
  'no estoy seguro', 'no puedo confirmar', 'desconozco', 'no dispongo de'
]
const DAILY_DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000

async function checkDailyDigest() {
  const now = Date.now()
  // Persisted to disk (not just an in-memory var) so a pm2 restart within the same
  // 24h window doesn't re-send the same digest a few minutes later
  const meta = readJSON('meta.json') || {}
  if (now - (meta.lastDigestAt || 0) < DAILY_DIGEST_INTERVAL_MS) return
  writeJSON('meta.json', { ...meta, lastDigestAt: now })

  const since = now - 24 * 60 * 60 * 1000
  const logs = getLogs(99999).filter(l => l.timestamp && new Date(l.timestamp).getTime() >= since)
  const flagged = logs.filter(l => {
    const reply = (l.reply || '').toLowerCase()
    return BAD_ANSWER_PHRASES.some(p => reply.includes(p))
  })
  if (flagged.length === 0) return

  const lines = flagged.slice(0, 15).map(f =>
    `• +${f.from}: "${escapeMarkdown((f.message || '').slice(0, 100))}"\n   ↳ ${escapeMarkdown((f.reply || '').slice(0, 140).replace(/\n/g, ' '))}`
  )
  const extra = flagged.length > 15 ? `\n\n...y ${flagged.length - 15} más.` : ''
  const msg = `📊 *Reporte diario: posibles respuestas incompletas*\n\n${flagged.length} mensaje(s) en las últimas 24h donde el bot dijo no tener información o sugirió contactar a un asesor — revisa si conviene agregar esto a la base de conocimiento:\n\n${lines.join('\n\n')}${extra}`

  try {
    await notifyAdmin(msg)
    console.log('[DAILY-DIGEST] Sent —', flagged.length, 'flagged messages')
  } catch (e) {
    console.error('[DAILY-DIGEST] Error sending:', e.message)
  }
}

setInterval(checkDailyDigest, 30 * 60 * 1000)
setTimeout(checkDailyDigest, 5 * 60 * 1000) // first check 5 min after startup

app.listen(process.env.PORT, () => {
  console.log('WhatsApp bot activo 🚀')
})
