const { getUserByEmail, getV2BoardConfig, sendEmailVerify, registerUser, loginUser, getSubscribeUrl, apiFetch, apiBase, adminPrefix, getAuthToken } = require('./v2board')
const { getUserByWhatsApp, saveUserEmail, logFunnelEvent } = require('./admin/storage')
const config = require('./config')

function isRegisterActive(state) {
  return state && !!state.registerStep
}

// Always point users to the VPNMax app instead of the v2board web panel
function appRegisterHint() {
  const android = config.PLAY_STORE_URL ? `🤖 Android: ${config.PLAY_STORE_URL}` : ''
  const apple = config.APP_STORE_URL ? `🍎 iPhone: ${config.APP_STORE_URL}` : ''
  const links = [android, apple].filter(Boolean).join('\n')
  return `Descarga la app VPNMax y regístrate ahí — recibes *1 GB gratis*:\n\n${links}`
}

function appLoginHint() {
  return 'Abre la app VPNMax e inicia sesión con tu correo y contraseña para ver tu enlace de suscripción.'
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function registerState(state) {
  return {
    registerStep: state.registerStep,
    registerEmail: state.registerEmail,
    registerEmailCode: state.registerEmailCode,
    registerPassword: state.registerPassword,
    registerInviteCode: state.registerInviteCode,
    registerConfig: state.registerConfig
  }
}

async function startRegisterFlow(from) {
  // Check if user already has an account mapped
  const saved = getUserByWhatsApp(from)
  if (saved && saved.email) {
    let panelUser
    try {
      panelUser = await getUserByEmail(saved.email)
    } catch { /* ignore */ }

    if (panelUser) {
      // User already has an account, offer to get subscribe URL
      return {
        reply: `Ya tienes una cuenta registrada: *${saved.email}*\n\n1️⃣ Obtener mi URL de suscripcion\n2️⃣ Crear otra cuenta\n\nResponde con el *numero*.`,
        updateState: { registerStep: 'HAS_ACCOUNT', registerEmail: saved.email }
      }
    }
  }

  // Load panel config
  let panelConfig
  try {
    panelConfig = await getV2BoardConfig()
  } catch (err) {
    console.error('[REGISTER] Error fetching config:', err.message)
    return {
      reply: 'No pude conectar con el servidor. Intenta en unos minutos.',
      updateState: null
    }
  }

  if (!panelConfig) {
    return {
      reply: 'No pude conectar con el servidor. Intenta en unos minutos.',
      updateState: null
    }
  }

  if (panelConfig.stopRegister) {
    return {
      reply: 'El registro esta deshabilitado temporalmente.\n\n' + appRegisterHint(),
      updateState: null
    }
  }

  if (panelConfig.recaptchaEnable) {
    return {
      reply: 'Por el momento no es posible registrarse por aqui.\n\n' + appRegisterHint(),
      updateState: null
    }
  }

  let domainMsg = ''
  if (panelConfig.emailWhitelistEnable && panelConfig.emailWhitelistSuffix.length > 0) {
    domainMsg = '\n\nCorreos permitidos: *' + panelConfig.emailWhitelistSuffix.join(', ') + '*'
  }

  return {
    reply: '¡Vamos a crear tu cuenta!' + domainMsg + '\n\nEscribe tu correo electronico:',
    updateState: {
      registerStep: 'AWAITING_EMAIL',
      registerConfig: panelConfig
    }
  }
}

async function handleRegisterFlow(msg, state, from) {
  const step = state.registerStep

  if (msg === 'cancelar') {
    return { reply: 'Registro cancelado. Escribe *hola* para ver el menu.', updateState: null }
  }

  switch (step) {
    case 'HAS_ACCOUNT':
      return await handleHasAccount(msg, state, from)
    case 'EMAIL_EXISTS':
      return await handleEmailExists(msg, state, from)
    case 'AWAITING_EMAIL':
      return await handleEmail(msg, state, from)
    case 'AWAITING_VERIFY_CODE':
      return await handleVerifyCode(msg, state, from)
    case 'AWAITING_PASSWORD':
      return await handlePassword(msg, state, from)
    case 'AWAITING_INVITE_CODE':
      return await handleInviteCode(msg, state, from)
    case 'AWAITING_INVITE_INPUT':
      return await handleInviteInput(msg, state, from)
    case 'AWAITING_SUB_PASSWORD':
      return await handleSubPassword(msg, state, from)
    default:
      return { reply: 'Algo salio mal. Escribe *hola* para reiniciar.', updateState: null }
  }
}

async function handleHasAccount(msg, state, from) {
  if (msg === '1') {
    // Ask for password before showing subscribe URL
    return {
      reply: 'Por seguridad, escribe la *contraseña* de tu cuenta:',
      updateState: { registerStep: 'AWAITING_SUB_PASSWORD', registerEmail: state.registerEmail }
    }
  }
  if (msg === '2') {
    // Start fresh registration
    let panelConfig
    try {
      panelConfig = await getV2BoardConfig()
    } catch { /* ignore */ }

    if (!panelConfig) {
      return { reply: 'No pude conectar con el servidor. Intenta en unos minutos.', updateState: null }
    }

    if (panelConfig.stopRegister) {
      return { reply: 'El registro esta deshabilitado temporalmente.', updateState: null }
    }

    if (panelConfig.recaptchaEnable) {
      return { reply: 'Por el momento no es posible registrarse por aqui.\n\n' + appRegisterHint(), updateState: null }
    }

    let domainMsg = ''
    if (panelConfig.emailWhitelistEnable && panelConfig.emailWhitelistSuffix.length > 0) {
      domainMsg = '\nCorreos permitidos: *' + panelConfig.emailWhitelistSuffix.join(', ') + '*'
    }

    return {
      reply: 'Escribe tu correo electronico:' + domainMsg,
      updateState: { registerStep: 'AWAITING_EMAIL', registerConfig: panelConfig }
    }
  }

  return {
    reply: 'Responde *1* para obtener tu URL o *2* para crear otra cuenta.',
    updateState: { ...registerState(state) }
  }
}

async function handleEmailExists(msg, state, from) {
  if (msg === '1') {
    // Ask for password before showing subscribe URL
    return {
      reply: 'Por seguridad, escribe la *contraseña* de tu cuenta:',
      updateState: { registerStep: 'AWAITING_SUB_PASSWORD', registerEmail: state.registerEmail, registerConfig: state.registerConfig }
    }
  }
  if (msg === '2') {
    // Exit register flow, let purchase flow handle it
    return {
      reply: 'Escribe *comprar* para ir a comprar suscripción.',
      updateState: null
    }
  }
  if (msg === '3') {
    return {
      reply: 'Escribe tu correo electronico:',
      updateState: { ...registerState(state), registerStep: 'AWAITING_EMAIL' }
    }
  }

  return {
    reply: 'Responde *1*, *2* o *3*.',
    updateState: { ...registerState(state) }
  }
}

async function handleEmail(msg, state, from) {
  const email = msg.toLowerCase().trim()

  if (!isValidEmail(email)) {
    return {
      reply: 'Ese correo no parece valido. Ejemplo: juan@gmail.com',
      updateState: { ...registerState(state) }
    }
  }

  const panelConfig = state.registerConfig || {}

  // Whitelist check
  if (panelConfig.emailWhitelistEnable && panelConfig.emailWhitelistSuffix && panelConfig.emailWhitelistSuffix.length > 0) {
    const domain = email.split('@')[1]
    if (!panelConfig.emailWhitelistSuffix.includes(domain)) {
      return {
        reply: 'Ese dominio no esta permitido.\n\nUsa un correo de: *' + panelConfig.emailWhitelistSuffix.join(', ') + '*',
        updateState: { ...registerState(state) }
      }
    }
  }

  // Check if email already exists in panel
  let panelUser
  try {
    panelUser = await getUserByEmail(email)
  } catch (err) {
    console.error('[REGISTER] Error checking email:', err.message)
    return {
      reply: 'No pude conectar con el servidor. Intenta de nuevo.',
      updateState: { ...registerState(state) }
    }
  }

  if (panelUser) {
    // Don't save email here — user hasn't verified identity with password yet
    return {
      reply: `Ya existe una cuenta con *${email}*.\n\n1️⃣ Obtener mi URL de suscripcion\n2️⃣ Ir a comprar suscripcion\n3️⃣ Usar otro correo\n\nResponde con el *numero*.`,
      updateState: { registerStep: 'EMAIL_EXISTS', registerEmail: email, registerConfig: panelConfig }
    }
  }

  // Email is available — proceed
  if (panelConfig.emailVerify) {
    // Send verification code
    let verifyResult
    try {
      verifyResult = await sendEmailVerify(email)
    } catch (err) {
      console.error('[REGISTER] Error sending verify:', err.message)
      return {
        reply: 'No pude enviar el codigo de verificacion. Intenta de nuevo.',
        updateState: { ...registerState(state) }
      }
    }

    if (!verifyResult || verifyResult.data !== true) {
      const errorMsg = verifyResult?.message || 'Error desconocido'
      return {
        reply: `No pude enviar el codigo: ${errorMsg}\n\nIntenta con otro correo o mas tarde.`,
        updateState: { ...registerState(state) }
      }
    }

    return {
      reply: `Te envie un codigo de verificacion a *${email}*\nRevisa tu bandeja de entrada (y la de spam).\n\nEscribe el codigo de 6 digitos:\n_(escribe *reenviar* si no lo recibes)_`,
      updateState: { ...registerState(state), registerStep: 'AWAITING_VERIFY_CODE', registerEmail: email }
    }
  }

  // No email verify — skip to password
  return {
    reply: 'Ahora crea tu contrasena (minimo 8 caracteres):',
    updateState: { ...registerState(state), registerStep: 'AWAITING_PASSWORD', registerEmail: email }
  }
}

async function handleVerifyCode(msg, state, from) {
  // Resend option
  if (msg === 'reenviar') {
    let verifyResult
    try {
      verifyResult = await sendEmailVerify(state.registerEmail)
    } catch { /* ignore */ }

    if (verifyResult && verifyResult.data === true) {
      return {
        reply: `Codigo reenviado a *${state.registerEmail}*\nEscribe el codigo de 6 digitos:`,
        updateState: { ...registerState(state) }
      }
    }

    const errorMsg = verifyResult?.message || 'Intenta en unos minutos'
    return {
      reply: `No pude reenviar el codigo: ${errorMsg}`,
      updateState: { ...registerState(state) }
    }
  }

  // Validate 6-digit code
  const code = msg.replace(/\s/g, '')
  if (!/^\d{6}$/.test(code)) {
    return {
      reply: 'El codigo debe ser de 6 digitos. Intenta de nuevo.\n_(escribe *reenviar* para recibir otro codigo)_',
      updateState: { ...registerState(state) }
    }
  }

  return {
    reply: 'Codigo verificado! Ahora crea tu contrasena (minimo 8 caracteres):',
    updateState: { ...registerState(state), registerStep: 'AWAITING_PASSWORD', registerEmailCode: code }
  }
}

async function handlePassword(msg, state, from) {
  // Use original text (msg is already lowercased in intents.js, we need original)
  // But since we receive msg lowercased, passwords will be lowercase.
  // We'll handle this by passing the raw message from intents.
  const password = msg

  if (password.length < 8) {
    return {
      reply: 'La contrasena debe tener al menos 8 caracteres. Intenta de nuevo:',
      updateState: { ...registerState(state) }
    }
  }

  return {
    reply: 'Tienes un codigo de invitacion?\n\n1️⃣ Si, tengo uno\n2️⃣ No tengo',
    updateState: { ...registerState(state), registerStep: 'AWAITING_INVITE_CODE', registerPassword: password }
  }
}

async function handleInviteCode(msg, state, from) {
  // Second-stage prompt shown when the invite code is mandatory: here "2" means
  // "cancel registration", NOT "I don't have a code" — handle it before the
  // generic 1/2 branch below, otherwise it loops back to the same forced message forever
  if (state.registerInviteForceShown) {
    if (msg === '1' || msg === 'si' || msg === 'sí') {
      return {
        reply: 'Escribe tu codigo de invitacion:',
        updateState: { ...registerState(state), registerStep: 'AWAITING_INVITE_INPUT', registerInviteForceShown: null }
      }
    }
    if (msg === '2' || msg === 'no' || msg === 'cancelar') {
      return { reply: 'Registro cancelado. Escribe *hola* para ver el menu.', updateState: null }
    }
    return {
      reply: 'Responde *1* si ya tienes un codigo, o *2* para cancelar el registro.',
      updateState: { ...registerState(state), registerInviteForceShown: true }
    }
  }

  if (msg === '1' || msg === 'si' || msg === 'sí') {
    return {
      reply: 'Escribe tu codigo de invitacion:',
      updateState: { ...registerState(state), registerStep: 'AWAITING_INVITE_INPUT' }
    }
  }

  if (msg === '2' || msg === 'no') {
    const panelConfig = state.registerConfig || {}

    if (panelConfig.inviteForce) {
      return {
        reply: 'El codigo de invitacion es obligatorio para registrarse.\n\nSi no tienes uno, contacta a un asesor: https://wa.me/' + (config.HUMAN_WA || '') + '\n\n1️⃣ Ya tengo uno\n2️⃣ Cancelar registro',
        updateState: { ...registerState(state), registerInviteForceShown: true }
      }
    }

    // No invite code needed, proceed to register
    return await doRegister(state, from, null)
  }

  return {
    reply: 'Responde *1* si tienes codigo o *2* si no.',
    updateState: { ...registerState(state) }
  }
}

async function handleInviteInput(msg, state, from) {
  const inviteCode = msg.trim()
  if (!inviteCode || inviteCode.length < 2) {
    return {
      reply: 'Escribe un codigo de invitacion valido:',
      updateState: { ...registerState(state) }
    }
  }

  return await doRegister(state, from, inviteCode)
}

async function doRegister(state, from, inviteCode) {
  const email = state.registerEmail
  const password = state.registerPassword
  const emailCode = state.registerEmailCode || null

  let result
  try {
    result = await registerUser(email, password, emailCode, inviteCode)
  } catch (err) {
    console.error('[REGISTER] Registration error:', err.message)
    return {
      reply: 'Hubo un error al crear tu cuenta. Intenta de nuevo o contacta a soporte.',
      updateState: null
    }
  }

  if (!result || !result.data) {
    const errorMsg = result?.message || 'Error desconocido'
    console.error('[REGISTER] Registration failed:', errorMsg)

    // Common error handling
    if (errorMsg.includes('exist') || errorMsg.includes('existe')) {
      return {
        reply: `Ese correo ya esta registrado. Escribe *hola* para volver al menu.`,
        updateState: null
      }
    }
    if (errorMsg.includes('invite') || errorMsg.includes('invit')) {
      return {
        reply: `Codigo de invitacion invalido. Intenta de nuevo escribiendo *registrarme*.`,
        updateState: null
      }
    }

    return {
      reply: `No se pudo crear la cuenta: ${errorMsg}\n\nIntenta de nuevo escribiendo *registrarme*.`,
      updateState: null
    }
  }

  const authData = result.data.auth_data || result.data.token
  if (!authData) {
    console.error('[REGISTER] No auth data in register response')
    return {
      reply: 'Cuenta creada pero no pude obtener tu URL. ' + appLoginHint(),
      updateState: null
    }
  }

  // Get subscribe URL
  let subscribeUrl
  try {
    subscribeUrl = await getSubscribeUrl(authData)
  } catch (err) {
    console.error('[REGISTER] Error getting subscribe URL:', err.message)
  }

  // Save email mapping — verified because account was just created
  saveUserEmail(from, email, true)

  const appStoreUrl = config.APP_STORE_URL || ''

  let reply = `Tu cuenta se creo correctamente!\n\n📧 Email: *${email}*`
  if (subscribeUrl) {
    reply += `\n\n🔗 URL de suscripcion:\n${subscribeUrl}`
    reply += '\n\nCopia esta URL y pegala en tu app VPN.'
    if (appStoreUrl) {
      reply += `\nSi usas iPhone, descarga VPNMax: ${appStoreUrl}`
    }
  } else {
    reply += '\n\nNo pude obtener tu URL de suscripcion. ' + appLoginHint()
  }
  reply += '\n\nEscribe *comprar* para comprar una suscripción o *hola* para el menú.'

  console.log('[REGISTER] Account created for', email, 'from', from)
  logFunnelEvent(from, 'register_completed')
  return { reply, updateState: null }
}

async function handleSubPassword(msg, state, from) {
  const password = msg
  const email = state.registerEmail

  // Try to login with the user's actual password
  let authData
  try {
    authData = await loginUser(email, password)
  } catch (err) {
    console.error('[REGISTER] Login error:', err.message)
    return {
      reply: 'No pude conectar con el servidor. Intenta de nuevo.',
      updateState: { ...registerState(state) }
    }
  }

  if (!authData) {
    return {
      reply: 'Contraseña incorrecta. Intenta de nuevo o escribe *cancelar*.',
      updateState: { ...registerState(state) }
    }
  }

  // Password verified — save as verified account
  saveUserEmail(from, email, true)

  // Get subscribe URL directly with the auth token
  let subscribeUrl
  try {
    subscribeUrl = await getSubscribeUrl(authData)
  } catch (err) {
    console.error('[REGISTER] Error getting subscribe URL:', err.message)
  }

  const appStoreUrl = config.APP_STORE_URL || ''
  let reply = `📧 Email: *${email}*`
  if (subscribeUrl) {
    reply += `\n\n🔗 URL de suscripcion:\n${subscribeUrl}`
    reply += '\n\nCopia esta URL y pegala en tu app VPN.'
    if (appStoreUrl) {
      reply += `\nSi usas iPhone, descarga VPNMax: ${appStoreUrl}`
    }
  } else {
    reply += '\n\nNo pude obtener tu URL. ' + appLoginHint()
  }
  reply += '\n\nEscribe *comprar* para comprar una suscripción o *hola* para el menú.'

  return { reply, updateState: null }
}

async function fetchSubscribeUrl(email, from) {
  let panelUser
  try {
    panelUser = await getUserByEmail(email)
  } catch { /* ignore */ }

  if (!panelUser) {
    return {
      reply: `No encontré una cuenta con *${email}*. Escribe *registrarme* para crear una nueva.`,
      updateState: null
    }
  }

  // Use temp password approach to login as user and get subscribe URL
  const { execFileSync } = require('child_process')
  const TEMP_PASS = 'V2BotTmp_' + Date.now().toString(36)
  const dbUser = config.V2BOARD_DB_USER || 'v2DRnew'
  const dbPass = config.V2BOARD_DB_PASS || 'MWRyiDCFdhciKChY'
  const dbName = config.V2BOARD_DB_NAME || 'v2drnew'

  let originalHash
  try {
    originalHash = execFileSync('mysql', [
      '-u', dbUser, `-p${dbPass}`, dbName, '-N', '-e',
      `SELECT password FROM v2_user WHERE id=${Number(panelUser.id)}`
    ], { encoding: 'utf8', timeout: 5000 }).trim()
  } catch (err) {
    console.error('[REGISTER] DB read error:', err.message)
    return {
      reply: 'No pude obtener tu URL. ' + appLoginHint(),
      updateState: null
    }
  }

  try {
    const adminToken = await getAuthToken()

    const updateRes = await apiFetch(`${adminPrefix()}/user/update`, {
      method: 'POST',
      headers: { Authorization: adminToken },
      body: JSON.stringify({
        id: panelUser.id,
        email,
        password: TEMP_PASS,
        banned: 0,
        is_admin: 0,
        is_staff: 0
      })
    })
    if (!updateRes || !updateRes.data) throw new Error('Failed to set temp password')

    // Login as user
    const loginRes = await apiFetch(`${apiBase()}/passport/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password: TEMP_PASS })
    })
    if (!loginRes?.data?.auth_data) throw new Error('Failed to login as user')

    const subscribeUrl = await getSubscribeUrl(loginRes.data.auth_data)

    const appStoreUrl = config.APP_STORE_URL || ''
    let reply = `📧 Email: *${email}*`
    if (subscribeUrl) {
      reply += `\n\n🔗 URL de suscripcion:\n${subscribeUrl}`
      reply += '\n\nCopia esta URL y pegala en tu app VPN.'
      if (appStoreUrl) {
        reply += `\nSi usas iPhone, descarga VPNMax: ${appStoreUrl}`
      }
    } else {
      reply += '\n\nNo pude obtener tu URL. ' + appLoginHint()
    }
    reply += '\n\nEscribe *comprar* para comprar una suscripción o *hola* para el menú.'

    return { reply, updateState: null }
  } finally {
    // Always restore original password hash
    try {
      const escaped = originalHash.replace(/'/g, "\\'")
      execFileSync('mysql', [
        '-u', dbUser, `-p${dbPass}`, dbName, '-N', '-e',
        `UPDATE v2_user SET password='${escaped}' WHERE id=${Number(panelUser.id)}`
      ], { encoding: 'utf8', timeout: 5000 })
    } catch (err) {
      console.error('[REGISTER] DB restore error:', err.message)
    }
  }
}

// Like startRegisterFlow but skips the "already has account" check — used when user explicitly wants a new account
async function startFreshRegisterFlow() {
  let panelConfig
  try {
    panelConfig = await getV2BoardConfig()
  } catch (err) {
    return { reply: 'No pude conectar con el servidor. Intenta en unos minutos.', updateState: null }
  }

  if (!panelConfig) return { reply: 'No pude conectar con el servidor. Intenta en unos minutos.', updateState: null }
  if (panelConfig.stopRegister) return { reply: 'El registro esta deshabilitado temporalmente.', updateState: null }
  if (panelConfig.recaptchaEnable) return { reply: 'Por el momento no es posible registrarse por aqui.\n\n' + appRegisterHint(), updateState: null }

  let domainMsg = ''
  if (panelConfig.emailWhitelistEnable && panelConfig.emailWhitelistSuffix?.length > 0) {
    domainMsg = '\n\nCorreos permitidos: *' + panelConfig.emailWhitelistSuffix.join(', ') + '*'
  }

  return {
    reply: '¡Vamos a crear tu cuenta!' + domainMsg + '\n\nEscribe tu correo electronico:',
    updateState: { registerStep: 'AWAITING_EMAIL', registerConfig: panelConfig }
  }
}

module.exports = { handleRegisterFlow, isRegisterActive, startRegisterFlow, startFreshRegisterFlow }
