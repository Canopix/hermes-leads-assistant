'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  emptySoulFields,
  looksLikeSoul,
  markdownFromSoul,
  soulFromMarkdown,
  type SoulFields,
} from '@/lib/soul-wizard'
import { RUBROS, type RubroKey } from '@/lib/lead-capture-templates'
import { MarkdownEditor } from '@/components/ui/markdown-editor'

interface SoulWizardProps {
  initialMd: string
  onSave: (md: string) => void | Promise<void>
  saving?: boolean
  /** Marcar cambios sin guardar, validar antes de reiniciar, etc. */
  originalMd: string
}

type StepKey = 'intro' | 'identidad' | 'operacion' | 'captura' | 'reglas' | 'review'

const STEPS: { key: StepKey; label: string; help: string }[] = [
  { key: 'intro', label: '¿Qué es el SOUL?', help: 'Para qué sirve este archivo' },
  { key: 'identidad', label: 'Identidad', help: 'Quién es el negocio y el rol del bot' },
  { key: 'operacion', label: 'Operación', help: 'Qué hace y qué no hace el bot' },
  { key: 'captura', label: 'Captura de leads', help: 'Qué datos recolectar' },
  { key: 'reglas', label: 'Reglas clave', help: 'Precios, cierre y anti-alucinación' },
  { key: 'review', label: 'Revisión', help: 'Markdown final' },
]

const SUGGESTED_LEAD_FIELDS = [
  'Nombre',
  'Producto / vehículo de interés',
  'Presupuesto o rango',
  'Forma de pago preferida',
  'Urgencia',
  'Necesidades',
  'Contacto (si lo ofrece)',
]

export function SoulWizard({ initialMd, onSave, saving = false, originalMd }: SoulWizardProps) {
  const recognisable = useMemo(() => looksLikeSoul(initialMd), [initialMd])
  const [fields, setFields] = useState<SoulFields>(() =>
    recognisable ? soulFromMarkdown(initialMd) : { ...emptySoulFields, extra: initialMd }
  )
  const [step, setStep] = useState<StepKey>(recognisable ? 'intro' : 'review')
  const [advanced, setAdvanced] = useState(!recognisable)
  const [rawMd, setRawMd] = useState(initialMd)
  const [dirty, setDirty] = useState(false)

  // Si cambian el markdown inicial desde afuera (reload, nuevo slug), reseteamos.
  useEffect(() => {
    const r = looksLikeSoul(initialMd)
    setFields(r ? soulFromMarkdown(initialMd) : { ...emptySoulFields, extra: initialMd })
    setRawMd(initialMd)
    setAdvanced(!r)
    setStep(r ? 'intro' : 'review')
    setDirty(false)
  }, [initialMd])

  const generatedMd = useMemo(() => markdownFromSoul(fields), [fields])

  // El markdown "vivo" depende del modo: en wizard usamos el generado; en
  // avanzado respetamos lo que el usuario teclee en el editor crudo.
  const currentMd = advanced ? rawMd : generatedMd
  useEffect(() => {
    setDirty(currentMd !== originalMd)
  }, [currentMd, originalMd])

  const update = <K extends keyof SoulFields>(key: K, value: SoulFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }))

  const handleSave = () => onSave(currentMd)

  const stepIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className={
              'inline-flex h-2 w-2 rounded-full ' + (dirty ? 'bg-orange-500' : 'bg-green-500')
            }
          />
          {dirty ? 'Cambios sin guardar' : 'Sin cambios'}
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={advanced}
            onChange={(e) => {
              const next = e.target.checked
              if (next) {
                // Al pasar a avanzado, llenamos el editor crudo con el markdown actual.
                setRawMd(currentMd)
              } else {
                // Al volver al wizard, repoblamos los campos desde el markdown crudo.
                const parsed = soulFromMarkdown(rawMd)
                setFields(parsed)
              }
              setAdvanced(next)
              setStep(next ? 'review' : 'intro')
            }}
          />
          Modo avanzado (editar markdown crudo)
        </label>
      </div>

      {!advanced && (
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
          <ol className="space-y-1">
            {STEPS.map((s, i) => {
              const active = s.key === step
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => setStep(s.key)}
                    className={
                      'w-full text-left rounded-md px-3 py-2 transition ' +
                      (active
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted text-foreground')
                    }
                  >
                    <div className="text-sm font-medium">
                      <span className="text-xs opacity-70 mr-2">{i + 1}.</span>
                      {s.label}
                    </div>
                    <div
                      className={
                        'text-xs mt-0.5 ' + (active ? 'text-primary-foreground/80' : 'text-muted-foreground')
                      }
                    >
                      {s.help}
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="min-w-0">
            {step === 'intro' && <IntroStep />}
            {step === 'identidad' && (
              <IdentidadStep fields={fields} update={update} />
            )}
            {step === 'operacion' && (
              <OperacionStep fields={fields} update={update} />
            )}
            {step === 'captura' && (
              <CapturaStep fields={fields} update={update} />
            )}
            {step === 'reglas' && (
              <ReglasStep fields={fields} update={update} />
            )}
            {step === 'review' && (
              <ReviewStep
                md={generatedMd}
                onMdChange={(v) => {
                  // En revisión dentro del wizard, editar markdown reparsea los campos
                  // para no desincronizarlos.
                  setFields(soulFromMarkdown(v))
                }}
              />
            )}

            <div className="flex items-center justify-between mt-6 gap-3">
              <button
                type="button"
                onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].key)}
                disabled={stepIndex === 0}
                className="px-3 py-2 text-sm rounded-md border disabled:opacity-40"
              >
                ← Anterior
              </button>
              <div className="flex items-center gap-2">
                {stepIndex < STEPS.length - 1 && (
                  <button
                    type="button"
                    onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].key)}
                    className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground"
                  >
                    Siguiente →
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {advanced && (
        <div className="space-y-3">
          <MarkdownEditor value={currentMd} onChange={setRawMd} height="600px" />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Step components ---------- */

function StepShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function IntroStep() {
  return (
    <StepShell
      title="¿Qué es el SOUL?"
      description="Antes de tocar nada, entendé qué archivo estás por editar."
    >
      <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-3 leading-relaxed">
        <p>
          El <code className="px-1 py-0.5 rounded bg-muted">SOUL.md</code> es el{' '}
          <strong>system prompt</strong> del bot para este negocio. Define, en una sola
          página, <strong>quién es</strong>, <strong>qué hace</strong>,{' '}
          <strong>qué no hace</strong> y <strong>cómo captura leads</strong>.
        </p>
        <p>
          Lo que escribas acá se aplica al{' '}
          <strong>reiniciar el gateway</strong> (después de guardar) y se combina con la{' '}
          <strong>Knowledge Base</strong> del negocio (catálogo, precios, políticas).
        </p>
        <p className="text-muted-foreground">
          Este wizard te lleva paso a paso. Si ya tenés un SOUL armado o querés
          tocar el markdown a mano, activá <em>Modo avanzado</em> arriba.
        </p>
      </div>
    </StepShell>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

function IdentidadStep({
  fields,
  update,
}: {
  fields: SoulFields
  update: <K extends keyof SoulFields>(key: K, value: SoulFields[K]) => void
}) {
  const aplicarRubro = (key: RubroKey) => {
    const r = RUBROS[key]
    const rubroTexto = key === 'otro' ? '' : r.label.toLowerCase()
    update('rubro', rubroTexto)
    if (fields.businessName) {
      update('rol', buildRol(fields.businessName, rubroTexto))
    }
    // Sugerir campos si el usuario no cargó ninguno.
    if (fields.leadFields.length === 0 && key !== 'otro') {
      update(
        'leadFields',
        r.fields.map((f) => f.label)
      )
    }
  }

  return (
    <StepShell
      title="Identidad del negocio"
      description="Quién es el negocio y cuál es el rol del bot."
    >
      <Field
        label="Arrancar desde un rubro"
        hint="Carga un texto de partida que podés ajustar después. No pisa lo que ya tengas cargado."
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {(Object.keys(RUBROS) as RubroKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => aplicarRubro(key)}
              className="text-left rounded-md border px-3 py-2 text-sm hover:bg-muted transition"
            >
              {RUBROS[key].label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Nombre del negocio" hint="Aparece en el título y en el mensaje de cierre.">
        <input
          className={inputCls}
          value={fields.businessName}
          onChange={(e) => {
            update('businessName', e.target.value)
            if (fields.rubro) update('rol', buildRol(e.target.value, fields.rubro))
          }}
          placeholder="Canova Cars"
        />
      </Field>
      <Field label="Rubro" hint="Una frase corta, ej: 'agencia de venta de automóviles'.">
        <input
          className={inputCls}
          value={fields.rubro}
          onChange={(e) => {
            const rubro = e.target.value
            update('rol', buildRol(fields.businessName, rubro))
            update('rubro', rubro)
          }}
          placeholder="agencia de venta de automóviles"
        />
      </Field>
      <Field label="Rol del bot" hint="Párrafo de introducción. Se puede editar a mano.">
        <textarea
          className={inputCls + ' min-h-[110px]'}
          value={fields.rol}
          onChange={(e) => update('rol', e.target.value)}
          placeholder="Eres el asistente de captación de leads para..."
        />
      </Field>
    </StepShell>
  )
}

function buildRol(business: string, rubro: string): string {
  const name = business || '{negocio}'
  const rub = rubro || '{rubro}'
  return `Eres el asistente de **captación de leads** para **${name}** (${rub}).\n\nPerfil de **referencia** del producto: informás, registrás el lead, un **asesor humano** cierra.`
}

function ListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[]
  onChange: (items: string[]) => void
  placeholder: string
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={inputCls}
            value={item}
            onChange={(e) => {
              const next = [...items]
              next[i] = e.target.value
              onChange(next)
            }}
            placeholder={placeholder}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="px-2 py-2 rounded-md border text-sm hover:bg-muted"
            aria-label="Quitar"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted"
      >
        + Agregar
      </button>
    </div>
  )
}

function OperacionStep({
  fields,
  update,
}: {
  fields: SoulFields
  update: <K extends keyof SoulFields>(key: K, value: SoulFields[K]) => void
}) {
  return (
    <StepShell
      title="Operación"
      description="Qué hace el bot y qué deja fuera (lo cierra un asesor humano)."
    >
      <Field label="Lo que el bot hace" hint="Pasos numerados, en orden.">
        <ListEditor
          items={fields.botDoes}
          onChange={(items) => update('botDoes', items)}
          placeholder="Informar con datos de la KB"
        />
      </Field>
      <Field label="Lo que el bot NO hace" hint="Lista de límites operativos.">
        <ListEditor
          items={fields.botDoesNot}
          onChange={(items) => update('botDoesNot', items)}
          placeholder="Precio final, reserva, entrega"
        />
      </Field>
    </StepShell>
  )
}

function CapturaStep({
  fields,
  update,
}: {
  fields: SoulFields
  update: <K extends keyof SoulFields>(key: K, value: SoulFields[K]) => void
}) {
  const present = new Set(fields.leadFields)
  const missing = SUGGESTED_LEAD_FIELDS.filter((s) => !present.has(s))
  return (
    <StepShell
      title="Captura de leads"
      description="Qué datos debe recolectar el bot en cada conversación con interés."
    >
      {missing.length > 0 && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="text-xs text-muted-foreground">Sugerencias rápidas (clic para sumar):</div>
          <div className="flex flex-wrap gap-2">
            {missing.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => update('leadFields', [...fields.leadFields, s])}
                className="text-xs px-2 py-1 rounded-full border hover:bg-muted"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <Field label="Campos a capturar">
        <ListEditor
          items={fields.leadFields}
          onChange={(items) => update('leadFields', items)}
          placeholder="Nombre"
        />
      </Field>
    </StepShell>
  )
}

function ReglasStep({
  fields,
  update,
}: {
  fields: SoulFields
  update: <K extends keyof SoulFields>(key: K, value: SoulFields[K]) => void
}) {
  return (
    <StepShell
      title="Reglas clave"
      description="Política de precios, mensaje de cierre y reglas anti-alucinación."
    >
      <Field label="Política de precios" hint="Cómo responder cuando piden precio final.">
        <textarea
          className={inputCls + ' min-h-[90px]'}
          value={fields.precios}
          onChange={(e) => update('precios', e.target.value)}
          placeholder="Solo referenciales ('desde $X'). Si piden final: un asesor te contacta."
        />
      </Field>
      <Field label="Mensaje de cierre" hint="Una vez por conversación con interés.">
        <textarea
          className={inputCls + ' min-h-[90px]'}
          value={fields.cierre}
          onChange={(e) => update('cierre', e.target.value)}
          placeholder={'Perfecto, [nombre]. Queda registrado. Un asesor te escribe por acá.'}
        />
      </Field>
      <Field label="Reglas anti-alucinación" hint="Qué no inventar nunca.">
        <ListEditor
          items={fields.antiAlucinacion}
          onChange={(items) => update('antiAlucinacion', items)}
          placeholder="Cero inventos (precios, stock, disponibilidad)"
        />
      </Field>
    </StepShell>
  )
}

function ReviewStep({ md, onMdChange }: { md: string; onMdChange: (md: string) => void }) {
  return (
    <StepShell
      title="Revisión final"
      description="Este es el markdown que se va a guardar. Editalo fino si hace falta."
    >
      <MarkdownEditor value={md} onChange={onMdChange} height="560px" />
    </StepShell>
  )
}
