const { getUserByEmail, loginUser, getSubscribeUrl } = require('./v2board')
const { saveUserEmail } = require('./admin/storage')
const config = require('./config')

function isSubscribeActive(state) {
  return state && !!state.subscribeStep
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function startSubscribeFlow(from) {
  return {
    reply: 'Para consultar tu URL de suscripcion, escribe tu *correo electronico*:',
    updateState: { subscribeStep: 'AWAITING_EMAIL' }
  }
}

async function handleSubscribeFlow(msg, state, from) {
  if (msg === 'cancelar') {
    return { reply: 'Consulta cancelada. Escribe *hola* para ver el menu.', updateState: null }
  }

  switch (state.subscribeStep) {
    case 'AWAITING_EMAIL':
      return await handleEmail(msg, state)
    case 'AWAITING_PASSWORD':
      return await handlePassword(msg, state, from)
    default:
      return { reply: 'Algo salio mal. Escribe *hola* para reiniciar.', updateState: null }
  }
}

async function handleEmail(msg, state) {
  const email = msg.toLowerCase().trim()

  if (!isValidEmail(email)) {
    return {
      reply: 'Ese correo no parece valido. Ejemplo: juan@gmail.com',
      updateState: { subscribeStep: 'AWAITING_EMAIL' }
    }
  }

  // Check if email exists in panel
  let panelUser
  try {
    panelUser = await getUserByEmail(email)
  } catch (err) {
    console.error('[SUBSCRIBE] Error checking email:', err.message)
    return {
      reply: 'No pude conectar con el servidor. Intenta de nuevo.',
      updateState: { subscribeStep: 'AWAITING_EMAIL' }
    }
  }

  if (!panelUser) {
    return {
      reply: `No encontre una cuenta con *${email}*.\n\nVerifica tu correo o escribe *registrarme* para crear una cuenta.`,
      updateState: null
    }
  }

  return {
    reply: 'Ahora escribe tu *contraseña*:',
    updateState: { subscribeStep: 'AWAITING_PASSWORD', subscribeEmail: email }
  }
}

async function handlePassword(msg, state, from) {
  const password = msg
  const email = state.subscribeEmail

  let authData
  try {
    authData = await loginUser(email, password)
  } catch (err) {
    console.error('[SUBSCRIBE] Login error:', err.message)
    return {
      reply: 'No pude conectar con el servidor. Intenta de nuevo.',
      updateState: { subscribeStep: 'AWAITING_PASSWORD', subscribeEmail: email }
    }
  }

  if (!authData) {
    return {
      reply: 'Contraseña incorrecta. Intenta de nuevo o escribe *cancelar*.',
      updateState: { subscribeStep: 'AWAITING_PASSWORD', subscribeEmail: email }
    }
  }

  // Password verified — save as verified account
  saveUserEmail(from, email, true)

  let subscribeUrl
  try {
    subscribeUrl = await getSubscribeUrl(authData)
  } catch (err) {
    console.error('[SUBSCRIBE] Error getting subscribe URL:', err.message)
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
    reply += '\n\nNo pude obtener tu URL. Abre la app VPNMax e inicia sesión con tu correo y contraseña para verla.'
  }
  reply += '\n\nEscribe *hola* para volver al menu.'

  return { reply, updateState: null }
}

module.exports = { handleSubscribeFlow, isSubscribeActive, startSubscribeFlow }
