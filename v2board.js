const config = require('./config')

function apiBase() { return config.V2BOARD_API_BASE || '/api/v1' }
function adminPrefix() { return `${apiBase()}/${config.V2BOARD_ADMIN_PATH || 'DemianRed'}` }

let cachedToken = null
let tokenExpiresAt = 0

let cachedV2Config = null
let v2ConfigExpiresAt = 0

const PERIOD_MAP = {
  month_price: 'Mensual',
  quarter_price: 'Trimestral',
  half_year_price: 'Semestral',
  year_price: 'Anual',
  two_year_price: '2 Años',
  three_year_price: '3 Años',
  onetime_price: 'Pago único'
}

function panelUrl() {
  return (config.V2BOARD_PANEL_URL || 'https://v2.demianred.com').replace(/\/+$/, '')
}

async function apiFetch(path, options = {}) {
  const url = `${panelUrl()}${path}`
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  try {
    const res = await fetch(url, { ...options, headers })
    const data = await res.json()
    return data
  } catch (err) {
    console.error(`[V2BOARD] API error ${path}:`, err.message)
    return null
  }
}

async function getAuthToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken

  const email = config.V2BOARD_ADMIN_EMAIL || process.env.V2BOARD_ADMIN_EMAIL
  const password = config.V2BOARD_ADMIN_PASSWORD || process.env.V2BOARD_ADMIN_PASSWORD
  if (!email || !password) {
    console.error('[V2BOARD] Missing V2BOARD_ADMIN_EMAIL or V2BOARD_ADMIN_PASSWORD')
    return null
  }

  const data = await apiFetch(`${apiBase()}/passport/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })

  if (!data || !data.data?.auth_data) {
    console.error('[V2BOARD] Admin login failed:', data)
    return null
  }

  cachedToken = data.data.auth_data
  tokenExpiresAt = Date.now() + 50 * 60 * 1000 // 50 min cache
  console.log('[V2BOARD] Admin token refreshed')
  return cachedToken
}

async function getPlans() {
  const token = await getAuthToken()
  if (!token) return null

  const data = await apiFetch(`${adminPrefix()}/plan/fetch`, {
    headers: { Authorization: token }
  })

  if (!data || !data.data) {
    console.error('[V2BOARD] Failed to fetch plans:', data)
    return null
  }

  const plans = data.data
    .filter(p => p.show === 1)
    .map(p => {
      const periods = []
      for (const [key, label] of Object.entries(PERIOD_MAP)) {
        if (p[key] !== null && p[key] !== undefined && p[key] > 0) {
          periods.push({ key, label, price: p[key] / 100 })
        }
      }
      return {
        id: p.id,
        name: p.name,
        content: p.content || '',
        periods
      }
    })
    .filter(p => p.periods.length > 0)

  return plans
}

async function getUserByEmail(email) {
  const token = await getAuthToken()
  if (!token) return null

  const params = new URLSearchParams({
    'filter[0][key]': 'email',
    'filter[0][condition]': '=',
    'filter[0][value]': email
  })
  const data = await apiFetch(`${adminPrefix()}/user/fetch?${params}`, {
    headers: { Authorization: token }
  })

  if (!data || !data.data) return null

  const users = Array.isArray(data.data) ? data.data : data.data.data
  if (!users || users.length === 0) return null
  return users.find(u => u.email === email) || null
}

const { execFileSync } = require('child_process')
const TEMP_PASS = 'V2BotTmp_' + Date.now().toString(36)

function dbQuery(sql) {
  try {
    const dbUser = config.V2BOARD_DB_USER || 'v2DRnew'
    const dbPass = config.V2BOARD_DB_PASS || 'MWRyiDCFdhciKChY'
    const dbName = config.V2BOARD_DB_NAME || 'v2drnew'
    return execFileSync('mysql', [
      '-u', dbUser, `-p${dbPass}`, dbName, '-N', '-e', sql
    ], { encoding: 'utf8', timeout: 5000 }).trim()
  } catch (err) {
    console.error('[V2BOARD] DB error:', err.message)
    return null
  }
}

async function createAndCheckoutOrder({ userId, email, planId, period, methodId }) {
  // Atomic: save hash+inviter → temp pass → login as user → create order → checkout → restore
  const originalData = dbQuery(`SELECT password, COALESCE(invite_user_id, '') FROM v2_user WHERE id=${Number(userId)}`)
  if (!originalData) throw new Error('Could not read user data')
  const [originalHash, inviterRaw] = originalData.split('\t')
  const originalInviterId = inviterRaw && inviterRaw !== '' ? inviterRaw : null

  try {
    // 1. Set temp password via admin API
    const adminToken = await getAuthToken()
    const updateRes = await apiFetch(`${adminPrefix()}/user/update`, {
      method: 'POST',
      headers: { Authorization: adminToken },
      body: JSON.stringify({
        id: userId,
        email,
        password: TEMP_PASS,
        banned: 0,
        is_admin: 0,
        is_staff: 0
      })
    })
    if (!updateRes || !updateRes.data) throw new Error('Failed to set temp password')

    // Restore invite_user_id immediately — admin update may have cleared it
    if (originalInviterId) {
      dbQuery(`UPDATE v2_user SET invite_user_id=${Number(originalInviterId)} WHERE id=${Number(userId)}`)
    }

    // 2. Login as user
    const loginRes = await apiFetch(`${apiBase()}/passport/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password: TEMP_PASS })
    })
    if (!loginRes?.data?.auth_data) throw new Error('Failed to login as user')
    const userAuth = loginRes.data.auth_data

    // 3. Create order via user API (generates timestamp-format trade_no)
    const orderRes = await apiFetch(`${apiBase()}/user/order/save`, {
      method: 'POST',
      headers: { Authorization: userAuth },
      body: JSON.stringify({ plan_id: planId, period })
    })
    if (!orderRes || !orderRes.data) {
      console.error('[V2BOARD] Failed to create user order:', orderRes)
      throw new Error(orderRes?.message || 'Failed to create order')
    }
    const tradeNo = orderRes.data

    // 4. Fetch order detail to get actual total_amount (after balance discount)
    const detailRes = await apiFetch(`${apiBase()}/user/order/detail?trade_no=${tradeNo}`, {
      headers: { Authorization: userAuth }
    })
    const totalAmount = detailRes?.data?.total_amount ?? null

    // 5. Checkout order
    const checkoutRes = await apiFetch(`${apiBase()}/user/order/checkout`, {
      method: 'POST',
      headers: { Authorization: userAuth },
      body: JSON.stringify({ trade_no: tradeNo, method: methodId })
    })
    if (!checkoutRes) throw new Error('Checkout request failed')
    if (checkoutRes.message) throw new Error(checkoutRes.message)

    console.log('[V2BOARD] Order created & checkout success:', tradeNo)
    return { tradeNo, payUrl: checkoutRes.data, totalAmount }
  } finally {
    // Always restore original password hash and inviter
    const escaped = originalHash.replace(/'/g, "\\'")
    const inviterUpdate = originalInviterId ? `, invite_user_id=${Number(originalInviterId)}` : `, invite_user_id=NULL`
    dbQuery(`UPDATE v2_user SET password='${escaped}'${inviterUpdate} WHERE id=${Number(userId)}`)
    console.log('[V2BOARD] Password hash and inviter restored for user', userId)
  }
}

async function getOrderStatus(tradeNo) {
  const token = await getAuthToken()
  if (!token) return null

  const params = new URLSearchParams({
    'filter[0][key]': 'trade_no',
    'filter[0][condition]': '=',
    'filter[0][value]': tradeNo
  })
  const data = await apiFetch(`${adminPrefix()}/order/fetch?${params}`, {
    headers: { Authorization: token }
  })

  if (!data || !data.data) return null

  const orders = Array.isArray(data.data) ? data.data : data.data.data
  if (!orders || orders.length === 0) return null
  return orders[0]
}

async function getPendingOrders(userId) {
  const token = await getAuthToken()
  if (!token) return null

  const params = new URLSearchParams({
    'filter[0][key]': 'user_id',
    'filter[0][condition]': '=',
    'filter[0][value]': String(userId),
    'filter[1][key]': 'status',
    'filter[1][condition]': '=',
    'filter[1][value]': '0'
  })
  const data = await apiFetch(`${adminPrefix()}/order/fetch?${params}`, {
    headers: { Authorization: token }
  })

  if (!data || !data.data) return []
  const orders = Array.isArray(data.data) ? data.data : data.data.data
  return orders || []
}

async function cancelOrder(tradeNo) {
  const token = await getAuthToken()
  if (!token) return false

  const data = await apiFetch(`${adminPrefix()}/order/cancel`, {
    method: 'POST',
    headers: { Authorization: token },
    body: JSON.stringify({ trade_no: tradeNo })
  })

  return data && data.data === true
}

async function getPaymentMethods() {
  const token = await getAuthToken()
  if (!token) return null

  const data = await apiFetch(`${apiBase()}/user/order/getPaymentMethod`, {
    headers: { Authorization: token }
  })

  if (!data || !data.data) return null
  return data.data
}

async function checkoutOrder({ userId, email, tradeNo, methodId }) {
  // 1. Save original password hash and inviter
  const originalData = dbQuery(`SELECT password, COALESCE(invite_user_id, '') FROM v2_user WHERE id=${Number(userId)}`)
  if (!originalData) throw new Error('Could not read user data')
  const [originalHash, inviterRaw] = originalData.split('\t')
  const originalInviterId = inviterRaw && inviterRaw !== '' ? inviterRaw : null

  try {
    // 2. Set temp password via admin API
    const adminToken = await getAuthToken()
    const updateRes = await apiFetch(`${adminPrefix()}/user/update`, {
      method: 'POST',
      headers: { Authorization: adminToken },
      body: JSON.stringify({
        id: userId,
        email,
        password: TEMP_PASS,
        banned: 0,
        is_admin: 0,
        is_staff: 0
      })
    })
    if (!updateRes || !updateRes.data) throw new Error('Failed to set temp password')

    // Restore invite_user_id immediately — admin update may have cleared it
    if (originalInviterId) {
      dbQuery(`UPDATE v2_user SET invite_user_id=${Number(originalInviterId)} WHERE id=${Number(userId)}`)
    }

    // 3. Login as user
    const loginRes = await apiFetch(`${apiBase()}/passport/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password: TEMP_PASS })
    })
    if (!loginRes?.data?.auth_data) throw new Error('Failed to login as user')
    const userAuth = loginRes.data.auth_data

    // 4. Checkout
    const checkoutRes = await apiFetch(`${apiBase()}/user/order/checkout`, {
      method: 'POST',
      headers: { Authorization: userAuth },
      body: JSON.stringify({ trade_no: tradeNo, method: methodId })
    })

    if (!checkoutRes) throw new Error('Checkout request failed')
    if (checkoutRes.message) throw new Error(checkoutRes.message)

    console.log('[V2BOARD] Checkout success for order', tradeNo)
    return checkoutRes.data
  } finally {
    // Always restore original password hash and inviter
    const escaped = originalHash.replace(/'/g, "\\'")
    const inviterUpdate = originalInviterId ? `, invite_user_id=${Number(originalInviterId)}` : `, invite_user_id=NULL`
    dbQuery(`UPDATE v2_user SET password='${escaped}'${inviterUpdate} WHERE id=${Number(userId)}`)
    console.log('[V2BOARD] Password hash and inviter restored for user', userId)
  }
}

async function getV2BoardConfig() {
  if (cachedV2Config && Date.now() < v2ConfigExpiresAt) return cachedV2Config

  const data = await apiFetch(`${adminPrefix()}/config/fetch`, {
    headers: { Authorization: await getAuthToken() }
  })

  if (!data || !data.data) {
    console.error('[V2BOARD] Failed to fetch panel config:', data)
    return null
  }

  const safe = data.data.safe || {}
  const invite = data.data.invite || {}
  const site = data.data.site || {}

  cachedV2Config = {
    emailVerify: !!safe.email_verify,
    emailWhitelistEnable: !!safe.email_whitelist_enable,
    emailWhitelistSuffix: Array.isArray(safe.email_whitelist_suffix) ? safe.email_whitelist_suffix : (safe.email_whitelist_suffix ? String(safe.email_whitelist_suffix).split(',').map(s => s.trim()).filter(Boolean) : []),
    recaptchaEnable: !!safe.recaptcha_enable,
    inviteForce: !!invite.invite_force,
    stopRegister: !!site.stop_register
  }
  v2ConfigExpiresAt = Date.now() + 5 * 60 * 1000
  console.log('[V2BOARD] Panel config cached:', cachedV2Config)
  return cachedV2Config
}

async function sendEmailVerify(email) {
  const data = await apiFetch(`${apiBase()}/passport/comm/sendEmailVerify`, {
    method: 'POST',
    body: JSON.stringify({ email })
  })
  return data
}

async function registerUser(email, password, emailCode, inviteCode) {
  const body = { email, password }
  if (emailCode) body.email_code = emailCode
  if (inviteCode) body.invite_code = inviteCode

  const data = await apiFetch(`${apiBase()}/passport/auth/register`, {
    method: 'POST',
    body: JSON.stringify(body)
  })
  return data
}

async function loginUser(email, password) {
  const data = await apiFetch(`${apiBase()}/passport/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
  if (!data || !data.data?.auth_data) return null
  return data.data.auth_data
}

async function getSubscribeUrl(authData) {
  const data = await apiFetch(`${apiBase()}/user/getSubscribe`, {
    headers: { Authorization: authData }
  })
  if (!data || !data.data) return null
  return data.data.subscribe_url || null
}

function creditBalance(userId, amount) {
  const result = dbQuery(`UPDATE v2_user SET balance = balance + ${Number(amount)} WHERE id = ${Number(userId)}`)
  return result !== null
}

module.exports = { getPlans, getUserByEmail, createAndCheckoutOrder, getOrderStatus, getPendingOrders, cancelOrder, getPaymentMethods, checkoutOrder, panelUrl, PERIOD_MAP, getV2BoardConfig, sendEmailVerify, registerUser, loginUser, getSubscribeUrl, apiFetch, apiBase, adminPrefix, getAuthToken, creditBalance }
