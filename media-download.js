const axios = require('axios')
const fs = require('fs')
const path = require('path')

const RECEIPTS_DIR = path.join(__dirname, 'public', 'receipts')

function mimeToExt(mime) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
  }
  return map[mime] || '.bin'
}

async function downloadMedia(mediaId) {
  if (!fs.existsSync(RECEIPTS_DIR)) {
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true })
  }

  const token = process.env.WHATSAPP_TOKEN

  // Step 1: Get media metadata (includes the download URL)
  const meta = await axios.get(
    `https://graph.facebook.com/v24.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  const { url, mime_type } = meta.data
  const ext = mimeToExt(mime_type)
  const filename = `${Date.now()}_${mediaId}${ext}`

  // Step 2: Download binary
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer'
  })

  const filePath = path.join(RECEIPTS_DIR, filename)
  fs.writeFileSync(filePath, response.data)

  return { filename, mimeType: mime_type }
}

module.exports = { downloadMedia }
