/**
 * intents.js — Motor de routing para SneakerDrop Bot
 * Basado en la arquitectura del bot VPNMax, adaptado para e-commerce de sneakers.
 *
 * Orden de procesamiento:
 * 1. Filtro de lenguaje inapropiado
 * 2. Flujo activo genérico (catálogo, tallas, soporte, etc.)
 * 3. Flujo activo de compra
 * 4. Trigger de menú
 * 5. Coincidencia de opción / alias
 * 6. IA fallback (llm.js)
 */

const { getState, setState, resetState } = require('./state')
const { askLLM } = require('./llm')
const config = require('./config')

const FLOW_HINT = '\n\n_Escribe *menú* en cualquier momento para volver al inicio._'

const KEY_EMOJIS = {
  '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣',
  '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣',
  '9': '9️⃣', '10': '🔟'
}

// ── Carga hot-reload de flows y catálogo ──────────────────────────────────
const fs = require('fs')
const path = require('path')
const FLOWS_PATH   = path.join(__dirname, 'data', 'flows.json')
const CATALOG_PATH = path.join(__dirname, 'data', 'catalog.json')
let _flowsCache = null, _flowsCacheAt = 0
let _catalogCache = null, _catalogCacheAt = 0
const FLOWS_TTL = 60_000

function loadFlows() {
  if (_flowsCache && Date.now() - _flowsCacheAt < FLOWS_TTL) return _flowsCache
  try {
    _flowsCache = JSON.parse(fs.readFileSync(FLOWS_PATH, 'utf8'))
    _flowsCacheAt = Date.now()
  } catch (e) {
    console.error('[FLOWS] Error leyendo flows.json:', e.message)
    if (!_flowsCache) _flowsCache = { menu: { triggers: [], options: [], flows: [] }, options: [], flows: [] }
  }
  return _flowsCache
}

function loadCatalog() {
  if (_catalogCache && Date.now() - _catalogCacheAt < FLOWS_TTL) return _catalogCache
  try {
    _catalogCache = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
    _catalogCacheAt = Date.now()
  } catch { _catalogCache = [] }
  return _catalogCache
}

// ── Helpers ────────────────────────────────────────────────────────────────
function replacePlaceholders(text, extraVars) {
  if (!text) return text
  return text
    .replace(/\\n/g, '\n')
    .replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (extraVars && extraVars[key] !== undefined) return extraVars[key]
      const cfgVal = config[key]
      return cfgVal !== undefined ? cfgVal : match
    })
}

function buildFullMenu(flows) {
  const header = flows.menu.fullMenuHeader || ''
  const footer = flows.menu.fullMenuFooter || ''
  const opts = (flows.options || []).map(o => `${KEY_EMOJIS[o.key] || o.key} ${o.label}`).join('\n')
  return [header, opts, footer].filter(Boolean).join('\n\n')
}

function buildShortMenu(flows) {
  const header = flows.menu.shortMenuHeader || '¿En qué más te ayudo?'
  const opts = (flows.options || []).map(o => `${KEY_EMOJIS[o.key] || o.key} ${o.label}`).join('  ')
  return [header, opts].filter(Boolean).join('\n\n')
}

function buildStepMessage(step, vars) {
  let msg = replacePlaceholders(step.message, vars)
  if (step.inputType === 'choice' && step.choices && step.choices.length) {
    const list = step.choices.map(c => `${KEY_EMOJIS[c.key] || c.key} ${c.label}`).join('\n')
    msg = [msg, list].filter(Boolean).join('\n\n')
  }
  return msg + FLOW_HINT
}

function isMenuTrigger(msg) {
  const flows = loadFlows()
  const triggers = flows.menu.triggers || []
  if (msg.split(/\s+/).length > 6) return false
  return triggers.some(t => msg.includes(t.toLowerCase()))
}

// ── Flujo genérico multi-paso ──────────────────────────────────────────────
function handleActiveFlow(msg, state, from) {
  const flows = loadFlows()
  const flowDef = flows.flows.find(f => f.id === state.activeFlowId)
  if (!flowDef) { resetState(from); return null }

  const stepIndex = state.flowStepIndex || 0
  const step = flowDef.steps[stepIndex]
  if (!step) { resetState(from); return null }

  if (['cancelar', 'salir'].includes(msg)) {
    resetState(from)
    return { text: 'Flujo cancelado. Escribe *hola* para volver al menú.' }
  }
  if (isMenuTrigger(msg)) { resetState(from); return null }

  if (['volver', 'atrás', 'atras', 'regresar'].includes(msg)) {
    if (stepIndex === 0) {
      resetState(from)
      return { text: 'Escribe *hola* para ver el menú.' }
    }
    const prevStep = flowDef.steps[stepIndex - 1]
    setState(from, { ...state, flowStepIndex: stepIndex - 1 })
    return { text: buildStepMessage(prevStep, state.flowVars || {}) }
  }

  // Guardar respuesta del paso actual
  const flowVars = { ...(state.flowVars || {}) }
  if (step.varName) {
    if (step.inputType === 'choice' && step.choices) {
      const chosen = step.choices.find(c => c.key === msg || msg.includes(c.label.toLowerCase()))
      flowVars[step.varName] = chosen ? chosen.label : msg
    } else {
      flowVars[step.varName] = msg
    }
  }

  // Buscar siguiente paso (respetando condiciones)
  let nextStepIndex = stepIndex + 1
  while (nextStepIndex < flowDef.steps.length) {
    const candidate = flowDef.steps[nextStepIndex]
    if (!candidate.condition) break
    const condVar = flowVars[candidate.condition.varName] || ''
    if (condVar.toLowerCase().includes(candidate.condition.value.toLowerCase())) break
    nextStepIndex++
  }

  if (nextStepIndex < flowDef.steps.length) {
    setState(from, { ...state, flowStepIndex: nextStepIndex, flowVars })
    return { text: buildStepMessage(flowDef.steps[nextStepIndex], flowVars) }
  }

  // Flujo completado
  resetState(from)
  const completionMsg = replacePlaceholders(flowDef.completionMessage || '✅ ¡Listo! Nos pondremos en contacto pronto.', flowVars)

  // Crear ticket si aplica
  let ticketPayload = null
  if (flowDef.createTicket) {
    ticketPayload = {
      flowId: flowDef.id,
      flowName: flowDef.name,
      from,
      vars: flowVars,
      createdAt: new Date().toISOString()
    }
  }

  return { text: completionMsg, ticket: ticketPayload, notifyHuman: flowDef.createTicket }
}

// ── Búsqueda en catálogo ──────────────────────────────────────────────────
const STOP_WORDS = new Set(['que', 'los', 'las', 'una', 'uno', 'con', 'sin', 'para', 'por', 'del', 'der', 'hay', 'tiene', 'tienen', 'busco', 'quiero', 'ver', 'dame', 'show', 'the'])

function searchCatalog(msg) {
  const catalog = loadCatalog().filter(p => p.active !== false)
  if (!catalog.length) return null

  const words = msg.split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  if (!words.length) return null

  const scored = catalog.map(p => {
    const haystack = ((p.name || '') + ' ' + (p.brand || '')).toLowerCase()
    const score = words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0)
    return { p, score }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score)

  if (!scored.length) return null

  const { p } = scored[0]

  // Formato de precio
  const fmtPrice = n => '$' + Number(n).toLocaleString('es-MX')
  const price = p.priceMin
    ? (p.priceMax && p.priceMax !== p.priceMin
        ? `${fmtPrice(p.priceMin)} – ${fmtPrice(p.priceMax)} MXN`
        : `${fmtPrice(p.priceMin)} MXN`)
    : null

  // Texto principal
  let text = `👟 *${p.name}*`
  if (p.brand) text += `\n_${p.brand}_`
  if (price)   text += `\n\n💰 *Precio:* ${price}`
  if (p.sizes?.length) text += `\n📏 *Tallas disponibles:* ${p.sizes.join(', ')}`
  if (p.description)   text += `\n\n${p.description}`

  // Otros resultados relevantes
  if (scored.length > 1) {
    const others = scored.slice(1, 4).map(s => `• ${s.p.name}${s.p.brand ? ' (' + s.p.brand + ')' : ''}`).join('\n')
    text += `\n\n_También encontré:_\n${others}`
  }

  text += '\n\n¿Te interesa? Escribe *3* para hacer tu pedido o *menú* para más opciones.'

  // Máximo 3 imágenes para no saturar el chat
  const images = (p.images || []).slice(0, 3)
  const media = images.map((url, i) => ({ type: 'image', url, caption: i === 0 ? p.name : '' }))

  return { text, media: media.length ? media : null }
}

// ── Flujo de compra activo ─────────────────────────────────────────────────
function isPurchaseActive(state) {
  return state && state.activeFlowId === 'flow_comprar' && state.flowStepIndex !== undefined
}

// ── handleMessage principal ────────────────────────────────────────────────
async function handleMessage(text, from, mediaInfo, adRef) {
  const msg = (text || '').toLowerCase().trim()
  const state = getState(from) || {}
  const flows = loadFlows()

  // 1. Filtro de lenguaje inapropiado (básico — ampliar según necesidad)
  const badWords = ['puta', 'chinga', 'mierda', 'pendejo', 'cabron', 'culero']
  if (badWords.some(w => msg.includes(w))) {
    return { reply: 'Por favor mantenemos un trato respetuoso. ¿En qué te puedo ayudar? 😊', intent: 'profanity' }
  }

  // 2. Flujo genérico activo
  if (state.activeFlowId && state.activeFlowId !== 'flow_comprar') {
    const result = handleActiveFlow(msg, state, from)
    if (result) {
      return {
        reply: result.text,
        intent: state.activeFlowIntent || 'flow',
        ticket: result.ticket || null,
        notifyHuman: result.notifyHuman || false
      }
    }
    // Si retornó null es porque disparó menú — continuar
  }

  // 3. Flujo de compra activo
  if (isPurchaseActive(state)) {
    const result = handleActiveFlow(msg, state, from)
    if (result) {
      return {
        reply: result.text,
        intent: 'purchase',
        ticket: result.ticket || null,
        notifyHuman: result.notifyHuman || false
      }
    }
  }

  // 4. Trigger de menú
  if (isMenuTrigger(msg)) {
    const isNew = !state.seenWelcome
    if (isNew) setState(from, { seenWelcome: true })
    const menuText = buildFullMenu(flows)
    const reply = isNew && flows.menu.welcomeMessage
      ? `${replacePlaceholders(flows.menu.welcomeMessage)}\n\n${menuText}`
      : menuText
    return { reply: replacePlaceholders(reply), intent: 'menu' }
  }

  // 5. Coincidencia de opción por número o alias de intent
  const INTENT_ALIASES = {
    'comprar': 'purchase', 'pedir': 'purchase', 'pedido': 'purchase', 'orden': 'purchase',
    'catalogo': 'catalogo', 'catálogo': 'catalogo', 'modelos': 'catalogo', 'ver': 'catalogo',
    'tallas': 'tallas', 'talla': 'tallas', 'medidas': 'tallas', 'guia': 'tallas',
    'pago': 'pago', 'pagar': 'pago', 'como pago': 'pago', 'formas de pago': 'pago',
    'seguimiento': 'seguimiento', 'rastreo': 'seguimiento', 'mi pedido': 'seguimiento', 'donde esta': 'seguimiento',
    'soporte': 'support', 'cambio': 'support', 'devolucion': 'support', 'devolución': 'support', 'problema': 'support',
    'asesor': 'asesor', 'humano': 'asesor', 'persona': 'asesor', 'agente': 'asesor'
  }

  let matchedOption = null

  // Por número
  const numMatch = msg.match(/^(\d+)$/)
  if (numMatch) {
    matchedOption = flows.options.find(o => o.key === numMatch[1])
  }

  // Por alias de intent
  if (!matchedOption) {
    const aliasIntent = Object.entries(INTENT_ALIASES).find(([alias]) => msg.includes(alias))
    if (aliasIntent) {
      matchedOption = flows.options.find(o => o.intent === aliasIntent[1])
    }
  }

  if (matchedOption) {
    // Si tiene flujo asociado, iniciarlo
    if (matchedOption.flowId) {
      const flowDef = flows.flows.find(f => f.id === matchedOption.flowId)
      if (flowDef && flowDef.steps.length > 0) {
        setState(from, {
          activeFlowId: matchedOption.flowId,
          activeFlowIntent: matchedOption.intent,
          flowStepIndex: 0,
          flowVars: {}
        })
        const preMsg = matchedOption.response ? replacePlaceholders(matchedOption.response) + '\n\n' : ''
        return {
          reply: preMsg + buildStepMessage(flowDef.steps[0], {}),
          intent: matchedOption.intent,
          notifyHuman: matchedOption.notifyHuman || false
        }
      }
    }

    // Respuesta directa
    return {
      reply: replacePlaceholders(matchedOption.response),
      intent: matchedOption.intent,
      notifyHuman: matchedOption.notifyHuman || false
    }
  }

  // 5.5. Búsqueda en catálogo (antes del fallback IA)
  const catalogResult = searchCatalog(msg)
  if (catalogResult) {
    return {
      reply: catalogResult.text,
      media: catalogResult.media,
      intent: 'catalog_search'
    }
  }

  // 6. IA fallback
  const knowledge = (() => {
    try {
      const kbPath = path.join(__dirname, 'data', 'knowledge.json')
      return JSON.parse(fs.readFileSync(kbPath, 'utf8'))
    } catch { return [] }
  })()

  const kbContext = knowledge.map(k => `### ${k.title}\n${replacePlaceholders(k.content)}`).join('\n\n')
  const llmHistory = state.llmHistory || []
  const reply = await askLLM(text, kbContext, llmHistory)
  const newHistory = [...llmHistory,
    { role: 'user', content: text },
    { role: 'assistant', content: reply }
  ].slice(-12)
  setState(from, { ...state, llmHistory: newHistory })

  return { reply, intent: 'ai_fallback' }
}

module.exports = { handleMessage, buildFullMenu, buildShortMenu, loadFlows }
