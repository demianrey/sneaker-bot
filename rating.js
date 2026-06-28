const { getConfig, getRatings } = require('./admin/storage')
const { getUserByEmail } = require('./v2board')
const { downloadMedia } = require('./media-download')

function hasAlreadyClaimed({ from, email } = {}) {
  return getRatings().some(r => r.credited && (
    (from && r.from === from) ||
    (email && r.email === email.toLowerCase())
  ))
}

function isRatingActive(state) {
  return state && !!state.ratingStep
}

function startRatingFlow(from) {
  if (hasAlreadyClaimed({ from })) {
    return {
      reply: 'Ya recibiste el saldo por calificar VPNMax anteriormente. ¡Gracias por tu apoyo! ⭐\n\nSi tienes dudas escribe *asesor*.',
      updateState: null
    }
  }
  const cfg = getConfig()
  const display = cfg.RATING_CREDIT_DISPLAY || '$30'
  const android = cfg.PLAY_STORE_URL ? `🤖 Android: ${cfg.PLAY_STORE_URL}` : ''
  const apple = cfg.APP_STORE_URL ? `🍎 iPhone: ${cfg.APP_STORE_URL}` : ''
  const links = [android, apple].filter(Boolean).join('\n')
  return {
    reply: `⭐ *Gana ${display} calificando VPNMax*\n\n¡Tu opinión nos ayuda a crecer!\n\n*Pasos:*\n1. Abre la tienda de tu celular y busca *VPNMax*\n${links}\n2. Dale ⭐⭐⭐⭐⭐ y escribe un comentario\n3. Toma una captura de pantalla de tu reseña publicada\n4. Envíala aquí 📸\n\nEnvía tu captura para continuar.`,
    updateState: { ratingStep: 'AWAITING_SCREENSHOT' }
  }
}

async function handleRatingFlow(msg, state, from, mediaInfo) {
  if (state.ratingStep === 'AWAITING_SCREENSHOT') {
    if (mediaInfo && (mediaInfo.type === 'image' || mediaInfo.type === 'document')) {
      let filename = null
      let mimeType = mediaInfo.mimeType || 'image/jpeg'
      try {
        const downloaded = await downloadMedia(mediaInfo.mediaId)
        if (downloaded) { filename = downloaded.filename; mimeType = downloaded.mimeType || mimeType }
      } catch (e) {
        console.error('[RATING] Error downloading screenshot:', e.message)
      }
      return {
        reply: `Captura recibida ✅\n\nAhora envía el *correo electrónico* de tu cuenta VPNMax para acreditarte el saldo.`,
        updateState: { ...state, ratingStep: 'AWAITING_EMAIL', ratingFilename: filename, ratingMimeType: mimeType }
      }
    }
    return {
      reply: `Necesito ver la captura de tu reseña en Play Store o App Store. Envía una foto o imagen 📸`,
      updateState: state
    }
  }

  if (state.ratingStep === 'AWAITING_EMAIL') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg)) {
      return {
        reply: `Ese correo no parece válido. Ejemplo: juan@gmail.com\n\nEnvía el correo de tu cuenta VPNMax.`,
        updateState: state
      }
    }
    const email = msg.toLowerCase()
    let panelUser = null
    try { panelUser = await getUserByEmail(email) } catch (e) {
      console.error('[RATING] Error looking up user:', e.message)
    }
    if (!panelUser) {
      return {
        reply: `No encontré una cuenta con ese correo en VPNMax. Asegúrate de usar el mismo correo con el que te registraste en la app.\n\nSi aún no tienes cuenta, descarga la app y crea tu cuenta primero.`,
        updateState: state
      }
    }
    if (hasAlreadyClaimed({ from, email })) {
      return {
        reply: 'Este número o correo ya recibió el saldo por calificar VPNMax. Solo se puede reclamar una vez por cuenta. ¡Gracias! ⭐',
        updateState: null
      }
    }
    const cfg = getConfig()
    const display = cfg.RATING_CREDIT_DISPLAY || '$30'
    return {
      reply: `✅ ¡Recibido! Revisaremos tu reseña y si todo está bien te acreditaremos *${display} MXN* en las próximas horas.\n\n¡Gracias por apoyar VPNMax! ⭐`,
      rating: {
        from,
        email,
        userId: panelUser.id,
        ratingFilename: state.ratingFilename,
        ratingMimeType: state.ratingMimeType,
        createdAt: new Date().toISOString(),
        credited: false
      }
    }
  }
}

module.exports = { isRatingActive, startRatingFlow, handleRatingFlow }
