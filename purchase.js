const { getPlans, getUserByEmail, createAndCheckoutOrder, getOrderStatus, getPendingOrders, cancelOrder, getPaymentMethods, checkoutOrder, panelUrl, PERIOD_MAP } = require('./v2board')
const { getUserByWhatsApp, getUserEmail, getBanks, getConfig } = require('./admin/storage')
const { downloadMedia } = require('./media-download')
const { startFreshRegisterFlow } = require('./register')

const KEY_EMOJIS = { 1: '1️⃣', 2: '2️⃣', 3: '3️⃣', 4: '4️⃣', 5: '5️⃣', 6: '6️⃣', 7: '7️⃣', 8: '8️⃣', 9: '9️⃣', 10: '🔟' }

function formatPlanSummary(p) {
  const gbMatch = p.desc && p.desc.match(/(\d+\s*GB)/i)
  const data = gbMatch ? gbMatch[1].replace(/\s+/, '') : null

  let vigencia = null
  if (p.desc && /ilimitad/i.test(p.desc)) {
    vigencia = 'Ilimitada'
  } else if (p.periods.length >= 1) {
    vigencia = p.periods[0].label
  }

  const price = p.periods.length === 1
    ? formatPrice(p.periods[0].price)
    : p.periods.length > 1
      ? `desde ${formatPrice(Math.min(...p.periods.map(x => x.price)))}`
      : null

  const parts = [data, vigencia, price].filter(Boolean)
  return parts.length > 0 ? parts.join(' - ') : (p.desc || '')
}

function stripHtml(html) {
  if (!html) return ''
  // Extract text from h2 tags as short description
  const h2s = []
  html.replace(/<h2[^>]*>(.*?)<\/h2>/gi, (_, inner) => {
    h2s.push(inner.replace(/<[^>]+>/g, '').trim())
  })
  if (h2s.length) return h2s.join(' | ')
  // Fallback: strip all tags
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().substring(0, 80)
}

function isPurchaseActive(state) {
  return state && !!state.purchaseStep
}

function formatPrice(amount) {
  return '$' + Number(amount).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MXN'
}

function getActiveBanks() {
  return getBanks().filter(b => b.activa)
}

function appendTransferOption(methods) {
  const activeBanks = getActiveBanks()
  if (activeBanks.length > 0) {
    methods.push({ id: 'transfer', name: 'Transferencia bancaria' })
  }
  return methods
}

function formatBankDetails(amount, tradeNo) {
  const banks = getActiveBanks()
  const bankList = banks.map(b => {
    const label = b.tarjeta ? 'Tarjeta' : 'Cuenta'
    let entry = `*${b.banco}*\nTitular: ${b.titular}\n${label}: ${b.cuenta}`
    if (b.descripcion) entry += `\n${b.descripcion}`
    return entry
  }).join('\n\n')

  return `🏦 *Pago por transferencia*\n\n💰 Total: *${formatPrice(amount)}*\n📋 Orden: ${tradeNo}\n\nTransfiere a cualquiera de estas cuentas:\n\n${bankList}\n\nCuando hayas transferido, *envía tu comprobante de pago* (foto o captura).\nTe notificaremos cuando se verifique.\nO escribe *cambiar* para elegir otro método.`
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function registerRedirectMsg() {
  const cfg = getConfig()
  const android = cfg.PLAY_STORE_URL ? `🤖 Android: ${cfg.PLAY_STORE_URL}` : ''
  const apple = cfg.APP_STORE_URL ? `🍎 iPhone: ${cfg.APP_STORE_URL}` : ''
  const links = [android, apple].filter(Boolean).join('\n')
  return `Descarga VPNMax y regístrate directo en la app — recibes *1 GB gratis* sin fecha de vencimiento al crear tu cuenta 🎁\n\n${links}\n\nUna vez registrado, escribe tu correo aquí para continuar con la compra.`
}

async function startPurchaseFlow(from) {
  const cfg = getConfig()
  const registerEnabled = cfg.REGISTER_ENABLED !== false
  const verifiedEmail = getUserEmail(from)
  if (verifiedEmail) {
    return {
      reply: `¡Vamos a configurar tu suscripción!\n\n📧 Tu cuenta: *${verifiedEmail}*\n\n1️⃣ Comprar para mi cuenta\n2️⃣ Comprar para otro correo\n3️⃣ No tengo cuenta\n\nResponde con el *número*.`,
      updateState: { purchaseStep: 'CONFIRM_EMAIL', purchaseEmail: verifiedEmail }
    }
  }
  // Fallback: check if there's any saved (unverified) email
  const saved = getUserByWhatsApp(from)
  if (saved && saved.email) {
    return {
      reply: `¡Vamos a configurar tu suscripción!\n\n📧 Correo anterior: *${saved.email}*\n\n1️⃣ Continuar con este correo\n2️⃣ Usar otro correo\n3️⃣ No tengo cuenta\n\nResponde con el *número*.`,
      updateState: { purchaseStep: 'CONFIRM_EMAIL', purchaseEmail: saved.email }
    }
  }
  const emailHint = registerEnabled
    ? '¿Cuál es tu correo electrónico?\n(el que usas en tu cuenta de VPNMax)\n\nO escribe *registrarme* si aún no tienes cuenta.'
    : '¿Cuál es tu correo electrónico?\n(el que usas en la app VpnMax)\n\nSi aún no tienes cuenta, primero descarga la app y regístrate ahí — recibes *1 GB gratis*.'
  return {
    reply: `¡Vamos a configurar tu suscripción!\n\n${emailHint}`,
    updateState: { purchaseStep: 'AWAITING_EMAIL' }
  }
}

async function handleConfirmEmail(msg, state, from) {
  if (msg === '1' || msg === 'continuar') {
    // Verify user exists in panel
    let panelUser
    try {
      panelUser = await getUserByEmail(state.purchaseEmail)
    } catch { /* ignore */ }
    if (!panelUser) {
      const cfg = getConfig()
      const hint = cfg.REGISTER_ENABLED !== false
        ? 'Escribe *registrarme* para crear tu cuenta primero, o ingresa otro correo:'
        : 'Regístrate en la app VPNMax primero y luego vuelve con tu correo.\nO ingresa otro correo:'
      return {
        reply: `No encontré una cuenta con *${state.purchaseEmail}*.\n\n${hint}`,
        updateState: { purchaseStep: 'AWAITING_EMAIL' }
      }
    }
    // Check for pending orders
    const pendingResult = await checkPendingOrders(panelUser.id, state.purchaseEmail)
    if (pendingResult) return pendingResult
    return await showPlans(from, state.purchaseEmail, panelUser.id)
  }

  if (msg === '3' || msg === 'registrarme' || msg === 'registrar') {
    const cfg = getConfig()
    if (cfg.REGISTER_ENABLED === false) {
      return { reply: registerRedirectMsg(), updateState: { purchaseStep: 'AWAITING_EMAIL' } }
    }
    const result = await startFreshRegisterFlow()
    return { reply: result.reply, updateState: result.updateState }
  }

  if (msg === '2' || msg === 'otro' || msg === 'cambiar') {
    return {
      reply: '¿Cuál es tu correo electrónico?\n(el que usas en tu cuenta de VPNMax)',
      updateState: { purchaseStep: 'AWAITING_EMAIL' }
    }
  }

  return {
    reply: 'Responde *1* para continuar con este correo o *2* para usar otro.',
    updateState: { ...purchaseState(state), purchaseStep: 'CONFIRM_EMAIL' }
  }
}

async function checkPendingOrders(userId, email) {
  let pending
  try {
    pending = await getPendingOrders(userId)
  } catch { /* ignore */ }

  if (!pending || pending.length === 0) return null

  const order = pending[0]
  const periodLabel = PERIOD_MAP[order.period] || order.period
  const amount = order.total_amount / 100

  return {
    reply: `Tienes una orden pendiente:\n\n📦 Plan: *${order.plan_name}*\n📅 Periodo: *${periodLabel}*\n💰 Total: *${formatPrice(amount)}*\n📋 Orden: ${order.trade_no}\n\n1️⃣ *Continuar* con esta orden\n2️⃣ *Cancelar* y crear una nueva\n\nResponde con el *número*.`,
    updateState: {
      purchaseStep: 'PENDING_ORDER',
      purchaseEmail: email,
      purchaseUserId: userId,
      purchaseTradeNo: order.trade_no,
      purchaseAmount: amount,
      purchasePlanName: order.plan_name,
      purchasePeriodLabel: periodLabel
    }
  }
}

async function handlePurchaseFlow(msg, state, from, mediaInfo) {
  const step = state.purchaseStep

  if (msg === 'cancelar' || msg === 'salir') {
    if (state.purchaseTradeNo) {
      try {
        await cancelOrder(state.purchaseTradeNo)
        console.log('[PURCHASE] Cancelled order on user cancel:', state.purchaseTradeNo)
      } catch (err) {
        console.error('[PURCHASE] Error cancelling order:', err.message)
      }
    }
    return { reply: 'Compra cancelada. Escribe *hola* para ver el menú.', updateState: null }
  }

  // Handle back navigation
  if (msg === 'volver' || msg === 'atrás' || msg === 'atras' || msg === 'regresar') {
    return handlePurchaseBack(state, from)
  }

  switch (step) {
    case 'CONFIRM_EMAIL':
      return await handleConfirmEmail(msg, state, from)
    case 'PENDING_ORDER':
      return await handlePendingOrder(msg, state, from)
    case 'AWAITING_EMAIL':
      return await handleEmail(msg, from)
    case 'AWAITING_PLAN':
      return await handlePlanChoice(msg, state, from)
    case 'AWAITING_PERIOD':
      return await handlePeriodChoice(msg, state, from)
    case 'CONFIRMING':
      return await handleConfirmation(msg, state, from)
    case 'AWAITING_PAYMENT_METHOD':
      return await handlePaymentMethod(msg, state, from)
    case 'DONE':
      return await handlePostPayment(msg, state, from, mediaInfo)
    default:
      return { reply: 'Algo salió mal. Escribe *hola* para reiniciar.', updateState: null }
  }
}

async function handlePendingOrder(msg, state, from) {
  if (msg === '1' || msg === 'continuar') {
    // Continue with pending order — show payment methods
    let methods
    try {
      methods = await getPaymentMethods()
    } catch { /* ignore */ }

    if (!methods) methods = []
    const lightMethods2 = appendTransferOption(methods.map(m => ({ id: m.id, name: m.name, payment: m.payment })))
    if (lightMethods2.length === 0) {
      return {
        reply: 'No hay métodos de pago disponibles. Contacta a soporte.',
        updateState: {
          purchaseStep: 'DONE',
          purchaseEmail: state.purchaseEmail,
          purchaseUserId: state.purchaseUserId,
          purchaseTradeNo: state.purchaseTradeNo,
          purchaseAmount: state.purchaseAmount,
          purchasePlanName: state.purchasePlanName,
          purchasePeriodLabel: state.purchasePeriodLabel
        }
      }
    }

    const methodList = lightMethods2.map((m, i) => {
      const n = i + 1
      return `${KEY_EMOJIS[n] || n + '.'} ${m.name}`
    }).join('\n')

    return {
      reply: `*Elige tu método de pago:*\n\n${methodList}\n\nResponde con el *número*.`,
      updateState: {
        purchaseStep: 'AWAITING_PAYMENT_METHOD',
        purchaseEmail: state.purchaseEmail,
        purchaseUserId: state.purchaseUserId,
        purchaseTradeNo: state.purchaseTradeNo,
        purchaseAmount: state.purchaseAmount,
        purchasePlanName: state.purchasePlanName,
        purchasePeriodLabel: state.purchasePeriodLabel,
        purchaseMethods: lightMethods2
      }
    }
  }

  if (msg === '2' || msg === 'cancelar orden') {
    // Cancel the pending order and start fresh
    try {
      await cancelOrder(state.purchaseTradeNo)
      console.log('[PURCHASE] Cancelled pending order:', state.purchaseTradeNo)
    } catch (err) {
      console.error('[PURCHASE] Error cancelling order:', err.message)
    }

    return await showPlans(from, state.purchaseEmail, state.purchaseUserId)
  }

  return {
    reply: 'Responde *1* para continuar con la orden o *2* para cancelarla.',
    updateState: { ...purchaseState(state), purchaseStep: 'PENDING_ORDER' }
  }
}

async function handleEmail(msg, from) {
  const cfg = getConfig()
  const registerEnabled = cfg.REGISTER_ENABLED !== false
  if (msg === 'registrarme' || msg === 'registrar') {
    if (!registerEnabled) {
      return { reply: registerRedirectMsg(), updateState: { purchaseStep: 'AWAITING_EMAIL' } }
    }
    const result = await startFreshRegisterFlow()
    return { reply: result.reply, updateState: result.updateState }
  }

  if (!isValidEmail(msg)) {
    const hint = registerEnabled
      ? '\n\nO escribe *registrarme* si aún no tienes cuenta.'
      : '\n\nSi aún no tienes cuenta, descarga la app VPNMax y regístrate ahí primero.'
    return {
      reply: `Ese correo no parece válido. Ejemplo: juan@gmail.com${hint}`,
      updateState: { purchaseStep: 'AWAITING_EMAIL' }
    }
  }

  const email = msg.toLowerCase()

  // Verify user exists in panel
  let panelUser
  try {
    panelUser = await getUserByEmail(email)
  } catch (err) {
    console.error('[PURCHASE] Error checking user:', err.message)
    return {
      reply: 'No pude conectar con el servidor. Intenta en unos minutos.',
      updateState: { purchaseStep: 'AWAITING_EMAIL' }
    }
  }

  if (!panelUser) {
    const cfg = getConfig()
    const hint = cfg.REGISTER_ENABLED !== false
      ? 'Escribe *registrarme* para crear tu cuenta primero.\nDespués regresa y escribe *comprar* para tu suscripción.'
      : 'Regístrate en la app VPNMax y recibes *1 GB gratis*.\nUna vez registrado, vuelve con tu correo para comprar.'
    return {
      reply: `No encontré una cuenta con ese correo.\n\n${hint}`,
      updateState: null
    }
  }

  // Check for pending orders
  const pendingResult = await checkPendingOrders(panelUser.id, email)
  if (pendingResult) return pendingResult

  return await showPlans(from, email, panelUser.id)
}

async function showPlans(from, email, panelUserId) {
  let plans
  try {
    plans = await getPlans()
  } catch (err) {
    console.error('[PURCHASE] Error fetching plans:', err.message)
    return {
      reply: 'No pude conectar con el servidor. Intenta en unos minutos.',
      updateState: null
    }
  }

  if (!plans || plans.length === 0) {
    return {
      reply: 'No hay planes disponibles en este momento. Contacta a soporte.',
      updateState: null
    }
  }

  // Build lightweight plan list for display and state storage
  const lightPlans = plans.map(p => ({
    id: p.id,
    name: p.name,
    desc: stripHtml(p.content),
    periods: p.periods
  }))

  const list = lightPlans.map((p, i) => {
    const n = i + 1
    const summary = formatPlanSummary(p)
    return `${KEY_EMOJIS[n] || n + '.'} *${p.name}* — ${summary}`
  }).join('\n')

  return {
    reply: `📧 Email: ${email}\n\n*Suscripciones disponibles:*\n\n${list}\n\n⚠️ Elige el plan que coincida con tu compañía de celular (Telcel, OXXO cel, Movistar, Virgin). El plan solo funciona con esa red.\n\nResponde con el *número* del plan.`,
    updateState: {
      purchaseStep: 'AWAITING_PLAN',
      purchaseEmail: email,
      purchaseUserId: panelUserId,
      purchasePlans: lightPlans,
      // Explicitly clear any stale order from a previous pending-order session —
      // setState() merges, so without these nulls the old purchaseTradeNo persists
      // and handlePaymentMethod tries to checkout the already-cancelled order,
      // getting "El pedido no existe o ha sido pagado" from V2Board.
      purchaseTradeNo: null,
      purchaseIsTransfer: null
    }
  }
}

async function handlePlanChoice(msg, state, from) {
  const plans = state.purchasePlans
  if (!plans) return { reply: 'Error interno. Escribe *comprar* para reiniciar.', updateState: null }

  const idx = parseInt(msg, 10)
  if (isNaN(idx) || idx < 1 || idx > plans.length) {
    return {
      reply: `Responde con un número del 1 al ${plans.length}.`,
      updateState: { ...purchaseState(state), purchaseStep: 'AWAITING_PLAN' }
    }
  }

  const plan = plans[idx - 1]
  const periodList = plan.periods.map((p, i) => {
    const n = i + 1
    return `${KEY_EMOJIS[n] || n + '.'} ${p.label} — ${formatPrice(p.price)}`
  }).join('\n')

  return {
    reply: `*${plan.name}* — Elige el periodo:\n\n${periodList}\n\nResponde con el *número*.`,
    updateState: {
      ...purchaseState(state),
      purchaseStep: 'AWAITING_PERIOD',
      purchasePlanId: plan.id,
      purchasePlanName: plan.name
    }
  }
}

async function handlePeriodChoice(msg, state, from) {
  const plans = state.purchasePlans
  const plan = plans?.find(p => p.id === state.purchasePlanId)
  if (!plan) return { reply: 'Error interno. Escribe *comprar* para reiniciar.', updateState: null }

  const idx = parseInt(msg, 10)
  if (isNaN(idx) || idx < 1 || idx > plan.periods.length) {
    return {
      reply: `Responde con un número del 1 al ${plan.periods.length}.`,
      updateState: { ...purchaseState(state), purchaseStep: 'AWAITING_PERIOD' }
    }
  }

  const period = plan.periods[idx - 1]

  // Fetch user balance
  let balance = 0
  try {
    const panelUser = await getUserByEmail(state.purchaseEmail)
    if (panelUser && panelUser.balance) balance = panelUser.balance / 100
  } catch { /* ignore */ }

  const total = Math.max(period.price - balance, 0)
  let priceLines = `💰 Precio: *${formatPrice(period.price)}*`
  if (balance > 0) {
    priceLines += `\n💳 Balance a favor: *-${formatPrice(balance)}*`
    priceLines += `\n💰 *Total: ${formatPrice(total)}*`
  }

  return {
    reply: `*Confirma tu compra:*\n\n📦 Plan: *${state.purchasePlanName}*\n📅 Periodo: *${period.label}*\n${priceLines}\n📧 Email: ${state.purchaseEmail}\n\nEscribe *confirmar* para continuar o *cancelar*.`,
    updateState: {
      ...purchaseState(state),
      purchaseStep: 'CONFIRMING',
      purchasePeriod: period.key,
      purchasePeriodLabel: period.label,
      // Store the balance-discounted total (matches what we just showed the user) so
      // it stays consistent on the final payment screen if the order API doesn't
      // return its own total_amount and we fall back to this value
      purchaseAmount: total
    }
  }
}

async function handleConfirmation(msg, state, from) {
  if (msg !== 'confirmar') {
    if (msg === 'cancelar') {
      return { reply: 'Compra cancelada. Escribe *hola* para ver el menú.', updateState: null }
    }
    return {
      reply: 'Escribe *confirmar* para continuar o *cancelar*.',
      updateState: { ...purchaseState(state), purchaseStep: 'CONFIRMING' }
    }
  }

  // Fetch payment methods (order is NOT created yet — it will be created with checkout)
  let methods
  try {
    methods = await getPaymentMethods()
  } catch { /* ignore */ }

  if (!methods) methods = []
  const lightMethods = appendTransferOption(methods.map(m => ({ id: m.id, name: m.name, payment: m.payment })))
  if (lightMethods.length === 0) {
    return {
      reply: 'No hay métodos de pago disponibles. Contacta a soporte.',
      updateState: null
    }
  }

  const methodList = lightMethods.map((m, i) => {
    const n = i + 1
    return `${KEY_EMOJIS[n] || n + '.'} ${m.name}`
  }).join('\n')

  return {
    reply: `*Elige tu método de pago:*\n\n${methodList}\n\nResponde con el *número*.`,
    updateState: {
      ...purchaseState(state),
      purchaseStep: 'AWAITING_PAYMENT_METHOD',
      purchaseMethods: lightMethods
    }
  }
}

async function handlePaymentMethod(msg, state, from) {
  const methods = state.purchaseMethods
  if (!methods) return { reply: 'Error interno. Escribe *comprar* para reiniciar.', updateState: null }

  const idx = parseInt(msg, 10)
  if (isNaN(idx) || idx < 1 || idx > methods.length) {
    return {
      reply: `Responde con un número del 1 al ${methods.length}.`,
      updateState: { ...purchaseState(state), purchaseStep: 'AWAITING_PAYMENT_METHOD' }
    }
  }

  const method = methods[idx - 1]

  // Order fully covered by account balance — nothing to pay. Create/checkout the
  // order so V2Board registers it (and marks it paid), and skip the payment flow
  // entirely instead of asking the user to "transfer $0.00" and send a receipt.
  if (state.purchaseAmount === 0) {
    let result
    try {
      result = await createAndCheckoutOrder({
        userId: state.purchaseUserId,
        email: state.purchaseEmail,
        planId: state.purchasePlanId,
        period: state.purchasePeriod,
        methodId: methods.find(m => m.id !== 'transfer')?.id || method.id
      })
    } catch (err) {
      console.error('[PURCHASE] Error creating balance-covered order:', err.message)
      return {
        reply: 'Hubo un error al crear tu orden. Intenta de nuevo o contacta a soporte.',
        updateState: { ...purchaseState(state), purchaseStep: 'AWAITING_PAYMENT_METHOD' }
      }
    }

    let order
    try {
      order = await getOrderStatus(result.tradeNo)
    } catch { /* ignore */ }

    // status: 0=pending, 1=paid, 2=cancelled, 3=completed
    if (order && order.status >= 1 && order.status !== 2) {
      return {
        reply: `🎉 *¡Tu saldo a favor cubrió el total!*\n\n📋 Orden: ${result.tradeNo}\n📦 ${state.purchasePlanName} — ${state.purchasePeriodLabel}\n\nTu suscripción ya está activa. Escribe *hola* para volver al menú.`,
        updateState: null
      }
    }

    return {
      reply: `🎉 *¡Tu saldo a favor cubre el total de esta compra!*\n\n📋 Orden: ${result.tradeNo}\n📦 ${state.purchasePlanName} — ${state.purchasePeriodLabel}\n\nNo necesitas pagar nada. Un asesor confirmará la activación en breve.`,
      updateState: null,
      notifyHuman: { from, optionLabel: 'Orden cubierta por saldo a favor' }
    }
  }

  // Transfer: show bank details, no API checkout needed
  if (method.id === 'transfer') {
    // If no order exists yet, create one without checkout
    let tradeNo = state.purchaseTradeNo
    let actualAmount = state.purchaseAmount
    if (!tradeNo) {
      let result
      try {
        // Create order with a dummy method; we'll skip checkout URL
        result = await createAndCheckoutOrder({
          userId: state.purchaseUserId,
          email: state.purchaseEmail,
          planId: state.purchasePlanId,
          period: state.purchasePeriod,
          methodId: methods.find(m => m.id !== 'transfer')?.id || 1
        })
        tradeNo = result.tradeNo
        if (result.totalAmount != null) actualAmount = result.totalAmount / 100
      } catch (err) {
        console.error('[PURCHASE] Error creating order for transfer:', err.message)
        return {
          reply: 'Hubo un error al crear tu orden. Intenta de nuevo o contacta a soporte.',
          updateState: { ...purchaseState(state), purchaseStep: 'AWAITING_PAYMENT_METHOD' }
        }
      }
    }

    return {
      reply: formatBankDetails(actualAmount, tradeNo),
      updateState: {
        purchaseStep: 'DONE',
        purchaseIsTransfer: true,
        purchaseEmail: state.purchaseEmail,
        purchaseUserId: state.purchaseUserId,
        purchaseTradeNo: tradeNo,
        purchaseAmount: actualAmount,
        purchasePlanName: state.purchasePlanName,
        purchasePeriodLabel: state.purchasePeriodLabel
      }
    }
  }

  // If we already have a trade_no (pending order flow), just checkout
  if (state.purchaseTradeNo) {
    let payUrl
    try {
      payUrl = await checkoutOrder({
        userId: state.purchaseUserId,
        email: state.purchaseEmail,
        tradeNo: state.purchaseTradeNo,
        methodId: method.id
      })
      console.log('[PURCHASE] Checkout URL generated:', payUrl)
    } catch (err) {
      console.error('[PURCHASE] Checkout error:', err.message)
    }

    if (!payUrl) {
      return {
        reply: 'Hubo un error al generar el link de pago. Intenta de nuevo o contacta a soporte.',
        updateState: { ...purchaseState(state), purchaseStep: 'AWAITING_PAYMENT_METHOD' }
      }
    }

    return {
      reply: `💳 *${method.name}*\n\n💰 Total: *${formatPrice(state.purchaseAmount)}*\n\nAbre este enlace para pagar:\n👉 ${payUrl}\n\nCuando hayas pagado, escribe *pagué* para verificar.\nO escribe *cambiar* para elegir otro método de pago.`,
      updateState: {
        purchaseStep: 'DONE',
        purchaseEmail: state.purchaseEmail,
        purchaseUserId: state.purchaseUserId,
        purchaseTradeNo: state.purchaseTradeNo,
        purchaseAmount: state.purchaseAmount,
        purchasePlanName: state.purchasePlanName,
        purchasePeriodLabel: state.purchasePeriodLabel
      }
    }
  }

  // New order: create order + checkout in one user session
  let result
  try {
    result = await createAndCheckoutOrder({
      userId: state.purchaseUserId,
      email: state.purchaseEmail,
      planId: state.purchasePlanId,
      period: state.purchasePeriod,
      methodId: method.id
    })
    console.log('[PURCHASE] Order created & checkout URL:', result.tradeNo, result.payUrl)
  } catch (err) {
    console.error('[PURCHASE] Create+checkout error:', err.message)
  }

  if (!result || !result.payUrl) {
    return {
      reply: 'Hubo un error al crear tu orden. Intenta de nuevo o contacta a soporte.',
      updateState: { ...purchaseState(state), purchaseStep: 'AWAITING_PAYMENT_METHOD' }
    }
  }

  // Use actual total_amount from order (reflects balance discount) or fallback to plan price
  const actualAmount = result.totalAmount != null ? result.totalAmount / 100 : state.purchaseAmount

  return {
    reply: `✅ *¡Orden creada!*\n\n📋 Orden: ${result.tradeNo}\n💳 ${method.name}\n💰 Total: *${formatPrice(actualAmount)}*\n\nAbre este enlace para pagar:\n👉 ${result.payUrl}\n\nCuando hayas pagado, escribe *pagué* para verificar.\nO escribe *cambiar* para elegir otro método de pago.`,
    updateState: {
      purchaseStep: 'DONE',
      purchaseEmail: state.purchaseEmail,
      purchaseUserId: state.purchaseUserId,
      purchaseTradeNo: result.tradeNo,
      purchaseAmount: actualAmount,
      purchasePlanName: state.purchasePlanName,
      purchasePeriodLabel: state.purchasePeriodLabel
    }
  }
}

async function handlePostPayment(msg, state, from, mediaInfo) {
  // Handle receipt (image/document) upload
  if (mediaInfo && (mediaInfo.type === 'image' || mediaInfo.type === 'document')) {
    let receipt
    try {
      receipt = await downloadMedia(mediaInfo.mediaId)
      console.log('[PURCHASE] Receipt downloaded:', receipt.filename)
    } catch (err) {
      console.error('[PURCHASE] Error downloading receipt:', err.message)
      return {
        reply: 'No pude descargar tu comprobante. Intenta enviarlo de nuevo.',
        updateState: { ...purchaseState(state), purchaseStep: 'DONE' }
      }
    }

    return {
      reply: '✅ *Comprobante recibido.* Un asesor lo revisará y activará tu servicio.\n\nTe notificaremos por aquí cuando esté verificado. No necesitas hacer nada más. 🙏',
      updateState: null,
      transfer: {
        from,
        tradeNo: state.purchaseTradeNo,
        planName: state.purchasePlanName,
        periodLabel: state.purchasePeriodLabel,
        amount: state.purchaseAmount,
        email: state.purchaseEmail,
        receiptFilename: receipt.filename,
        receiptMimeType: receipt.mimeType
      }
    }
  }

  // If this is a transfer order, only accept the receipt image — no "pagué" needed
  if (state.purchaseIsTransfer) {
    return {
      reply: `Tu orden está pendiente de comprobante.\n\n💰 Total: *${formatPrice(state.purchaseAmount)}*\n📋 Orden: ${state.purchaseTradeNo}\n\nEnvía la *foto o captura* de tu comprobante de pago.\nO escribe *cambiar* para elegir otro método.`,
      updateState: { ...purchaseState(state), purchaseStep: 'DONE' }
    }
  }

  // Handle payment method change
  if (msg === 'cambiar') {
    let methods
    try {
      methods = await getPaymentMethods()
    } catch { /* ignore */ }

    if (!methods) methods = []
    const lightMethods = appendTransferOption(methods.map(m => ({ id: m.id, name: m.name, payment: m.payment })))
    if (lightMethods.length === 0) {
      return {
        reply: 'No hay métodos de pago disponibles. Contacta a soporte.',
        updateState: { ...purchaseState(state), purchaseStep: 'DONE' }
      }
    }

    const methodList = lightMethods.map((m, i) => {
      const n = i + 1
      return `${KEY_EMOJIS[n] || n + '.'} ${m.name}`
    }).join('\n')

    return {
      reply: `*Elige tu método de pago:*\n\n${methodList}\n\nResponde con el *número*.`,
      updateState: {
        ...purchaseState(state),
        purchaseStep: 'AWAITING_PAYMENT_METHOD',
        purchaseMethods: lightMethods
      }
    }
  }

  const checkWords = ['pagué', 'pague', 'ya pagué', 'ya pague', 'listo', 'pagado']
  if (!checkWords.some(w => msg.includes(w))) {
    return {
      reply: `Tu orden está pendiente.\n\n💰 Total: *${formatPrice(state.purchaseAmount)}*\n\nEscribe *pagué* cuando hayas pagado.\nEscribe *cambiar* para elegir otro método de pago.\nO *cancelar* para salir.`,
      updateState: { ...purchaseState(state), purchaseStep: 'DONE' }
    }
  }

  let order
  try {
    order = await getOrderStatus(state.purchaseTradeNo)
  } catch (err) {
    console.error('[PURCHASE] Error checking order:', err.message)
    return {
      reply: 'No pude verificar tu pago. Intenta de nuevo en unos minutos.',
      updateState: { ...purchaseState(state), purchaseStep: 'DONE' }
    }
  }

  if (!order) {
    return {
      reply: 'No encontré la orden. Contacta a soporte.',
      updateState: null
    }
  }

  // status: 0=pending, 1=paid, 2=cancelled, 3=completed
  if (order.status >= 1 && order.status !== 2) {
    return {
      reply: `🎉 *¡Pago confirmado!* Tu suscripción está activa.\n\n📦 ${state.purchasePlanName} — ${state.purchasePeriodLabel}\n\n¡Gracias por tu compra! Escribe *hola* para volver al menú.`,
      updateState: null
    }
  }

  return {
    reply: `El pago aún no se ha registrado.\n\nSi ya pagaste, espera unos minutos y escribe *pagué* de nuevo.\nEscribe *cambiar* para elegir otro método de pago.`,
    updateState: { ...purchaseState(state), purchaseStep: 'DONE' }
  }
}

// Handle "volver" — go back one step in the purchase flow
function handlePurchaseBack(state, from) {
  const step = state.purchaseStep

  switch (step) {
    case 'AWAITING_PLAN': {
      // Back to email prompt
      return {
        reply: '¿Cuál es tu correo electrónico?\n(el que usas en tu cuenta de VPNMax)',
        updateState: { purchaseStep: 'AWAITING_EMAIL' }
      }
    }

    case 'AWAITING_PERIOD': {
      // Back to plan selection
      const plans = state.purchasePlans
      if (!plans) return { reply: 'Error al regresar. Escribe *comprar* para reiniciar.', updateState: null }
      const list = plans.map((p, i) => {
        const n = i + 1
        const summary = formatPlanSummary(p)
        return `${KEY_EMOJIS[n] || n + '.'} *${p.name}* — ${summary}`
      }).join('\n')
      return {
        reply: `📧 Email: ${state.purchaseEmail}\n\n*Suscripciones disponibles:*\n\n${list}\n\nResponde con el *número* del plan.`,
        updateState: { ...purchaseState(state), purchaseStep: 'AWAITING_PLAN' }
      }
    }

    case 'CONFIRMING': {
      // Back to period selection
      const plans = state.purchasePlans
      const plan = plans?.find(p => p.id === state.purchasePlanId)
      if (!plan) return { reply: 'Error al regresar. Escribe *comprar* para reiniciar.', updateState: null }
      const periodList = plan.periods.map((p, i) => {
        const n = i + 1
        return `${KEY_EMOJIS[n] || n + '.'} ${p.label} — ${formatPrice(p.price)}`
      }).join('\n')
      return {
        reply: `*${state.purchasePlanName}* — Elige el periodo:\n\n${periodList}\n\nResponde con el *número*.`,
        updateState: { ...purchaseState(state), purchaseStep: 'AWAITING_PERIOD' }
      }
    }

    case 'AWAITING_PAYMENT_METHOD': {
      // Back to confirmation
      return {
        reply: `*Confirma tu compra:*\n\n📦 Plan: *${state.purchasePlanName}*\n📅 Periodo: *${state.purchasePeriodLabel}*\n💰 Total: *${formatPrice(state.purchaseAmount)}*\n📧 Email: ${state.purchaseEmail}\n\nEscribe *confirmar* para continuar o *cancelar*.`,
        updateState: { ...purchaseState(state), purchaseStep: 'CONFIRMING' }
      }
    }

    case 'DONE': {
      // Back to payment method selection
      if (state.purchaseMethods && state.purchaseMethods.length) {
        const methodList = state.purchaseMethods.map((m, i) => {
          const n = i + 1
          return `${KEY_EMOJIS[n] || n + '.'} ${m.name}`
        }).join('\n')
        return {
          reply: `*Elige tu método de pago:*\n\n${methodList}\n\nResponde con el *número*.`,
          updateState: { ...purchaseState(state), purchaseStep: 'AWAITING_PAYMENT_METHOD' }
        }
      }
      return {
        reply: 'Escribe *cambiar* para elegir otro método de pago o *cancelar* para salir.',
        updateState: { ...purchaseState(state), purchaseStep: 'DONE' }
      }
    }

    default:
      // First steps — can't go back further
      return { reply: 'Ya estás al inicio. Escribe *cancelar* para salir o *hola* para el menú.', updateState: { ...purchaseState(state) } }
  }
}

// Helper to preserve purchase state fields
function purchaseState(state) {
  return {
    purchaseStep: state.purchaseStep,
    purchaseEmail: state.purchaseEmail,
    purchaseUserId: state.purchaseUserId,
    purchasePlans: state.purchasePlans,
    purchasePlanId: state.purchasePlanId,
    purchasePlanName: state.purchasePlanName,
    purchasePeriod: state.purchasePeriod,
    purchasePeriodLabel: state.purchasePeriodLabel,
    purchaseAmount: state.purchaseAmount,
    purchaseTradeNo: state.purchaseTradeNo,
    purchaseMethods: state.purchaseMethods,
    purchaseIsTransfer: state.purchaseIsTransfer
  }
}

module.exports = { handlePurchaseFlow, isPurchaseActive, startPurchaseFlow }
