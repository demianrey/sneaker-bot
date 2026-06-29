const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, '..', 'data')
const MAX_LOGS = 5000

const DEFAULTS = {
  'config.json': {
    HUMAN_WA: '524422750302',
    BOT_WA: '524465211903',
    PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=com.vpnmax',
    SITE_URL: 'https://vpnmax.com.mx',
    SUPPORT_HOURS: 'Lun-Vie 9am-6pm',
    STATE_TTL_MS: 600000,
    V2BOARD_ADMIN_EMAIL: 'bot@demianred.com',
    V2BOARD_ADMIN_PASSWORD: 'D@r22hez87',
    V2BOARD_ADMIN_PATH: 'DemianRed',
    V2BOARD_API_BASE: '/api/v1',
    V2BOARD_DB_USER: 'v2DRnew',
    V2BOARD_DB_PASS: 'MWRyiDCFdhciKChY',
    V2BOARD_DB_NAME: 'v2drnew',
    V2BOARD_PANEL_URL: 'https://v2.demianred.com',
    BOT_BASE_URL: 'https://bot.demianred.com'
  },
  'flows.json': {
    menu: {
      triggers: ['hola', 'menu', 'menú', 'inicio', 'hey', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches'],
      fullMenuHeader: '*VpnMax* - Internet sin saldo',
      fullMenuFooter: 'Responde con el *número* de la opción.',
      shortMenuHeader: '¿En qué te ayudo?',
      fullMenu: '*VpnMax* - Internet sin saldo\n\n1️⃣ ¿Cómo funciona?\n2️⃣ Precios y planes\n3️⃣ Soporte técnico\n4️⃣ Hablar con asesor\n\nResponde con el *número* de la opción.',
      shortMenu: '¿En qué te ayudo?\n\n1️⃣ Cómo funciona  2️⃣ Planes  3️⃣ Soporte  4️⃣ Asesor',
      cooldownMs: 120000
    },
    options: [
      {
        id: 'opt_1',
        key: '1',
        label: 'Cómo funciona',
        intent: 'how',
        response: '*¿Cómo funciona VpnMax?*\n\n1. Descarga la app desde Play Store\n2. Regístrate con tu número\n3. Elige un plan y paga\n4. Activa la VPN y navega sin saldo\n\nDescarga aquí: {{PLAY_STORE_URL}}\nMás info: {{SITE_URL}}',
        flowId: null
      },
      {
        id: 'opt_2',
        key: '2',
        label: 'Precios y planes',
        intent: 'pricing',
        response: '*Planes VpnMax*\n\n- *Mensual* — El más popular\n- *Trimestral* — Mejor precio por mes\n- *Semestral* — Máximo ahorro\n\nConsulta precios y compra en:\n{{SITE_URL}}\n\n¿Te interesa alguno?',
        flowId: null
      },
      {
        id: 'opt_3',
        key: '3',
        label: 'Soporte técnico',
        intent: 'support',
        response: '*Soporte técnico*\n\nPara ayudarte mejor, necesito unos datos.',
        flowId: 'support_flow'
      },
      {
        id: 'opt_4',
        key: '4',
        label: 'Hablar con asesor',
        intent: 'advisor',
        response: '*Hablar con asesor*\n\nEscríbele directamente aquí:\nhttps://wa.me/{{HUMAN_WA}}\n\nHorario de atención: {{SUPPORT_HOURS}}\n\nTe responderán lo antes posible.',
        flowId: null
      }
    ],
    flows: [
      {
        id: 'support_flow',
        name: 'Soporte Técnico',
        steps: [
          { id: 's1', message: '¿Cuál es el *modelo de tu teléfono*? (ej. Samsung A54, iPhone 13)', inputType: 'text', varName: 'phone' },
          { id: 's2', message: '¿Qué sistema operativo tienes?\n\n1️⃣ Android\n2️⃣ iOS (iPhone)', inputType: 'choice', varName: 'os',
            choices: [
              { key: '1', label: 'Android', value: 'Android', aliases: ['android'] },
              { key: '2', label: 'iOS', value: 'iOS', aliases: ['ios', 'iphone'] }
            ]
          },
          { id: 's3', message: '¿Qué error te aparece o qué problema tienes? Descríbelo brevemente.', inputType: 'text', varName: 'error' }
        ],
        completionMessage: 'Listo, aquí está tu resumen:\n\n*Modelo:* {{phone}}\n*Sistema:* {{os}}\n*Problema:* {{error}}\n\nUn asesor te contactará pronto.\nHorario: {{SUPPORT_HOURS}}\n\nO escríbele directo: https://wa.me/{{HUMAN_WA}}'
      }
    ]
  },
  'prompt.json': {
    systemPrompt: `Eres el asistente oficial de VpnMax por WhatsApp.
Hablas español mexicano, amigable y directo.
Respuestas cortas (max 3 oraciones).
Guias al usuario a registrarse y comprar.

Info clave:
- Descarga: {{PLAY_STORE_URL}}
- Sitio web: {{SITE_URL}}
- Soporte humano: {{SUPPORT_HOURS}}

Menu disponible:
1. Como funciona  2. Precios  3. Soporte  4. Hablar con asesor

Si el usuario pregunta algo fuera de VPN/internet, redirige amablemente al tema.`
  },
  'knowledge.json': [],
  'conversations.json': [],
  'tickets.json': [],
  'media.json': [],
  'users.json': [],
  'banks.json': [],
  'transfers.json': [],
  'funnel.json': [],
  'catalog.json': [],
  'meta.json': {}
}

function readJSON(file) {
  const filePath = path.join(DATA_DIR, file)
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return DEFAULTS[file] !== undefined ? JSON.parse(JSON.stringify(DEFAULTS[file])) : null
  }
}

function writeJSON(file, data) {
  const filePath = path.join(DATA_DIR, file)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function initDefaults() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  for (const [file, defaultData] of Object.entries(DEFAULTS)) {
    const filePath = path.join(DATA_DIR, file)
    if (!fs.existsSync(filePath)) {
      writeJSON(file, defaultData)
    }
  }
  // Migrate: if flows.json was just created and config.json has old menu keys, pull them in
  migrateFlowsFromConfig()
}

function migrateFlowsFromConfig() {
  const config = readJSON('config.json')
  if (!config) return
  const hasMenuKeys = config.MENU_TRIGGERS !== undefined ||
                      config.FULL_MENU !== undefined ||
                      config.SHORT_MENU !== undefined ||
                      config.MENU_COOLDOWN_MS !== undefined
  if (!hasMenuKeys) return

  const flows = readJSON('flows.json')
  if (!flows) return

  // Migrate menu triggers
  if (config.MENU_TRIGGERS) {
    flows.menu.triggers = config.MENU_TRIGGERS.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
  }
  if (config.FULL_MENU) {
    flows.menu.fullMenu = config.FULL_MENU.replace(/\\n/g, '\n')
  }
  if (config.SHORT_MENU) {
    flows.menu.shortMenu = config.SHORT_MENU.replace(/\\n/g, '\n')
  }
  if (config.MENU_COOLDOWN_MS !== undefined) {
    flows.menu.cooldownMs = Number(config.MENU_COOLDOWN_MS)
  }
  writeJSON('flows.json', flows)

  // Clean old keys from config
  delete config.MENU_TRIGGERS
  delete config.FULL_MENU
  delete config.SHORT_MENU
  delete config.MENU_COOLDOWN_MS
  writeJSON('config.json', config)
}

// Flows
function getFlows() {
  return readJSON('flows.json')
}

function setFlows(data) {
  writeJSON('flows.json', data)
}

function addFlow(flow) {
  const flows = getFlows()
  flow.id = flow.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  flows.flows.push(flow)
  writeJSON('flows.json', flows)
  return flow
}

function updateFlow(id, updates) {
  const flows = getFlows()
  const idx = flows.flows.findIndex(f => f.id === id)
  if (idx === -1) return null
  flows.flows[idx] = { ...flows.flows[idx], ...updates, id }
  writeJSON('flows.json', flows)
  return flows.flows[idx]
}

function deleteFlow(id) {
  const flows = getFlows()
  // Check if flow is in use by any option
  const inUse = flows.options.some(o => o.flowId === id)
  if (inUse) return { error: 'Flow is in use by an option' }
  const idx = flows.flows.findIndex(f => f.id === id)
  if (idx === -1) return false
  flows.flows.splice(idx, 1)
  writeJSON('flows.json', flows)
  return true
}

// Config
function getConfig() {
  return readJSON('config.json')
}

function setConfig(data) {
  writeJSON('config.json', data)
}

// Prompt
function getPrompt() {
  return readJSON('prompt.json')
}

function setPrompt(data) {
  writeJSON('prompt.json', data)
}

// Knowledge
function getKnowledge() {
  return readJSON('knowledge.json') || []
}

function addKnowledge(entry) {
  const kb = getKnowledge()
  entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  entry.enabled = entry.enabled !== undefined ? entry.enabled : true
  kb.push(entry)
  writeJSON('knowledge.json', kb)
  return entry
}

function updateKnowledge(id, updates) {
  const kb = getKnowledge()
  const idx = kb.findIndex(e => e.id === id)
  if (idx === -1) return null
  kb[idx] = { ...kb[idx], ...updates, id }
  writeJSON('knowledge.json', kb)
  return kb[idx]
}

function deleteKnowledge(id) {
  const kb = getKnowledge()
  const idx = kb.findIndex(e => e.id === id)
  if (idx === -1) return false
  kb.splice(idx, 1)
  writeJSON('knowledge.json', kb)
  return true
}

// Daily stats (persistent — survives log pruning)
function mxDateKey(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
}

function getDailyStats() {
  let stats = readJSON('stats.json')
  const needsBackfill = !stats
  const needsMigration = stats && Object.values(stats.daily || {}).some(v => typeof v === 'number')

  if (needsBackfill || needsMigration) {
    if (needsBackfill) stats = { daily: {} }
    // Build users-per-day from existing logs
    const existing = readJSON('conversations.json') || []
    const usersByDay = {}
    for (const l of existing) {
      if (!l.timestamp) continue
      const day = mxDateKey(l.timestamp)
      if (!usersByDay[day]) usersByDay[day] = new Set()
      if (l.from) usersByDay[day].add(l.from)
    }
    if (needsBackfill) {
      for (const l of existing) {
        if (!l.timestamp) continue
        const day = mxDateKey(l.timestamp)
        if (!stats.daily[day]) stats.daily[day] = { messages: 0, users: [] }
        stats.daily[day].messages++
      }
      for (const [day, set] of Object.entries(usersByDay)) {
        if (stats.daily[day]) stats.daily[day].users = [...set]
      }
    } else {
      // Migrate number → object, preserve message count, add users from logs
      for (const [day, val] of Object.entries(stats.daily)) {
        if (typeof val === 'number') {
          stats.daily[day] = { messages: val, users: usersByDay[day] ? [...usersByDay[day]] : [] }
        }
      }
    }
    writeJSON('stats.json', stats)
  }
  return stats
}

function incrementDailyStat(ts, from) {
  const stats = getDailyStats()
  const day = mxDateKey(ts)
  if (!stats.daily[day]) stats.daily[day] = { messages: 0, users: [] }
  stats.daily[day].messages++
  if (from && !stats.daily[day].users.includes(from)) stats.daily[day].users.push(from)
  writeJSON('stats.json', stats)
}

// Logs
function getLogs(limit = 50) {
  const logs = readJSON('conversations.json') || []
  return logs.slice(-limit)
}

function addLog(entry) {
  const logs = readJSON('conversations.json') || []
  entry.timestamp = new Date().toISOString()
  incrementDailyStat(entry.timestamp, entry.from)
  logs.push(entry)
  // Prune if over limit
  while (logs.length > MAX_LOGS) {
    logs.shift()
  }
  writeJSON('conversations.json', logs)
}

function clearLogs() {
  writeJSON('conversations.json', [])
}

function getLastMessageTimes() {
  const logs = readJSON('conversations.json') || []
  const times = {}
  for (const log of logs) {
    if (!log.from || !log.timestamp) continue
    const t = new Date(log.timestamp).getTime()
    if (!times[log.from] || t > times[log.from]) times[log.from] = t
  }
  return times
}

// Tickets
function getTickets() {
  return readJSON('tickets.json') || []
}

function addTicket(ticket) {
  const tickets = getTickets()
  ticket.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  ticket.status = 'open'
  ticket.createdAt = new Date().toISOString()
  tickets.push(ticket)
  writeJSON('tickets.json', tickets)
  return ticket
}

function updateTicket(id, updates) {
  const tickets = getTickets()
  const idx = tickets.findIndex(t => t.id === id)
  if (idx === -1) return null
  tickets[idx] = { ...tickets[idx], ...updates, id }
  writeJSON('tickets.json', tickets)
  return tickets[idx]
}

function deleteTicket(id) {
  const tickets = getTickets()
  const idx = tickets.findIndex(t => t.id === id)
  if (idx === -1) return false
  tickets.splice(idx, 1)
  writeJSON('tickets.json', tickets)
  return true
}

// Media
function getMedia() {
  return readJSON('media.json') || []
}

function addMedia(entry) {
  const media = getMedia()
  entry.id = 'media_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  media.push(entry)
  writeJSON('media.json', media)
  return entry
}

function updateMedia(id, updates) {
  const media = getMedia()
  const idx = media.findIndex(m => m.id === id)
  if (idx === -1) return null
  media[idx] = { ...media[idx], ...updates, id }
  writeJSON('media.json', media)
  return media[idx]
}

function deleteMedia(id) {
  const media = getMedia()
  const idx = media.findIndex(m => m.id === id)
  if (idx === -1) return false
  media.splice(idx, 1)
  writeJSON('media.json', media)
  return true
}

// Users (WhatsApp → Email mapping)
function getUsers() {
  return readJSON('users.json') || []
}

function getUserByWhatsApp(whatsapp) {
  const users = getUsers()
  return users.find(u => u.whatsapp === whatsapp) || null
}

function saveUserEmail(whatsapp, email, verified = false) {
  const users = getUsers()
  const now = new Date().toISOString()
  const idx = users.findIndex(u => u.whatsapp === whatsapp)
  if (idx !== -1) {
    // Only overwrite if new save is verified, or there's no verified email yet
    if (verified || !users[idx].verified) {
      users[idx].email = email
      users[idx].updatedAt = now
    }
    if (verified) users[idx].verified = true
  } else {
    users.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      whatsapp,
      email,
      verified,
      createdAt: now,
      updatedAt: now
    })
  }
  writeJSON('users.json', users)
}

function getUserEmail(whatsapp) {
  const user = getUserByWhatsApp(whatsapp)
  if (!user) return null
  if (user.verified) return user.email
  return null
}

function isKnownUser(whatsapp) {
  return getUsers().some(u => u.whatsapp === whatsapp)
}

function getFunnel() {
  return readJSON('funnel.json') || []
}

function logFunnelEvent(whatsapp, event, adRef) {
  const events = getFunnel()
  const entry = { whatsapp, event, at: new Date().toISOString() }
  if (adRef) entry.ref = adRef
  events.push(entry)
  writeJSON('funnel.json', events)
}

function markUserSeen(whatsapp, adRef) {
  if (isKnownUser(whatsapp)) return
  const users = getUsers()
  const entry = { whatsapp, seenAt: new Date().toISOString() }
  if (adRef) entry.adRef = adRef
  users.push(entry)
  writeJSON('users.json', users)
}

// Banks
function getBanks() {
  return readJSON('banks.json') || []
}

function addBank(entry) {
  const banks = getBanks()
  entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  entry.activa = entry.activa !== undefined ? entry.activa : true
  banks.push(entry)
  writeJSON('banks.json', banks)
  return entry
}

function updateBank(id, updates) {
  const banks = getBanks()
  const idx = banks.findIndex(b => b.id === id)
  if (idx === -1) return null
  banks[idx] = { ...banks[idx], ...updates, id }
  writeJSON('banks.json', banks)
  return banks[idx]
}

function deleteBank(id) {
  const banks = getBanks()
  const idx = banks.findIndex(b => b.id === id)
  if (idx === -1) return false
  banks.splice(idx, 1)
  writeJSON('banks.json', banks)
  return true
}

// Transfers
function getTransfers() {
  return readJSON('transfers.json') || []
}

function addTransfer(transfer) {
  const transfers = getTransfers()
  transfer.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  transfer.status = transfer.status || 'pending'
  transfer.createdAt = new Date().toISOString()
  transfer.reviewedAt = null
  transfers.push(transfer)
  writeJSON('transfers.json', transfers)
  return transfer
}

function updateTransfer(id, updates) {
  const transfers = getTransfers()
  const idx = transfers.findIndex(t => t.id === id)
  if (idx === -1) return null
  transfers[idx] = { ...transfers[idx], ...updates, id }
  writeJSON('transfers.json', transfers)
  return transfers[idx]
}

function deleteTransfer(id) {
  const transfers = getTransfers()
  const idx = transfers.findIndex(t => t.id === id)
  if (idx === -1) return false
  transfers.splice(idx, 1)
  writeJSON('transfers.json', transfers)
  return true
}

// Catalog
function getCatalog() {
  return readJSON('catalog.json') || []
}

function addProduct(product) {
  const catalog = getCatalog()
  product.id = 'prod_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  product.active = product.active !== undefined ? product.active : true
  product.createdAt = new Date().toISOString()
  catalog.push(product)
  writeJSON('catalog.json', catalog)
  return product
}

function updateProduct(id, updates) {
  const catalog = getCatalog()
  const idx = catalog.findIndex(p => p.id === id)
  if (idx === -1) return null
  catalog[idx] = { ...catalog[idx], ...updates, id }
  writeJSON('catalog.json', catalog)
  return catalog[idx]
}

function deleteProduct(id) {
  const catalog = getCatalog()
  const idx = catalog.findIndex(p => p.id === id)
  if (idx === -1) return false
  catalog.splice(idx, 1)
  writeJSON('catalog.json', catalog)
  return true
}

function getRatings() { return readJSON('ratings.json') || [] }

function addRating(rating) {
  const ratings = getRatings()
  const entry = { id: 'rating_' + Date.now(), ...rating }
  ratings.push(entry)
  writeJSON('ratings.json', ratings)
  return entry
}

function updateRating(id, changes) {
  const ratings = getRatings()
  const idx = ratings.findIndex(r => r.id === id)
  if (idx === -1) return null
  ratings[idx] = { ...ratings[idx], ...changes }
  writeJSON('ratings.json', ratings)
  return ratings[idx]
}

function deleteRating(id) {
  const ratings = getRatings()
  const idx = ratings.findIndex(r => r.id === id)
  if (idx === -1) return false
  ratings.splice(idx, 1)
  writeJSON('ratings.json', ratings)
  return true
}

module.exports = {
  readJSON,
  writeJSON,
  initDefaults,
  getFlows,
  setFlows,
  addFlow,
  updateFlow,
  deleteFlow,
  getConfig,
  setConfig,
  getPrompt,
  setPrompt,
  getKnowledge,
  addKnowledge,
  updateKnowledge,
  deleteKnowledge,
  getLogs,
  getLastMessageTimes,
  addLog,
  clearLogs,
  getTickets,
  addTicket,
  updateTicket,
  deleteTicket,
  getMedia,
  addMedia,
  updateMedia,
  deleteMedia,
  getUsers,
  getUserByWhatsApp,
  getUserEmail,
  saveUserEmail,
  isKnownUser,
  markUserSeen,
  getFunnel,
  logFunnelEvent,
  getBanks,
  addBank,
  updateBank,
  deleteBank,
  getTransfers,
  addTransfer,
  updateTransfer,
  deleteTransfer,
  getDailyStats,
  getRatings,
  addRating,
  updateRating,
  deleteRating,
  getCatalog,
  addProduct,
  updateProduct,
  deleteProduct
}
