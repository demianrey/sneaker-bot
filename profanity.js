const BAD_WORDS = [
  'chinga', 'chingue', 'chingar', 'chingada', 'chingado', 'chingados',
  'chingadera', 'chingaderas', 'chingas', 'chingon', 'chingona',
  'puta', 'puto', 'putas', 'putos', 'putamadre', 'putiza',
  'pendejo', 'pendeja', 'pendejos', 'pendejas', 'pendejada',
  'cabron', 'cabrona', 'cabrones',
  'verga', 'vergas', 'vergudo',
  'mamada', 'mamadas', 'mamon', 'mamona',
  'culero', 'culera', 'culeros',
  'pinche', 'pinches',
  'joto', 'jota', 'jotos',
  'huevon', 'huevona', 'guevon',
  'estupido', 'estupida', 'idiota', 'imbecil',
  'mierda', 'mierdas',
  'ojete', 'ojetes',
  'naco', 'naca', 'nacos',
  'te voy a matar', 'te mato', 'los voy a matar',
  'hijo de perra', 'hijo de puta', 'hija de puta',
  'vete a la verga', 'vete al diablo', 'vete a la chingada',
  'me vale verga', 'me vale madres',
  'chupamela', 'chupame',
  'mamahuevo', 'come mierda'
]

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
}

const patterns = BAD_WORDS.map(word => {
  const norm = normalize(word)
  // Frases multi-palabra se buscan tal cual; palabras sueltas con word-boundary
  if (norm.includes(' ')) {
    return new RegExp(norm.replace(/\s+/g, '\\s+'))
  }
  return new RegExp(`\\b${norm}\\b`)
})

function isProfane(text) {
  const norm = normalize(text)
  return patterns.some(rx => rx.test(norm))
}

module.exports = { isProfane }
