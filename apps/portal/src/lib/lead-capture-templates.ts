/**
 * Plantillas de campos a capturar por rubro + serialización del texto que se
 * persiste en `lead_capture.extraction_hints` del config.yaml.
 *
 * El extractor Python lee ese texto y lo appenda al prompt del LLM, pidiéndole
 * que devuelva cada campo como clave top-level del JSON. Los campos base
 * (name, email, phone, interest, urgency, temperature, summary, confidence)
 * se filtran en la UI del detalle del lead, así que estos son los únicos que
 * aparecen en la tarjeta "Datos del lead".
 */

export type RubroKey =
  | 'automotor'
  | 'inmobiliaria'
  | 'turismo'
  | 'retail'
  | 'servicios'
  | 'otro'

export interface PlantillaCampo {
  /** Clave snake_case que va a parar al JSON del extractor. */
  key: string
  /** Etiqueta humana, para mostrar en la UI. */
  label: string
  /** Descripción corta del valor esperado (se usa también en el prompt). */
  desc: string
}

export interface PlantillaRubro {
  label: string
  /** Descripción corta para mostrar en el selector. */
  blurb: string
  /** Campos sugeridos al elegir este rubro. */
  fields: PlantillaCampo[]
  /** Texto crudo extra para appendar bajo "Reglas" (opcional). */
  reglas?: string
}

export const RUBROS: Record<RubroKey, PlantillaRubro> = {
  automotor: {
    label: 'Automotor',
    blurb: 'Venta de autos, motos y vehículos en general.',
    fields: [
      { key: 'vehicle_type', label: 'Tipo de vehículo', desc: 'SUV / sedán / pickup / hatchback / citycar' },
      { key: 'vehicle_condition', label: 'Condición', desc: 'Nuevo / usado / indistinto' },
      { key: 'vehicle_reference', label: 'Modelo de referencia', desc: 'Marca o modelo mencionado (ej: Ford Ecosport)' },
      { key: 'budget', label: 'Presupuesto', desc: 'Monto con moneda (ej: 15000 USD)' },
      { key: 'payment_method', label: 'Forma de pago', desc: 'Contado / financiación / crédito / ambos' },
      { key: 'use_case', label: 'Uso principal', desc: 'Familiar / trabajo / personal / primer auto' },
      { key: 'timeframe', label: 'Plazo', desc: 'Inmediato / 1-3 meses / explorando' },
      { key: 'has_trade_in', label: 'Entrega como parte de pago', desc: 'true / false (solo true si lo menciona)' },
    ],
    reglas:
      '- Si el presupuesto viene en otra moneda, normalizalo a USD entre paréntesis.\n' +
      '- Si menciona más de un modelo de referencia, juntalos en vehicle_reference separados por coma.\n' +
      '- has_trade_in solo en true si el lead lo dice explícitamente; si no, string vacío.',
  },
  inmobiliaria: {
    label: 'Inmobiliaria',
    blurb: 'Venta y alquiler de inmuebles.',
    fields: [
      { key: 'property_type', label: 'Tipo de inmueble', desc: 'Casa / depto / terreno / local / oficina' },
      { key: 'operation', label: 'Operación', desc: 'Compra / alquiler / alquiler temporario' },
      { key: 'location', label: 'Ubicación deseada', desc: 'Barrio, zona o ciudad' },
      { key: 'bedrooms', label: 'Dormitorios', desc: 'Cantidad o rango (ej: 2-3)' },
      { key: 'budget', label: 'Presupuesto', desc: 'Monto con moneda (ej: 80000 USD)' },
      { key: 'timeframe', label: 'Plazo de mudanza', desc: 'Inmediato / 1-3 meses / explorando' },
      { key: 'financing', label: 'Financiación', desc: 'Contado / hipoteca / ambos' },
    ],
    reglas:
      '- Si menciona más de una ubicación, juntalas en location separadas por coma.\n' +
      '- Si no menciona dormitorios, dejá el campo vacío (no asumas).',
  },
  turismo: {
    label: 'Turismo / Viajes',
    blurb: 'Agencias de viajes, paquetes, excursiones.',
    fields: [
      { key: 'destination', label: 'Destino', desc: 'Lugar o región de interés' },
      { key: 'travel_dates', label: 'Fechas', desc: 'Rango de fechas o mes (ej: julio 2026)' },
      { key: 'passengers', label: 'Pasajeros', desc: 'Cantidad de adultos / niños' },
      { key: 'package_type', label: 'Tipo de paquete', desc: 'All-inclusive / solo alojamiento / vuelo+hotel / excursión' },
      { key: 'accommodation', label: 'Alojamiento', desc: 'Hotel / cabaña / hostel / camping' },
      { key: 'budget', label: 'Presupuesto', desc: 'Monto con moneda (ej: 1500 USD)' },
      { key: 'special_requests', label: 'Pedidos especiales', desc: 'Dietas, movilidad, mascotas, etc.' },
    ],
    reglas:
      '- El viajero suele contactar por el canal; no pidas email/teléfono salvo que lo ofrezca para otro medio.\n' +
      '- Si las fechas son flexibles, anotalo en travel_dates.',
  },
  retail: {
    label: 'Retail / Tienda',
    blurb: 'Venta de productos físicos (indumentaria, electrónica, etc.).',
    fields: [
      { key: 'category', label: 'Categoría', desc: 'Tipo de producto buscado' },
      { key: 'brand_preference', label: 'Marca preferida', desc: 'Marca o marcas mencionadas' },
      { key: 'variant', label: 'Variante', desc: 'Talle, medida, color, capacidad (lo que aplique)' },
      { key: 'budget', label: 'Presupuesto', desc: 'Monto con moneda' },
      { key: 'stock_preference', label: 'Disponibilidad', desc: 'Inmediato / acepta espera / reserva' },
      { key: 'timeframe', label: 'Plazo', desc: 'Inmediato / 1-3 meses / explorando' },
    ],
    reglas:
      '- Si menciona más de un producto, juntalos en category separados por coma.',
  },
  servicios: {
    label: 'Servicios',
    blurb: 'Servicios profesionales, consultorías, salud, etc.',
    fields: [
      { key: 'service_type', label: 'Tipo de servicio', desc: 'Qué servicio necesita' },
      { key: 'urgency', label: 'Urgencia', desc: 'Inmediata / esta semana / programable' },
      { key: 'location', label: 'Zona', desc: 'Barrio, zona o ciudad donde se presta el servicio' },
      { key: 'budget', label: 'Presupuesto', desc: 'Monto con moneda o rango' },
      { key: 'preferred_schedule', label: 'Horario preferido', desc: 'Franja horaria para atención' },
    ],
    reglas:
      '- Si menciona más de un servicio, juntalos en service_type separados por coma.',
  },
  otro: {
    label: 'Otro / Personalizado',
    blurb: 'Armá los campos a mano, sin plantilla.',
    fields: [],
  },
}

/**
 * Lista de sugerencias extra (adicionales a los del rubro) para ofrecer al
 * usuario como "chips clicables" en el editor.
 */
export const SUGERENCIAS_EXTRA: PlantillaCampo[] = [
  { key: 'budget', label: 'Presupuesto', desc: 'Cuánto está dispuesto a gastar' },
  { key: 'timeframe', label: 'Plazo', desc: 'Inmediato / 1-3 meses / explorando' },
  { key: 'location', label: 'Ubicación', desc: 'Zona geográfica' },
  { key: 'company', label: 'Empresa', desc: 'Si es lead B2B' },
  { key: 'role', label: 'Cargo', desc: 'Rol del contacto (B2B)' },
  { key: 'preferred_contact', label: 'Contacto preferido', desc: 'WhatsApp / llamada / email' },
]

/* ---------- Serialización / Parser ---------- */

export interface LeadCaptureConfig {
  rubro: RubroKey | ''
  fields: PlantillaCampo[]
  reglas: string
  /** Texto suelto que no supo mapearse (preservado al regenerar). */
  extra: string
}

export const emptyLeadCapture: LeadCaptureConfig = {
  rubro: '',
  fields: [],
  reglas: '',
  extra: '',
}

const HEADER_RUBRO = /^rubro\s*:/i
const HEADER_CAMPOS = /^campos a extraer/i
const HEADER_REGLAS = /^reglas/i

/**
 * Detecta si el texto crudo del config.yaml tiene el formato generado por
 * este editor. Si no, lo dejamos como `extra` y abrimos en modo avanzado.
 */
export function looksLikeHints(text: string): boolean {
  if (!text.trim()) return true
  return (
    HEADER_RUBRO.test(text) ||
    HEADER_CAMPOS.test(text) ||
    HEADER_REGLAS.test(text)
  )
}

/**
 * Parsea el texto de `extraction_hints` al modelo del editor.
 *
 * Formato esperado (tolerante):
 *
 *   Rubro: automotor.
 *
 *   Campos a extraer (claves top-level en el JSON):
 *   - vehicle_type: tipo de vehículo (SUV / sedán / pickup)
 *   - budget: presupuesto con moneda (ej: 15000 USD)
 *
 *   Reglas:
 *   - Si menciona más de un modelo, juntarlos en vehicle_reference.
 *
 * Cualquier contenido fuera de estas secciones se conserva en `extra`.
 */
export function hintsToConfig(text: string): LeadCaptureConfig {
  const cfg: LeadCaptureConfig = { ...emptyLeadCapture }
  if (!text.trim()) return cfg

  const lines = text.split('\n')
  let section: 'head' | 'campos' | 'reglas' | 'extra' = 'head'
  const buffer: Record<'head' | 'campos' | 'reglas' | 'extra', string[]> = {
    head: [],
    campos: [],
    reglas: [],
    extra: [],
  }

  for (const line of lines) {
    if (HEADER_RUBRO.test(line.trim())) {
      const value = line.replace(HEADER_RUBRO, '').replace(/[.:]\s*$/, '').trim()
      const match = (Object.keys(RUBROS) as RubroKey[]).find(
        (k) => k === value.toLowerCase() || RUBROS[k].label.toLowerCase() === value.toLowerCase()
      )
      cfg.rubro = match || ''
      continue
    }
    if (HEADER_CAMPOS.test(line.trim())) {
      section = 'campos'
      continue
    }
    if (HEADER_REGLAS.test(line.trim())) {
      section = 'reglas'
      continue
    }
    buffer[section].push(line)
  }

  cfg.fields = buffer.campos
    .map((l) => parseCampoLine(l))
    .filter((c): c is PlantillaCampo => c !== null)

  const reglasText = buffer.reglas.join('\n').trim()
  cfg.reglas = reglasText

  const extraText = buffer.head.concat(buffer.extra).join('\n').trim()
  cfg.extra = extraText

  return cfg
}

function parseCampoLine(line: string): PlantillaCampo | null {
  const m = line.match(/^\s*[-*]\s*([a-z0-9_]+)\s*:\s*(.+)$/i)
  if (!m) return null
  const key = m[1].trim()
  const rest = m[2].trim()
  // "presupuesto (ej: 15000 USD)" → label="Presupuesto", desc="(ej: ...)"
  // O ya venir como "Presupuesto — cuánto gasta".
  let label = rest
  let desc = ''
  const sep = rest.match(/\s*[—\-–]\s*(.+)/)
  if (sep) {
    label = rest.slice(0, sep.index).trim()
    desc = sep[1].trim()
  } else {
    const paren = rest.match(/\(([^)]+)\)\s*$/)
    if (paren) {
      label = rest.slice(0, paren.index).trim()
      desc = paren[1].trim()
    }
  }
  label = label || humanizeKey(key)
  return { key, label, desc }
}

function humanizeKey(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Serializa el modelo del editor al texto que va en `extraction_hints`.
 * Es el inverso de `hintsToConfig` y debe mantenerse estable para que el
 * extractor Python lo siga entendiendo.
 */
export function configToHints(cfg: LeadCaptureConfig): string {
  const parts: string[] = []

  if (cfg.rubro && cfg.rubro !== 'otro') {
    parts.push(`Rubro: ${RUBROS[cfg.rubro].label}.`)
  } else if (cfg.rubro === 'otro') {
    parts.push('Rubro: personalizado.')
  }

  if (cfg.fields.length > 0) {
    parts.push('')
    parts.push('Campos a extraer (claves top-level en el JSON):')
    for (const f of cfg.fields) {
      const desc = f.desc ? ` — ${f.desc}` : ''
      parts.push(`- ${f.key}: ${f.label}${desc}`)
    }
  }

  const reglas = cfg.reglas.trim()
  if (reglas) {
    parts.push('')
    parts.push('Reglas:')
    parts.push(reglas)
  }

  const extra = cfg.extra.trim()
  if (extra) {
    parts.push('')
    parts.push(extra)
  }

  return parts.join('\n').trim() + '\n'
}
