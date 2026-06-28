const axios = require('axios')

const API = (token) => `https://api.telegram.org/bot${token}`

async function sendMessage(token, chatId, text) {
  const { data } = await axios.post(`${API(token)}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown'
  })
  return data
}

async function sendPhoto(token, chatId, photoUrl, caption) {
  const { data } = await axios.post(`${API(token)}/sendPhoto`, {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: 'Markdown'
  })
  return data
}

async function sendDocument(token, chatId, docUrl, caption) {
  const { data } = await axios.post(`${API(token)}/sendDocument`, {
    chat_id: chatId,
    document: docUrl,
    caption,
    parse_mode: 'Markdown'
  })
  return data
}

async function setWebhook(token, webhookUrl) {
  const { data } = await axios.post(`${API(token)}/setWebhook`, { url: webhookUrl })
  return data
}

module.exports = { sendMessage, sendPhoto, sendDocument, setWebhook }
