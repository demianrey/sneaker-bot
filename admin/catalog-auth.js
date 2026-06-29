function catalogAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Catálogo"')
    return res.status(401).json({ error: 'Se requiere autenticación' })
  }

  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString()
  const password = decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded

  if (password === process.env.ADMIN_PASSWORD || password === process.env.CATALOG_PASSWORD) {
    return next()
  }
  return res.status(401).json({ error: 'Contraseña incorrecta' })
}

module.exports = catalogAuth
