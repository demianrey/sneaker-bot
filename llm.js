const axios = require('axios')
const config = require('./config')
const { getPrompt, getKnowledge, getConfig } = require('./admin/storage')

function buildSystemPrompt() {
  const promptData = getPrompt()
  const cfg = getConfig()
  let prompt = promptData.prompt || promptData.systemPrompt || ''

  for (const [key, val] of Object.entries(cfg)) {
    prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val)
  }

  const kb = getKnowledge().filter(e => e.enabled !== false)
  if (kb.length > 0) {
    prompt += '\n\nBASE DE CONOCIMIENTO:\n'
    for (const entry of kb) {
      const text = entry.content || entry.answer || ''
      let body = text
      for (const [key, val] of Object.entries(cfg)) {
        body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val)
      }
      const heading = entry.title || entry.question || ''
      prompt += `${heading}:\n${body}\n\n`
    }
    prompt += 'Usa esta base de conocimiento para responder cuando sea relevante.'
  }

  return prompt
}

const FALLBACK_MSG = `Lo siento, en este momento no puedo procesar tu solicitud. Escribe *asesor* para hablar con una persona de nuestro equipo.`

async function callOpenAI(systemPrompt, userText, history = []) {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userText }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  )
  return res.data.choices[0].message.content
}

async function callClaude(systemPrompt, userText, history = []) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages: [...history, { role: 'user', content: userText }]
    },
    {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    }
  )
  return res.data.content[0].text
}

async function askLLM(userText, context, history = []) {
  const systemPrompt = buildSystemPrompt()
  const prompt = context
    ? `${systemPrompt}\n\nContexto adicional: ${context}`
    : systemPrompt

  const provider = (process.env.LLM_PROVIDER || 'openai').toLowerCase()

  try {
    if (provider === 'claude') {
      return await callClaude(prompt, userText, history)
    }
    return await callOpenAI(prompt, userText, history)
  } catch (err) {
    const status = err.response?.status
    const code = err.code
    const body = err.response?.data
    console.error('LLM error: status=%s code=%s provider=%s body=%s',
      status || 'N/A', code || 'N/A', provider, JSON.stringify(body || {}))
    return FALLBACK_MSG
  }
}

module.exports = { askLLM }
