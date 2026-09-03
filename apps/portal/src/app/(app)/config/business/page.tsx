'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Field, inputCls } from '@/components/ui/field'

interface BusinessConfig {
  client_name: string
  business_hours: string
  out_of_hours_message: string
  rate_limit_message: string
  max_messages_per_hour: number
  max_message_length: number
  allowed_topics: string[]
}

const ZONAS_HORARIAS = [
  'America/Argentina/Buenos_Aires',
  'America/Argentina/Cordoba',
  'America/Argentina/Mendoza',
  'America/Montevideo',
  'America/Santiago',
  'America/Bogota',
  'America/Lima',
  'America/Mexico_City',
]

/** Sugerencias de topics por rubro (solo para autocomplete del input). */
const TOPIC_SUGERIDOS = [
  'precios',
  'cotización',
  'modelos',
  'disponibilidad',
  'financiación',
  'turnos',
  'ubicación',
  'horarios',
  'envíos',
  'garantía',
]

// Formato: "09:00-18:00 America/Argentina/Buenos_Aires"
function parseBusinessHours(raw: string): { desde: string; hasta: string; tz: string } {
  const m = raw.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(.+)$/)
  if (m) return { desde: m[1], hasta: m[2], tz: m[3].trim() }
  return { desde: '09:00', hasta: '18:00', tz: 'America/Argentina/Buenos_Aires' }
}

function formatBusinessHours(p: { desde: string; hasta: string; tz: string }): string {
  return `${p.desde}-${p.hasta} ${p.tz}`.trim()
}

export default function BusinessConfigPage() {
  const searchParams = useSearchParams()
  const slug = searchParams.get('slug') || ''
  const slugQuery = slug ? `?slug=${encodeURIComponent(slug)}` : ''
  const [config, setConfig] = useState<BusinessConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [newTopic, setNewTopic] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/config/business${slugQuery}`)
      .then((r) => r.json())
      .then((d) => {
        setConfig(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slugQuery])

  const save = async () => {
    if (!config) return
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`/api/config/business${slugQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.ok) {
        setMsg('Guardado. Aplica en el próximo mensaje del bot.')
        setTimeout(() => setMsg(''), 4000)
      } else {
        setMsg('Error: ' + (data.error || 'unknown'))
      }
    } catch (e: any) {
      setMsg('Error: ' + e.message)
    }
    setSaving(false)
  }

  const addTopic = (value?: string) => {
    const v = (value ?? newTopic).trim()
    if (!v || !config) return
    if (config.allowed_topics.includes(v)) {
      setNewTopic('')
      return
    }
    setConfig({ ...config, allowed_topics: [...config.allowed_topics, v] })
    setNewTopic('')
  }

  const removeTopic = (index: number) => {
    if (!config) return
    setConfig({
      ...config,
      allowed_topics: config.allowed_topics.filter((_, i) => i !== index),
    })
  }

  const hours = config ? parseBusinessHours(config.business_hours) : null
  const dirty = !!config // simplificación: el PUT es idempotente

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Link
          href="/config"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Configuración
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Datos del negocio</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Nombre visible, horarios de atención, mensajes automáticos y límites de uso.
      </p>

      {loading ? (
        <div className="text-muted-foreground py-8">Cargando…</div>
      ) : !config ? (
        <div className="text-muted-foreground py-8">Error al cargar</div>
      ) : (
        <div className="space-y-6">
          {/* Tu negocio */}
          <section className="border rounded-lg p-6">
            <h2 className="font-semibold text-lg mb-1">Tu negocio</h2>
            <p className="text-sm text-muted-foreground mb-4">
              El nombre lo usa el bot para presentarse y firmar mensajes.
            </p>
            <Field
              label="Nombre del negocio"
              hint="Aparece en el saludo del bot y en el cierre de cada conversación."
            >
              <input
                type="text"
                value={config.client_name}
                onChange={(e) => setConfig({ ...config, client_name: e.target.value })}
                placeholder="Canova Cars"
                className={inputCls}
              />
            </Field>
          </section>

          {/* Horarios */}
          <section className="border rounded-lg p-6">
            <h2 className="font-semibold text-lg mb-1">Horarios de atención</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Fuera de este horario el bot contesta con el mensaje que pongas abajo.
            </p>
            {hours && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Desde">
                  <input
                    type="time"
                    value={hours.desde}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        business_hours: formatBusinessHours({
                          ...hours,
                          desde: e.target.value,
                        }),
                      })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Hasta">
                  <input
                    type="time"
                    value={hours.hasta}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        business_hours: formatBusinessHours({
                          ...hours,
                          hasta: e.target.value,
                        }),
                      })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Zona horaria">
                  <select
                    value={hours.tz}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        business_hours: formatBusinessHours({ ...hours, tz: e.target.value }),
                      })
                    }
                    className={inputCls}
                  >
                    {ZONAS_HORARIAS.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace('America/', '').replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3 font-mono">
              {config.business_hours}
            </p>
          </section>

          {/* Mensajes automáticos */}
          <section className="border rounded-lg p-6">
            <h2 className="font-semibold text-lg mb-1">Mensajes automáticos del bot</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Respuestas prefijadas que envía el bot en ciertas situaciones.
            </p>
            <div className="space-y-4">
              <Field
                label="Mensaje fuera de horario"
                hint="Lo recibe quien escribe fuera del horario de atención."
              >
                <textarea
                  value={config.out_of_hours_message}
                  onChange={(e) =>
                    setConfig({ ...config, out_of_hours_message: e.target.value })
                  }
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              </Field>
              <Field
                label="Mensaje de límite de uso"
                hint="Lo recibe quien escribe demasiado seguido (supera el máximo por hora)."
              >
                <textarea
                  value={config.rate_limit_message}
                  onChange={(e) =>
                    setConfig({ ...config, rate_limit_message: e.target.value })
                  }
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Máximo de mensajes por hora (por usuario)"
                  hint="Si lo supera, recibe el mensaje de límite."
                >
                  <input
                    type="number"
                    min={1}
                    value={config.max_messages_per_hour}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        max_messages_per_hour: parseInt(e.target.value) || 30,
                      })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field
                  label="Largo máximo de mensaje (caracteres)"
                  hint="Mensajes más largos se truncan."
                >
                  <input
                    type="number"
                    min={100}
                    value={config.max_message_length}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        max_message_length: parseInt(e.target.value) || 4000,
                      })
                    }
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>
          </section>

          {/* Topics */}
          <section className="border rounded-lg p-6">
            <h2 className="font-semibold text-lg mb-1">Temas permitidos</h2>
            <p className="text-sm text-muted-foreground mb-4">
              De qué temas puede hablar el bot. Si una conversación se va de tema, el bot la corta
              con cortesía. No incluir temas sensibles (política, religión, etc.).
            </p>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTopic()
                  }
                }}
                placeholder="Nuevo tema (ej: precios)"
                className={inputCls}
                list="topic-sugeridos"
              />
              <datalist id="topic-sugeridos">
                {TOPIC_SUGERIDOS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <button
                onClick={() => addTopic()}
                disabled={!newTopic.trim()}
                className="px-3 py-2 border rounded-md text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Agregar
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {config.allowed_topics.map((topic, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 bg-muted rounded-full text-sm"
                >
                  {topic}
                  <button
                    onClick={() => removeTopic(i)}
                    className="text-muted-foreground hover:text-foreground text-base leading-none"
                    aria-label={`Quitar ${topic}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {config.allowed_topics.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  Sin temas definidos. El bot va a responder cualquier tema.
                </span>
              )}
            </div>
          </section>

          {/* Guardar */}
          <div className="flex items-center gap-4">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
