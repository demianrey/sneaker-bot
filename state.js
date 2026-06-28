const { STATE_TTL_MS } = require('./config')

const sessions = new Map()

function getState(userId) {
  const session = sessions.get(userId)
  if (!session) return null
  if (Date.now() - session.updatedAt > STATE_TTL_MS) {
    sessions.delete(userId)
    return null
  }
  return session
}

function setState(userId, updates) {
  const current = getState(userId) || {}
  sessions.set(userId, { ...current, ...updates, updatedAt: Date.now() })
}

function resetState(userId) {
  sessions.delete(userId)
}

// Cleanup expiradas cada 15 min
setInterval(() => {
  const now = Date.now()
  for (const [userId, session] of sessions) {
    if (now - session.updatedAt > STATE_TTL_MS) {
      sessions.delete(userId)
    }
  }
}, 15 * 60 * 1000)

module.exports = { getState, setState, resetState }
