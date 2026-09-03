'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { SoulWizard } from '@/components/soul/soul-wizard'

export default function SoulEditor() {
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
    fetch(`/api/config/soul${slugQuery}`)
      .then((r) => r.json())
      .then((data) => {
        setContent(data.content || '')
        setOriginal(data.content || '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slugQuery])

  const save = async (nextContent: string) => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`/api/config/soul${slugQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: nextContent }),
      })
      const data = await res.json()
      if (data.ok) {
        setContent(nextContent)
        setOriginal(nextContent)
        setMsg('Guardado. El cambio aplica al reiniciar el gateway.')
        setTimeout(() => setMsg(''), 4000)
      } else {
        setMsg('Error: ' + (data.error || 'unknown'))
      }
    } catch (e: any) {
      setMsg('Error: ' + e.message)
    }
    setSaving(false)
  }

  const [restarting, setRestarting] = useState(false)
  const restart = async () => {
    if (!confirm('Reiniciar el gateway ahora? El bot estará offline unos segundos.')) return
    setRestarting(true)
    setMsg('')
    try {
      const res = await fetch(`/api/config/ops${slugQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'restart' }),
      })
      const data = await res.json()
      if (data.ok) {
        setMsg('Gateway reiniciado.')
      } else {
        setMsg('No se pudo reiniciar: ' + (data.output || 'error'))
      }
    } catch (e: any) {
      setMsg('Error: ' + e.message)
    }
    setRestarting(false)
    setTimeout(() => setMsg(''), 4000)
  }

  const dirty = content !== original

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-2">
        <Link href="/config" className="text-sm text-muted-foreground hover:text-foreground">
          Configuración
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Personalidad del bot</h1>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Se guarda en <code className="px-1 py-0.5 rounded bg-muted">SOUL.md</code>. Define cómo
        habla el bot, qué rol cumple y qué no debe hacer.
      </p>

      <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-2 leading-relaxed mb-6">
        <p>
          <strong>Aplica al reiniciar el gateway.</strong> Después de guardar, el bot queda offline
          ~5 segundos mientras vuelve a leer el archivo.
        </p>
      </div>

      {loading ? (
        <div className="text-muted-foreground py-8">Cargando...</div>
      ) : (
        <>
          <SoulWizard
            initialMd={content}
            originalMd={original}
            onSave={save}
            saving={saving}
          />

          <div className="flex items-center gap-4 mt-6 flex-wrap">
            <button
              onClick={restart}
              disabled={restarting || dirty}
              className="px-4 py-2 border rounded-md text-sm font-medium disabled:opacity-50"
              title={dirty ? 'Guardá antes de reiniciar' : 'Reiniciar el gateway ahora'}
            >
              {restarting ? 'Reiniciando…' : 'Reiniciar gateway'}
            </button>
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </>
      )}
    </div>
  )
}
