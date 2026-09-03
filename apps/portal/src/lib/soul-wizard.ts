/**
 * SOUL.md <-> wizard fields.
 *
 * Best-effort parse: las secciones reconocidas se mapean a campos del wizard;
 * todo lo demás se conserva verbatim en `extra` para no perder contenido al
 * regenerar. El markdown sigue siendo la fuente de verdad en disco.
 */

export interface SoulFields {
  /** Nombre del negocio, ej. "Canova Cars". Aparece en el H1 y la intro. */
  businessName: string
  /** Rubro corto, ej. "agencia de venta de automóviles". */
  rubro: string
  /** Párrafo de rol/intro completo (lo que va bajo el H1). */
  rol: string
  /** Items de "Tu única operación" (lo que el bot hace). */
  botDoes: string[]
  /** Items de "Qué NO hacer". */
  botDoesNot: string[]
  /** Items de "Qué captar cuando hay interés". */
  leadFields: string[]
  /** Texto bajo "## Precios". */
  precios: string
  /** Bloque de cierre (quote `>` bajo "## Cierre..."). */
  cierre: string
  /** Items de "Anti-alucinación". */
  antiAlucinacion: string[]
  /** Markdown suelto que no se supo mapear (secciones no reconocidas). */
  extra: string
}

export const emptySoulFields: SoulFields = {
  businessName: '',
  rubro: '',
  rol: '',
  botDoes: [],
  botDoesNot: [],
  leadFields: [],
  precios: '',
  cierre: '',
  antiAlucinacion: [],
  extra: '',
}

interface ParsedSection {
  header: string
  body: string
}

function splitSections(md: string): { head: string; sections: ParsedSection[] } {
  const lines = md.split('\n')
  const head: string[] = []
  const sections: ParsedSection[] = []
  let current: ParsedSection | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current)
      current = { header: line.replace(/^##\s+/, '').trim(), body: '' }
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line
    } else {
      head.push(line)
    }
  }
  if (current) sections.push(current)

  return { head: head.join('\n').trim(), sections }
}

function parseTitleBlock(head: string): { businessName: string; rol: string } {
  const lines = head.split('\n').filter(Boolean)
  let businessName = ''
  const introLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('# ')) {
      const raw = line.replace(/^#\s+/, '').trim()
      const cleaned = raw.replace(/^Lead AI Assistant\s*[—–-]\s*/i, '').trim()
      businessName = cleaned
    } else {
      introLines.push(line)
    }
  }
  return { businessName, rol: introLines.join('\n').trim() }
}

function extractRubro(rol: string): string {
  // "Eres el asistente ... para **Canova Cars** (turismo sur patagónico)."
  const match = rol.match(/\(([^)]+)\)/)
  return match ? match[1].trim() : ''
}

function parseBulletList(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-') || /^\d+\./.test(l))
    .map((l) =>
      l
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .trim()
    )
    .map((l) => l.replace(/\*\*(.+?)\*\*/g, '$1').trim())
    .filter(Boolean)
}

function parseQuote(body: string): string {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('>'))
    .map((l) => l.replace(/^>\s?/, '').trim())
    .join('\n')
    .trim()
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*\)/, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function headerMatches(h: string, candidates: string[]): boolean {
  const n = normalizeHeader(h)
  return candidates.some((c) => n === c || n.startsWith(c))
}

export function soulFromMarkdown(md: string): SoulFields {
  const fields: SoulFields = { ...emptySoulFields }
  if (!md.trim()) return fields

  const { head, sections } = splitSections(md)
  const { businessName, rol } = parseTitleBlock(head)
  fields.businessName = businessName
  fields.rol = rol
  fields.rubro = extractRubro(rol)

  const extraSections: ParsedSection[] = []

  for (const section of sections) {
    const h = section.header
    if (headerMatches(h, ['tu unica operacion', 'tu única operación', 'operacion', 'operación'])) {
      fields.botDoes = parseBulletList(section.body)
    } else if (headerMatches(h, ['que no hacer', 'qué no hacer', 'limites estrictos', 'límites estrictos'])) {
      fields.botDoesNot = parseBulletList(section.body)
    } else if (headerMatches(h, ['que captar', 'qué captar', 'captura', 'datos a capturar'])) {
      fields.leadFields = parseBulletList(section.body)
    } else if (headerMatches(h, ['precios'])) {
      fields.precios = section.body.trim()
    } else if (headerMatches(h, ['cierre', 'escritura del cierre', 'cierre de conversacion'])) {
      const quote = parseQuote(section.body)
      fields.cierre = quote || section.body.trim()
    } else if (headerMatches(h, ['anti alucinacion', 'anti-alucinacion', 'anti alucinacion', 'antialucinacion'])) {
      fields.antiAlucinacion = parseBulletList(section.body)
    } else {
      extraSections.push(section)
    }
  }

  fields.extra = extraSections
    .map((s) => `## ${s.header}\n\n${s.body.trim()}`)
    .join('\n\n')
    .trim()

  return fields
}

function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join('\n')
}

function numbered(items: string[]): string {
  return items.map((i, idx) => `${idx + 1}. ${i}`).join('\n')
}

export function markdownFromSoul(f: SoulFields): string {
  const parts: string[] = []

  if (f.businessName) {
    parts.push(`# Lead AI Assistant — ${f.businessName}`)
  } else {
    parts.push('# Lead AI Assistant')
  }

  if (f.rol) {
    parts.push('')
    parts.push(f.rol)
  }

  if (f.botDoes.length) {
    parts.push('')
    parts.push('## Tu única operación')
    parts.push('')
    parts.push(numbered(f.botDoes))
  }

  if (f.leadFields.length) {
    parts.push('')
    parts.push('## Qué captar cuando hay interés')
    parts.push('')
    parts.push(bullets(f.leadFields.map((l) => `**${l}**`)))
  }

  if (f.botDoesNot.length) {
    parts.push('')
    parts.push('## Qué NO hacer')
    parts.push('')
    parts.push(bullets(f.botDoesNot))
  }

  if (f.precios.trim()) {
    parts.push('')
    parts.push('## Precios')
    parts.push('')
    parts.push(f.precios.trim())
  }

  if (f.cierre.trim()) {
    parts.push('')
    parts.push('## Cierre (una vez por conversación con interés)')
    parts.push('')
    const quote = f.cierre
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
    parts.push(quote)
  }

  if (f.antiAlucinacion.length) {
    parts.push('')
    parts.push('## Anti-alucinación')
    parts.push('')
    parts.push(bullets(f.antiAlucinacion))
  }

  if (f.extra.trim()) {
    parts.push('')
    parts.push(f.extra.trim())
  }

  return parts.join('\n') + '\n'
}

/**
 * Heurística: ¿este markdown se ve como un SOUL.md reconocible (tiene
 * al menos 2 de los headers que el wizard maneja)? Si no, conviene abrir
 * directo en modo avanzado en vez de mostrar el wizard vacío.
 */
export function looksLikeSoul(md: string): boolean {
  if (!md.trim()) return true
  const { sections } = splitSections(md)
  const known = sections.filter((s) =>
    [
      'tu unica operacion',
      'que no hacer',
      'que captar',
      'precios',
      'cierre',
      'anti alucinacion',
    ].some((c) => normalizeHeader(s.header).startsWith(c))
  )
  return known.length >= 2
}
