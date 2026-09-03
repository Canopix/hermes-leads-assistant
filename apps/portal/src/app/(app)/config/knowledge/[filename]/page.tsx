'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useParams } from 'next/navigation'
import Link from 'next/link'
import { MarkdownEditor } from '@/components/ui/markdown-editor'

export default function KnowledgeFileEditor() {
  const searchParams = useSearchParams()
  const params = useParams()
  const slug = searchParams.get('slug') || ''
  const slugQuery = slug ? `?slug=${encodeURIComponent(slug)}` : ''
  const filename = params.filename as string
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!filename) return
    setLoading(true)
    fetch(`/api/config/knowledge/${filename}${slugQuery}`)
      .then((r) => r.json())
      .then((data) => {
        setContent(data.content || '')
        setOriginal(data.content || '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slugQuery, filename])

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`/api/config/knowledge/${filename}${slugQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      if (data.ok) {
        setOriginal(content)
        setMsg('Guardado. Reindexá el RAG para que los cambios estén activos.')
        setTimeout(() => setMsg(''), 5000)
      } else {
        setMsg('Error: ' + (data.error || 'unknown'))
      }
    } catch (e: any) {
      setMsg('Error: ' + e.message)
    }
    setSaving(false)
  }

  const [reindexing, setReindexing] = useState(false)
  const reindex = async () => {
    if (!confirm('Reindexar el RAG ahora? Puede tardar unos segundos.')) return
    setReindexing(true)
    setMsg('')
    try {
      const res = await fetch(`/api/config/ops${slugQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'reindex' }),
      })
      const data = await res.json()
      setMsg(data.ok ? 'RAG reindexado.' : 'No se pudo reindexar: ' + (data.output || 'error'))
    } catch (e: any) {
      setMsg('Error: ' + e.message)
    }
    setReindexing(false)
    setTimeout(() => setMsg(''), 4000)
  }

  const dirty = content !== original

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/config" className="text-sm text-muted-foreground hover:text-foreground">
          Configuración
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link href="/config/knowledge" className="text-sm text-muted-foreground hover:text-foreground">
          Documentos
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">{filename}</h1>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Edita este archivo de la base de conocimiento. El RAG se actualiza al
        reindexar (botón dedicado abajo).
      </p>

      {loading ? (
        <div className="text-muted-foreground py-8">Cargando...</div>
      ) : (
        <>
          <MarkdownEditor value={content} onChange={setContent} height="500px" />

          <div className="flex items-center gap-4 mt-4">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              onClick={reindex}
              disabled={reindexing || dirty}
              className="px-4 py-2 border rounded-md text-sm font-medium disabled:opacity-50"
              title={dirty ? 'Guardá antes de reindexar' : 'Reindexar el RAG ahora'}
            >
              {reindexing ? 'Reindexando…' : 'Reindexar RAG'}
            </button>
            <Link
              href="/config/knowledge"
              className="px-4 py-2 border rounded-md text-sm font-medium hover:bg-muted"
            >
              Volver
            </Link>
            {dirty && <span className="text-sm text-orange-600">Hay cambios sin guardar</span>}
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </>
      )}
    </div>
  )
}
