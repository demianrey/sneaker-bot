const express = require('express')
const router = express.Router()
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const adminAuth = require('./admin/auth')
const storage = require('./admin/storage')
const { sendMessage } = require('./whatsapp')
const tg = require('./telegram')

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads')
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
      cb(null, Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + ext)
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
    cb(null, allowed.includes(file.mimetype))
  }
})

// Auth on all API routes
router.use('/api', adminAuth)

// --- File upload ---
router.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo no válido o demasiado grande (máx 10MB). Solo se permiten imágenes.' })
  const cfg = storage.getConfig()
  const base = (cfg.BOT_BASE_URL || '').replace(/\/+$/, '')
  res.json({ url: base + '/uploads/' + req.file.filename, filename: req.file.filename })
})

// --- Catalog ---
router.get('/api/catalog', (req, res) => res.json(storage.getCatalog()))

router.post('/api/catalog', (req, res) => {
  const product = storage.addProduct(req.body)
  res.status(201).json(product)
})

router.put('/api/catalog/:id', (req, res) => {
  const updated = storage.updateProduct(req.params.id, req.body)
  if (!updated) return res.status(404).json({ error: 'Producto no encontrado' })
  res.json(updated)
})

router.delete('/api/catalog/:id', (req, res) => {
  const deleted = storage.deleteProduct(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'Producto no encontrado' })
  res.json({ ok: true })
})

// --- Flows ---
router.get('/api/flows', (req, res) => {
  res.json(storage.getFlows())
})

router.put('/api/flows', (req, res) => {
  storage.setFlows(req.body)
  res.json({ ok: true })
})

router.post('/api/flows/flow', (req, res) => {
  const flow = storage.addFlow(req.body)
  res.status(201).json(flow)
})

router.put('/api/flows/flow/:id', (req, res) => {
  const updated = storage.updateFlow(req.params.id, req.body)
  if (!updated) return res.status(404).json({ error: 'Flujo no encontrado' })
  res.json(updated)
})

router.delete('/api/flows/flow/:id', (req, res) => {
  const result = storage.deleteFlow(req.params.id)
  if (result && result.error) return res.status(400).json(result)
  if (!result) return res.status(404).json({ error: 'Flujo no encontrado' })
  res.json({ ok: true })
})

// --- Config ---
router.get('/api/config', (req, res) => {
  res.json(storage.getConfig())
})

router.put('/api/config', (req, res) => {
  storage.setConfig(req.body)
  res.json({ ok: true })
})

router.post('/api/telegram/setup', async (req, res) => {
  const cfg = storage.getConfig()
  const token = (cfg.TELEGRAM_BOT_TOKEN || '').trim()
  const baseUrl = (cfg.BOT_BASE_URL || '').trim()
  if (!token) return res.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN no configurado' })
  if (!baseUrl) return res.json({ ok: false, error: 'BOT_BASE_URL no configurado' })
  try {
    const result = await tg.setWebhook(token, `${baseUrl}/telegram/webhook`)
    res.json({ ok: true, description: result.description })
  } catch (e) {
    const errMsg = e.response?.data?.description || e.message
    res.json({ ok: false, error: errMsg })
  }
})

// --- Broadcast ---
const H24  = 24 * 60 * 60 * 1000
const H7D  = 7  * 24 * 60 * 60 * 1000

function getAudienceTargets(audience) {
  const users      = storage.getUsers()
  const times      = storage.getLastMessageTimes()
  const funnel     = storage.getFunnel()
  const purchased  = new Set(funnel.filter(e => e.event === 'purchase_completed').map(e => e.whatsapp))
  const now        = Date.now()
  let targets      = [...new Set(users.map(u => u.whatsapp))]
  if (audience === 'active_24h')  targets = targets.filter(wa => times[wa] && now - times[wa] < H24)
  if (audience === 'active_7d')   targets = targets.filter(wa => times[wa] && now - times[wa] < H7D)
  if (audience === 'no_purchase') targets = targets.filter(wa => !purchased.has(wa))
  return targets
}

router.get('/api/broadcast/audiences', (req, res) => {
  res.json({
    all:         getAudienceTargets('all').length,
    active_24h:  getAudienceTargets('active_24h').length,
    active_7d:   getAudienceTargets('active_7d').length,
    no_purchase: getAudienceTargets('no_purchase').length
  })
})

let broadcastStatus = null // tracks the current or last broadcast

router.get('/api/broadcast/status', (req, res) => {
  res.json(broadcastStatus || { state: 'idle' })
})

router.post('/api/broadcast', async (req, res) => {
  if (broadcastStatus?.state === 'sending') {
    return res.status(409).json({ error: 'Ya hay un broadcast en curso' })
  }
  const { message, audience } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'Mensaje requerido' })

  const targets = getAudienceTargets(audience || 'all')
  if (!targets.length) return res.status(400).json({ error: 'Sin destinatarios para la audiencia seleccionada' })

  broadcastStatus = { state: 'sending', total: targets.length, sent: 0, failed: 0, startedAt: new Date().toISOString() }
  res.json({ queued: targets.length })

  ;(async () => {
    for (const wa of targets) {
      try {
        await sendMessage(wa, message)
        storage.logFunnelEvent(wa, 'broadcast_sent')
        broadcastStatus.sent++
      } catch (e) {
        console.error('[BROADCAST] Error sending to', wa, e.message)
        broadcastStatus.failed++
      }
      await new Promise(r => setTimeout(r, 1000)) // 1 msg/sec — stay within Meta rate limits
    }
    broadcastStatus.state = 'done'
    broadcastStatus.finishedAt = new Date().toISOString()
    console.log(`[BROADCAST] Done: ${broadcastStatus.sent} sent, ${broadcastStatus.failed} failed`)
  })()
})

// --- Funnel ---
router.get('/api/funnel', (req, res) => {
  const events = storage.getFunnel()
  const users = storage.getUsers()

  // Stage stats
  const stageDefs = [
    { key: 'arrived',            label: 'Llegaron' },
    { key: 'menu_seen',          label: 'Vieron el menú' },
    { key: 'purchase_started',   label: 'Iniciaron pedido' },
    { key: 'purchase_completed', label: 'Completaron pedido' },
    { key: 'followup_sent',      label: 'Recibieron seguimiento 24h' },
    { key: 'broadcast_sent',     label: 'Recibieron broadcast' }
  ]
  const stats = stageDefs.map(s => {
    const count = new Set(events.filter(e => e.event === s.key).map(e => e.whatsapp)).size
    return { ...s, count }
  })

  // Source attribution — group by adRef saved on user record
  const refByUser = {}
  for (const u of users) {
    refByUser[u.whatsapp] = u.adRef || null
  }
  const arrivedUsers = [...new Set(events.filter(e => e.event === 'arrived').map(e => e.whatsapp))]
  const purchasedUsers = new Set(events.filter(e => e.event === 'purchase_completed').map(e => e.whatsapp))
  const sourceMap = {}
  for (const wa of arrivedUsers) {
    const ref = refByUser[wa] || null
    const key = ref || '__organic__'
    if (!sourceMap[key]) sourceMap[key] = { ref: ref || 'Orgánico', arrived: 0, purchased: 0 }
    sourceMap[key].arrived++
    if (purchasedUsers.has(wa)) sourceMap[key].purchased++
  }
  const sources = Object.values(sourceMap).sort((a, b) => b.arrived - a.arrived)

  res.json({ stats, sources })
})

// --- Prompt ---
router.get('/api/prompt', (req, res) => {
  res.json(storage.getPrompt())
})

router.put('/api/prompt', (req, res) => {
  storage.setPrompt(req.body)
  res.json({ ok: true })
})

// --- Knowledge ---
router.get('/api/knowledge', (req, res) => {
  res.json(storage.getKnowledge())
})

router.post('/api/knowledge', (req, res) => {
  const entry = storage.addKnowledge(req.body)
  res.status(201).json(entry)
})

router.put('/api/knowledge/:id', (req, res) => {
  const updated = storage.updateKnowledge(req.params.id, req.body)
  if (!updated) return res.status(404).json({ error: 'No encontrado' })
  res.json(updated)
})

router.delete('/api/knowledge/:id', (req, res) => {
  const deleted = storage.deleteKnowledge(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'No encontrado' })
  res.json({ ok: true })
})

// --- Tickets ---
router.get('/api/tickets', (req, res) => {
  res.json(storage.getTickets())
})

router.put('/api/tickets/:id', (req, res) => {
  const updated = storage.updateTicket(req.params.id, req.body)
  if (!updated) return res.status(404).json({ error: 'Ticket no encontrado' })
  res.json(updated)
})

router.delete('/api/tickets/:id', (req, res) => {
  const deleted = storage.deleteTicket(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'Ticket no encontrado' })
  res.json({ ok: true })
})

// --- Media ---
router.get('/api/media', (req, res) => {
  res.json(storage.getMedia())
})

router.post('/api/media', (req, res) => {
  const entry = storage.addMedia(req.body)
  res.status(201).json(entry)
})

router.put('/api/media/:id', (req, res) => {
  const updated = storage.updateMedia(req.params.id, req.body)
  if (!updated) return res.status(404).json({ error: 'Media no encontrado' })
  res.json(updated)
})

router.delete('/api/media/:id', (req, res) => {
  // Check if media is in use by any option or flow
  const flows = storage.getFlows()
  const usedByOption = (flows.options || []).find(o => o.mediaId === req.params.id)
  if (usedByOption) return res.status(400).json({ error: 'Media en uso por opción "' + usedByOption.label + '"' })
  const usedByFlow = (flows.flows || []).find(f => {
    if (f.completionMediaId === req.params.id) return true
    return (f.steps || []).some(s =>
      (s.choices || []).some(c => c.mediaId === req.params.id)
    )
  })
  if (usedByFlow) return res.status(400).json({ error: 'Media en uso por flujo "' + usedByFlow.name + '"' })
  const deleted = storage.deleteMedia(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'Media no encontrado' })
  res.json({ ok: true })
})

// --- Banks ---
router.get('/api/banks', (req, res) => {
  res.json(storage.getBanks())
})

router.post('/api/banks', (req, res) => {
  const entry = storage.addBank(req.body)
  res.status(201).json(entry)
})

router.put('/api/banks/:id', (req, res) => {
  const updated = storage.updateBank(req.params.id, req.body)
  if (!updated) return res.status(404).json({ error: 'Banco no encontrado' })
  res.json(updated)
})

router.delete('/api/banks/:id', (req, res) => {
  const deleted = storage.deleteBank(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'Banco no encontrado' })
  res.json({ ok: true })
})

// --- Transfers ---
router.get('/api/transfers', (req, res) => {
  res.json(storage.getTransfers())
})

router.put('/api/transfers/:id', async (req, res) => {
  const updates = req.body
  if (updates.status === 'verified' || updates.status === 'rejected') {
    updates.reviewedAt = new Date().toISOString()
  }
  const updated = storage.updateTransfer(req.params.id, updates)
  if (!updated) return res.status(404).json({ error: 'Transferencia no encontrada' })

  // Notify user via WhatsApp on status change
  if (updated.from && updates.status === 'verified') {
    try {
      await sendMessage(updated.from, `🎉 *¡Pago confirmado!*\n\nTu transferencia ha sido verificada.\n\n📦 Pedido: ${updated.planName || ''}\n📋 Referencia: ${updated.tradeNo || ''}\n\nNos pondremos en contacto contigo para coordinar la entrega. ¡Gracias por tu compra! 👟\n\nEscribe *menú* para volver al inicio.`)
    } catch (e) {
      console.error('Error notificando pago verificado:', e.message)
    }
  } else if (updated.from && updates.status === 'rejected') {
    try {
      await sendMessage(updated.from, `⚠️ *Transferencia no verificada*\n\nNo pudimos confirmar tu comprobante de pago.\n\n📋 Referencia: ${updated.tradeNo || ''}\n\nSi crees que es un error, envía tu comprobante de nuevo o escribe *asesor* para hablar con nosotros.`)
    } catch (e) {
      console.error('Error notificando pago rechazado:', e.message)
    }
  }

  res.json(updated)
})

router.delete('/api/transfers/:id', (req, res) => {
  const deleted = storage.deleteTransfer(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'Transferencia no encontrada' })
  res.json({ ok: true })
})

// --- Logs ---
router.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50
  res.json(storage.getLogs(limit))
})

router.delete('/api/logs', (req, res) => {
  storage.clearLogs()
  res.json({ ok: true })
})


router.get('/api/stats', (req, res) => {
  const logs = storage.getLogs(5000)
  const total = logs.length

  // Intent counts
  const intents = {}
  logs.forEach(l => {
    const key = l.intent || 'sin_intent'
    intents[key] = (intents[key] || 0) + 1
  })
  const intentList = Object.entries(intents)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  // Unique users
  const users = {}
  logs.forEach(l => {
    if (l.from) users[l.from] = (users[l.from] || 0) + 1
  })
  const topUsers = Object.entries(users)
    .map(([phone, count]) => ({ phone, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const mxDate = ts => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })

  // Messages today
  const today = mxDate(Date.now())
  const todayLogs = logs.filter(l => l.timestamp && mxDate(l.timestamp) === today)
  const todayCount = todayLogs.length
  const uniqueUsersToday = new Set(todayLogs.map(l => l.from).filter(Boolean)).size

  // Messages + unique users per day (last 7 days) — from persistent daily stats
  const dailyStats = storage.getDailyStats()
  const perDay = {}
  const perDayUsers = {}
  for (let i = 6; i >= 0; i--) {
    const day = mxDate(Date.now() - i * 86400000)
    const entry = dailyStats.daily[day]
    perDay[day] = entry ? (typeof entry === 'number' ? entry : entry.messages) : 0
    perDayUsers[day] = entry && typeof entry === 'object' ? entry.users.length : 0
  }

  res.json({
    total,
    todayCount,
    uniqueUsers: Object.keys(users).length,
    uniqueUsersToday,
    intents: intentList,
    topUsers,
    perDay,
    perDayUsers
  })
})

module.exports = router
