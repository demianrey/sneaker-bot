const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, 'data', 'config.json')
const RELOAD_MS = 60 * 1000

const HARDCODED = {
  HUMAN_WA: '524422750302',
  BOT_WA: '524465211903',
  PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=com.vpnmax',
  SITE_URL: 'https://vpnmax.com.mx',
  SUPPORT_HOURS: 'Lun-Vie 9am-6pm',
  STATE_TTL_MS: 10 * 60 * 1000
}

let cached = null
let lastLoad = 0

function loadConfig() {
  const now = Date.now()
  if (cached && now - lastLoad < RELOAD_MS) return cached
  try {
    cached = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    lastLoad = now
  } catch {
    cached = { ...HARDCODED }
    lastLoad = now
  }
  return cached
}

module.exports = new Proxy({}, {
  get(_, key) {
    const cfg = loadConfig()
    return cfg[key] !== undefined ? cfg[key] : HARDCODED[key]
  }
})
