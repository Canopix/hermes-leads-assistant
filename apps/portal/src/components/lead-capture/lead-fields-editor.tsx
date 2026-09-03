'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  configToHints,
  emptyLeadCapture,
  hintsToConfig,
  looksLikeHints,
  RUBROS,
  SUGERENCIAS_EXTRA,
  type LeadCaptureConfig,
  type PlantillaCampo,
  type RubroKey,
} from '@/lib/lead-capture-templates'

interface LeadFieldsEditorProps {
  /** Contenido actual de extraction_hints (texto crudo del config.yaml). */
  initialHints: string
  /** Contenido original, para detectar cambios sin guardar. */
  originalHints: string
  onSave: (hints: string) => void | Promise<void>
  saving?: boolean
}

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

export function LeadFieldsEditor({
  initialHints,
  originalHints,
  onSave,
  saving = false,
}: LeadFieldsEditorProps) {
  const recognisable = useMemo(() => looksLikeHints(initialHints), [initialHints])
  const [cfg, setCfg] = useState<LeadCaptureConfig>(() =>
    recognisable ? hintsToConfig(initialHints) : { ...emptyLeadCapture, extra: initialHints }
  )
  const [advanced, setAdvanced] = useState(!recognisable)
  const [rawText, setRawText] = useState(initialHints)

  // Reset al cambiar el contenido inicial (reload, nuevo slug).
  useEffect(() => {
    const r = looksLikeHints(initialHints)
    setCfg(r ? hintsToConfig(initialHints) : { ...emptyLeadCapture, extra: initialHints })
    setRawText(initialHints)
    setAdvanced(!r)
  }, [initialHints])

  const generated = useMemo(() => configToHints(cfg), [cfg])
  const currentText = advanced ? rawText : generated
  const dirty = currentText !== originalHints

  const update = <K extends keyof LeadCaptureConfig>(key: K, value: LeadCaptureConfig[K]) =>
    setCfg((prev) => ({ ...prev, [key]: value }))

  const aplicarRubro = (rubro: RubroKey) => {
    const tpl = RUBROS[rubro]
    setCfg((prev) => ({
      ...prev,
      rubro,
      // No pisar campos que el usuario ya agregó si ya había algo.
      fields: prev.fields.length > 0 && prev.rubro ? prev.fields : tpl.fields.map((f) => ({ ...f })),
      reglas: prev.reglas || tpl.reglas || '',
    }))
  }

  const agregarCampo = (campo: PlantillaCampo) => {
    if (cfg.fields.some((f) => f.key === campo.key)) return
    update('fields', [...cfg.fields, { ...campo }])
  }

  const actualizarCampo = (idx: number, cambios: Partial<PlantillaCampo>) => {
    update(
      'fields',
      cfg.fields.map((f, i) => (i === idx ? { ...f, ...cambios } : f))
    )
  }

  const quitarCampo = (idx: number) => {
    update('fields', cfg.fields.filter((_, i) => i !== idx))
  }

  const handleSave = () => onSave(currentText)

  const clavesUsadas = new Set(cfg.fields.map((f) => f.key))
  const sugerenciasPendientes = SUGERENCIAS_EXTRA.filter((s) => !clavesUsadas.has(s.key))

  return (
    <div className="space-y-6">
      {/* Barra superior: estado + toggle avanzado */}
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
                setRawText(currentText)
              } else {
                setCfg(hintsToConfig(rawText))
              }
              setAdvanced(next)
            }}
          />
          Modo avanzado (editar texto crudo)
        </label>
      </div>

      {!advanced && (
        <div className="space-y-6">
          {/* Sección 1: Rubro */}
          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Tu rubro</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Elegí el rubro más parecido a tu negocio. Carga campos sugeridos que podés editar o
                quitar después.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(Object.keys(RUBROS) as RubroKey[]).map((key) => {
                const r = RUBROS[key]
                const active = cfg.rubro === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => aplicarRubro(key)}
                    className={
                      'text-left rounded-md border p-3 transition ' +
                      (active
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'hover:bg-muted')
                    }
                  >
                    <div className="text-sm font-medium">{r.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{r.blurb}</div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Sección 2: Campos */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Datos a guardar de cada lead</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Cada ítem se convierte en un campo visible en la ficha del lead. La clave va en
                  snake_case.
                </p>
              </div>
            </div>

            {cfg.fields.length === 0 && (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Elegí un rubro arriba para cargar sugerencias, o agregá un campo a mano.
              </div>
            )}

            {cfg.fields.map((f, i) => (
              <div
                key={i}
                className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_2fr_auto] gap-2 items-start rounded-md border p-3"
              >
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Clave</label>
                  <input
                    className={inputCls + ' font-mono'}
                    value={f.key}
                    onChange={(e) =>
                      actualizarCampo(i, {
                        key: e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9_]/g, '_')
                          .replace(/_+/g, '_'),
                      })
                    }
                    placeholder="budget"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Etiqueta</label>
                  <input
                    className={inputCls}
                    value={f.label}
                    onChange={(e) => actualizarCampo(i, { label: e.target.value })}
                    placeholder="Presupuesto"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    Descripción / valores esperados
                  </label>
                  <input
                    className={inputCls}
                    value={f.desc}
                    onChange={(e) => actualizarCampo(i, { desc: e.target.value })}
                    placeholder="ej: 15000 USD"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => quitarCampo(i)}
                  className="self-end mb-0.5 px-2 py-2 rounded-md border text-sm hover:bg-muted"
                  aria-label="Quitar campo"
                  title="Quitar"
                >
                  ×
                </button>
              </div>
            ))}

            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={() =>
                  update('fields', [
                    ...cfg.fields,
                    { key: '', label: '', desc: '' },
                  ])
                }
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted"
              >
                + Agregar campo
              </button>

              {sugerenciasPendientes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs text-muted-foreground">Sugerencias:</span>
                  {sugerenciasPendientes.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => agregarCampo(s)}
                      className="text-xs px-2 py-1 rounded-full border hover:bg-muted"
                    >
                      + {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Sección 3: Reglas */}
          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Reglas adicionales (opcional)</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Instrucciones extra para el extractor. Ej:{' '}
                <em>
                  &ldquo;Si menciona más de un modelo, juntarlos en vehicle_reference separados por
                  coma.&rdquo;
                </em>
              </p>
            </div>
            <textarea
              className={inputCls + ' min-h-[100px] font-mono'}
              value={cfg.reglas}
              onChange={(e) => update('reglas', e.target.value)}
              spellCheck={false}
              placeholder={'- Si menciona más de un modelo, juntarlos en una sola casilla.\n- ...'}
            />
          </section>

          <div className="flex justify-end">
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

      {advanced && (
        <div className="space-y-3">
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm text-yellow-900 dark:text-yellow-100">
            Editás el texto crudo que se guarda en{' '}
            <code className="px-1 py-0.5 rounded bg-muted">lead_capture.extraction_hints</code>. Si
            rompés el formato, el bot puede dejar de extraer campos. Volvé al modo guiado para
            validarlo.
          </div>
          <textarea
            className={
              inputCls + ' min-h-[460px] font-mono text-xs leading-relaxed'
            }
            value={currentText}
            onChange={(e) => setRawText(e.target.value)}
            spellCheck={false}
          />
          <div className="flex justify-end">
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
