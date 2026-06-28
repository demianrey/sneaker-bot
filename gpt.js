// Deprecated — usa llm.js directamente
const { askLLM } = require('./llm')
const askAI = (userText) => askLLM(userText)
module.exports = { askAI }
