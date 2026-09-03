'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { YamlEditor } from '@/components/ui/yaml-editor'

export default function SettingsEditor() {
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
    fetch(`/api/config/settings${slugQuery}`)
      .then((r) => r.json())
      .then((data) => {
        setContent(data.content || '')
        setOriginal(data.content || '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slugQuery])

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`/api/config/settings${slugQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      if (data.ok) {
        setOriginal(content)
        setMsg('Guardado. Los cambios se aplican en el proximo mensaje.')
        setTimeout(() => setMsg(''), 4000)
      } else {
        setMsg('Error: ' + (data.error || 'unknown'))
      }
    } catch (e: any) {
      setMsg('Error: ' + e.message)
    }
    setSaving(false)
  }

  const dirty = content !== original

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-2">
        <Link href="/config" className="text-sm text-muted-foreground hover:text-foreground">
          Configuración
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Configuración avanzada</h1>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Editás el archivo <code className="px-1 py-0.5 rounded bg-muted">config.yaml</code> crudo del
        perfil. Aplica en el próximo mensaje del bot (no requiere restart).
      </p>

      <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-4 text-sm space-y-2 leading-relaxed mb-4">
        <p className="font-medium text-yellow-900 dark:text-yellow-100">
          Acá editás el config.yaml crudo.
        </p>
        <p className="text-yellow-900/90 dark:text-yellow-100/90">
          Si rompés la sintaxis YAML, el gateway no arranca. Si no estás seguro de qué cambiás,{' '}
          <strong>usá las otras páginas de Configuración</strong> — escriben el mismo archivo por
          atrás, con validación.
        </p>
      </div>

      {loading ? (
        <div className="text-muted-foreground py-8">Cargando…</div>
      ) : (
        <>
          <YamlEditor value={content} onChange={setContent} height="500px" />

          <div className="flex items-center gap-4 mt-4">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            {dirty && <span className="text-sm text-orange-600">Hay cambios sin guardar</span>}
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </>
      )}
    </div>
  )
}
