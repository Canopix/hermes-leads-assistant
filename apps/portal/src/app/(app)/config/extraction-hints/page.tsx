'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LeadFieldsEditor } from '@/components/lead-capture/lead-fields-editor'

export default function ExtractionHintsEditor() {
  const searchParams = useSearchParams()
  const slug = searchParams.get('slug') || ''
  const slugQuery = slug ? `?slug=${encodeURIComponent(slug)}` : ''
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/config/extraction-hints${slugQuery}`)
      .then((r) => r.json())
      .then((data) => {
        setContent(data.content || '')
        setOriginal(data.content || '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slugQuery])

  const save = async (next: string) => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`/api/config/extraction-hints${slugQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: next }),
      })
      const data = await res.json()
      if (data.ok) {
        setContent(next)
        setOriginal(next)
        setMsg('Guardado. Los cambios se aplican en el próximo mensaje del bot.')
        setTimeout(() => setMsg(''), 4000)
      } else {
        setMsg('Error: ' + (data.error || 'unknown'))
      }
    } catch (e: any) {
      setMsg('Error: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-2">
        <Link
          href="/config"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Configuración
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Datos a capturar del contacto</h1>
      </div>
      <p className="text-xs text-muted-foreground mb-6">
        Se guarda en <code className="px-1 py-0.5 rounded bg-muted">lead_capture.extraction_hints</code>{' '}
        del config.yaml. No requiere reiniciar el gateway.
      </p>

      <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-2 leading-relaxed mb-6">
        <p>
          Acá definís <strong>qué información querés que el bot guarde</strong> de cada contacto que le
          escribe. Por defecto captura nombre, teléfono, email y resumen; los campos que agregues
          acá aparecen como <em>Datos del contacto</em> en la ficha del contacto.
        </p>
      </div>

      {loading ? (
        <div className="text-muted-foreground py-8">Cargando…</div>
      ) : (
        <>
          <LeadFieldsEditor
            initialHints={content}
            originalHints={original}
            onSave={save}
            saving={saving}
          />
          {msg && (
            <div className="mt-4 text-sm text-muted-foreground" role="status">
              {msg}
            </div>
          )}
        </>
      )}
    </div>
  )
}
