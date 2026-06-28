const axios = require('axios')

async function sendMessage(to, text) {
  const res = await axios.post(
    `https://graph.facebook.com/v24.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  )
  return res.data
}

async function sendMedia(to, type, url, caption) {
  const body = { messaging_product: 'whatsapp', to, type }
  body[type] = { link: url }
  if (caption) body[type].caption = caption
  const res = await axios.post(
    `https://graph.facebook.com/v24.0/${process.env.PHONE_NUMBER_ID}/messages`,
    body,
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  )
  return res.data
}

module.exports = { sendMessage, sendMedia }
