'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface KFile {
  name: string
  size: number
  modified: string
}

export default function KnowledgePage() {
  const searchParams = useSearchParams()
  const slug = searchParams.get('slug') || ''
  const slugQuery = slug ? `?slug=${encodeURIComponent(slug)}` : ''
  const [files, setFiles] = useState<KFile[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState('')

  const loadFiles = useCallback(() => {
    setLoading(true)
    fetch(`/api/config/knowledge${slugQuery}`)
      .then((r) => r.json())
      .then((data) => {
        setFiles(data.files || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slugQuery])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const createFile = async () => {
    if (!newName.endsWith('.md')) setNewName(newName + '.md')
    const name = newName.endsWith('.md') ? newName : `${newName}.md`
    setCreating(true)
    setMsg('')
    try {
      const res = await fetch(`/api/config/knowledge${slugQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: name, content: `# ${name.replace('.md', '')}\n\n` }),
      })
      const data = await res.json()
      if (data.ok) {
        setNewName('')
        setMsg('Archivo creado. Reindexá el RAG para que esté activo.')
        loadFiles()
        setTimeout(() => setMsg(''), 5000)
      } else {
        setMsg('Error: ' + (data.error || 'unknown'))
      }
    } catch (e: any) {
      setMsg('Error: ' + e.message)
    }
    setCreating(false)
  }

  const deleteFile = async (name: string) => {
    if (!confirm(`Eliminar ${name}?`)) return
    try {
      const res = await fetch(`/api/config/knowledge/${name}${slugQuery}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (data.ok) {
        setMsg('Eliminado. Reindexá el RAG para reflejar el cambio.')
        loadFiles()
        setTimeout(() => setMsg(''), 5000)
      }
    } catch {}
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-2">
        <Link href="/config" className="text-sm text-muted-foreground hover:text-foreground">
          Configuración
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Documentos y FAQs</h1>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Textos y políticas en Markdown. El inventario (autos / propiedades) se carga en Inventario.
      </p>

      <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-2 leading-relaxed mb-6">
        <p>
          Subí acá <strong>FAQ, políticas, cómo trabajan y promociones</strong>. El bot los usa
          como contexto narrativo.
        </p>
        <p className="text-muted-foreground">
          Para stock y precios exactos usá{' '}
          <Link href={`/config/catalog${slugQuery}`} className="underline">
            Inventario
          </Link>
          . Formato Markdown (
          <code className="px-1 py-0.5 rounded bg-muted">.md</code>
          ); después de editar, reindexá el RAG.
        </p>
      </div>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="ej: precios.md o catalogo-autos.md"
          className="border rounded-md px-3 py-1.5 text-sm flex-1 max-w-xs"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createFile()}
        />
        <button
          onClick={createFile}
          disabled={creating || !newName.trim()}
          className="px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
        >
          {creating ? 'Creando…' : 'Nuevo archivo'}
        </button>
      </div>

      {msg && <div className="text-sm text-muted-foreground mb-4">{msg}</div>}

      {loading ? (
        <div className="text-muted-foreground py-8">Cargando…</div>
      ) : files.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          Todavía no subiste documentos. El bot va a responder solo con lo que sabe de fábrica.
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {files.map((f) => (
            <div key={f.name} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
              <Link
                href={`/config/knowledge/${f.name}${slugQuery}`}
                className="flex-1"
              >
                <span className="font-medium text-sm">{f.name}</span>
                <span className="text-xs text-muted-foreground ml-3">
                  {(f.size / 1024).toFixed(1)} KB
                </span>
              </Link>
              <div className="flex items-center gap-2">
                <Link
                  href={`/config/knowledge/${f.name}${slugQuery}`}
                  className="text-xs text-primary hover:underline"
                >
                  Editar
                </Link>
                <button
                  onClick={() => deleteFile(f.name)}
                  className="text-xs text-destructive hover:underline"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
