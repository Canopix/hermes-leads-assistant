'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  SearchableCombobox,
  type ComboboxOption,
} from '@/components/catalog/searchable-combobox'

type Vertical = 'autos' | 'inmobiliaria'

interface FormState {
  title: string
  sku: string
  status: string
  price_amount: string
  price_currency: string
  price_kind: string
  summary: string
  description: string
  attrs: Record<string, string>
}

const EMPTY_AUTOS: FormState = {
  title: '',
  sku: '',
  status: 'available',
  price_amount: '',
  price_currency: 'ARS',
  price_kind: 'from',
  summary: '',
  description: '',
  attrs: {
    marca: '',
    modelo: '',
    version: '',
    anio: String(new Date().getFullYear()),
    km: '0',
    condicion: '0km',
    combustible: '',
    transmision: '',
    equipamiento: '',
    ideal_para: '',
  },
}

const EMPTY_INMO: FormState = {
  title: '',
  sku: '',
  status: 'available',
  price_amount: '',
  price_currency: 'USD',
  price_kind: 'fixed',
  summary: '',
  description: '',
  attrs: {
    tipo: 'depto',
    operacion: 'venta',
    ambientes: '2',
    m2: '',
    barrio: '',
    ciudad: '',
    amenities: '',
  },
}

function fieldClass() {
  return 'border rounded-md px-3 py-1.5 text-sm w-full'
}

function suggestTitle(attrs: Record<string, string>): string {
  const parts = [attrs.marca, attrs.modelo, attrs.version, attrs.anio].filter(
    (p) => p && String(p).trim()
  )
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export default function CatalogItemPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const slug = searchParams.get('slug') || ''
  const slugQuery = slug ? `?slug=${encodeURIComponent(slug)}` : ''
  const rawId = String(params.id || '')
  const isNew = rawId === 'new'

  const [vertical, setVertical] = useState<Vertical>('autos')
  const [form, setForm] = useState<FormState>(EMPTY_AUTOS)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)

  const [brands, setBrands] = useState<ComboboxOption[]>([])
  const [brandsLoading, setBrandsLoading] = useState(false)
  const [brandId, setBrandId] = useState<number | null>(null)
  const [models, setModels] = useState<ComboboxOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelId, setModelId] = useState<number | null>(null)
  const [versions, setVersions] = useState<ComboboxOption[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [acaraError, setAcaraError] = useState('')
  const [dataSource, setDataSource] = useState<'local' | 'acara' | ''>('')

  const setAttr = (key: string, value: string) => {
    setForm((f) => {
      const attrs = { ...f.attrs, [key]: value }
      const next = { ...f, attrs }
      if (!titleTouched && vertical === 'autos') {
        const suggested = suggestTitle(attrs)
        if (suggested) next.title = suggested
      }
      return next
    })
  }

  const loadMeta = useCallback(async () => {
    const paramsQs = new URLSearchParams()
    if (slug) paramsQs.set('slug', slug)
    paramsQs.set('limit', '1')
    const res = await fetch(`/api/config/catalog?${paramsQs}`)
    const data = await res.json()
    const v = (data.vertical || 'autos') as Vertical
    setVertical(v)
    if (isNew) {
      setForm(v === 'inmobiliaria' ? EMPTY_INMO : EMPTY_AUTOS)
    }
    return v
  }, [slug, isNew])

  useEffect(() => {
    if (vertical !== 'autos') return
    let cancelled = false
    setBrandsLoading(true)
    setAcaraError('')
    const qs = slug ? `?slug=${encodeURIComponent(slug)}` : ''
    fetch(`/api/config/catalog/acara/brands${qs}`)
      .then(async (r) => {
        const data = await r.json()
        if (cancelled) return
        if (!r.ok) {
          setAcaraError(data.error || 'ACARA no disponible')
          setBrands([])
          return
        }
        setBrands(
          (data.brands || []).map((b: { id: number; name: string }) => ({
            id: b.id,
            label: b.name,
          }))
        )
        if (data.source === 'local' || data.source === 'acara') {
          setDataSource(data.source)
        }
      })
      .catch(() => {
        if (!cancelled) setAcaraError('No se pudo conectar con ACARA')
      })
      .finally(() => {
        if (!cancelled) setBrandsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [vertical, slug])

  useEffect(() => {
    if (vertical !== 'autos' || brands.length === 0) return
    const marca = form.attrs.marca?.trim()
    if (!marca) {
      setBrandId(null)
      return
    }
    const hit = brands.find(
      (b) => b.label.toLowerCase() === marca.toLowerCase()
    )
    setBrandId(hit ? Number(hit.id) : null)
  }, [brands, form.attrs.marca, vertical])

  useEffect(() => {
    if (vertical !== 'autos' || !brandId) {
      setModels([])
      setModelId(null)
      setVersions([])
      return
    }
    let cancelled = false
    setModelsLoading(true)
    const q = new URLSearchParams({ brandId: String(brandId) })
    if (slug) q.set('slug', slug)
    fetch(`/api/config/catalog/acara/models?${q}`)
      .then(async (r) => {
        const data = await r.json()
        if (cancelled) return
        const opts = (data.models || []).map(
          (m: { id: number; name: string }) => ({
            id: m.id,
            label: m.name,
          })
        )
        setModels(opts)
        const modelo = form.attrs.modelo?.trim()
        if (modelo) {
          const hit = opts.find(
            (m: ComboboxOption) =>
              String(m.label).toLowerCase() === modelo.toLowerCase()
          )
          setModelId(hit ? Number(hit.id) : null)
        } else {
          setModelId(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModels([])
          setModelId(null)
        }
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // intentionally not depending on form.attrs.modelo — resolved when models arrive / marca changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, slug, vertical])

  // Keep modelId in sync when modelo text changes
  useEffect(() => {
    if (!models.length) return
    const modelo = form.attrs.modelo?.trim()
    if (!modelo) {
      setModelId(null)
      return
    }
    const hit = models.find(
      (m) => m.label.toLowerCase() === modelo.toLowerCase()
    )
    setModelId(hit ? Number(hit.id) : null)
  }, [form.attrs.modelo, models])

  // Load versions when modelId known
  useEffect(() => {
    if (vertical !== 'autos' || !brandId || !modelId) {
      setVersions([])
      return
    }
    let cancelled = false
    setVersionsLoading(true)
    const q = new URLSearchParams({
      brandId: String(brandId),
      modelId: String(modelId),
    })
    if (slug) q.set('slug', slug)
    fetch(`/api/config/catalog/acara/versions?${q}`)
      .then(async (r) => {
        const data = await r.json()
        if (cancelled) return
        setVersions(
          (data.versions || []).map((v: { id: number; name: string }) => ({
            id: v.id,
            label: v.name,
          }))
        )
      })
      .catch(() => {
        if (!cancelled) setVersions([])
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [brandId, modelId, slug, vertical])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const v = await loadMeta()
      if (cancelled || isNew) {
        if (!cancelled) setLoading(false)
        return
      }
      const res = await fetch(`/api/config/catalog/${rawId}${slugQuery}`)
      const data = await res.json()
      if (cancelled) return
      if (!data.item) {
        setMsg(data.error || 'No encontrado')
        setLoading(false)
        return
      }
      const item = data.item
      const base = v === 'inmobiliaria' ? EMPTY_INMO : EMPTY_AUTOS
      setTitleTouched(true)
      setForm({
        title: item.title || '',
        sku: item.sku || '',
        status: item.status || 'available',
        price_amount:
          item.price_amount === null || item.price_amount === undefined
            ? ''
            : String(item.price_amount),
        price_currency: item.price_currency || base.price_currency,
        price_kind: item.price_kind || base.price_kind,
        summary: item.summary || '',
        description: item.description || '',
        attrs: {
          ...base.attrs,
          ...Object.fromEntries(
            Object.entries(item.attrs || {}).map(([k, val]) => [
              k,
              String(val ?? ''),
            ])
          ),
        },
      })
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [isNew, rawId, slugQuery, loadMeta])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    const attrs: Record<string, unknown> = { ...form.attrs }
    if (vertical === 'autos') {
      attrs.anio = Number(form.attrs.anio)
      attrs.km = Number(form.attrs.km)
    } else {
      attrs.ambientes = Number(form.attrs.ambientes)
      if (form.attrs.m2) attrs.m2 = Number(form.attrs.m2)
      else delete attrs.m2
    }

    const payload = {
      title: form.title,
      sku: form.sku || null,
      status: form.status,
      price_amount:
        form.price_kind === 'on_request' || form.price_amount === ''
          ? null
          : Number(form.price_amount),
      price_currency: form.price_currency,
      price_kind: form.price_kind,
      summary: form.summary,
      description: form.description,
      attrs,
    }

    try {
      const url = isNew
        ? `/api/config/catalog${slugQuery}`
        : `/api/config/catalog/${rawId}${slugQuery}`
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.ok) {
        setMsg(data.error || 'Error al guardar')
        setSaving(false)
        return
      }
      router.push(`/config/catalog${slugQuery}`)
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'Error')
      setSaving(false)
    }
  }

  const marcaHelper = useMemo(() => {
    if (acaraError) {
      return `${acaraError}. Podés escribir la marca a mano.`
    }
    if (dataSource === 'local') {
      return 'Catálogo local (ACARA). Si no aparece, escribí una nueva.'
    }
    if (dataSource === 'acara') {
      return 'Lista en vivo de ACARA (sin JSON local). Si no aparece, escribí una nueva.'
    }
    return 'Lista de la Guía Oficial ACARA. Si no aparece, escribí una nueva.'
  }, [acaraError, dataSource])

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/config/catalog${slugQuery}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Inventario
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">{isNew ? 'Nueva ficha' : 'Editar ficha'}</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Título</span>
          <input
            required
            className={fieldClass()}
            value={form.title}
            onChange={(e) => {
              setTitleTouched(true)
              setForm({ ...form, title: e.target.value })
            }}
            placeholder={
              vertical === 'autos'
                ? 'Toyota Corolla 1.8 XEI 2021'
                : 'Depto 2 ambientes Palermo'
            }
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Estado</span>
            <select
              className={fieldClass()}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="available">Disponible</option>
              <option value="reserved">Reservado</option>
              <option value="sold">Vendido</option>
              <option value="draft">Borrador</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">SKU (opcional)</span>
            <input
              className={fieldClass()}
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Tipo de precio</span>
            <select
              className={fieldClass()}
              value={form.price_kind}
              onChange={(e) => setForm({ ...form, price_kind: e.target.value })}
            >
              <option value="fixed">Precio fijo</option>
              <option value="from">Desde</option>
              <option value="on_request">A consultar</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Monto</span>
            <input
              type="number"
              className={fieldClass()}
              value={form.price_amount}
              disabled={form.price_kind === 'on_request'}
              onChange={(e) => setForm({ ...form, price_amount: e.target.value })}
              required={form.price_kind !== 'on_request'}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Moneda</span>
            <input
              className={fieldClass()}
              value={form.price_currency}
              onChange={(e) => setForm({ ...form, price_currency: e.target.value })}
            />
          </label>
        </div>

        {vertical === 'autos' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SearchableCombobox
              label="Marca"
              required
              value={form.attrs.marca}
              options={brands}
              loading={brandsLoading}
              placeholder="Buscar marca (ACARA)…"
              helperText={marcaHelper}
              onChange={(value) => {
                setForm((f) => {
                  const attrs = {
                    ...f.attrs,
                    marca: value,
                    modelo: '',
                    version: '',
                  }
                  const next = { ...f, attrs }
                  if (!titleTouched) {
                    const suggested = suggestTitle(attrs)
                    if (suggested) next.title = suggested
                  }
                  return next
                })
              }}
            />
            <SearchableCombobox
              label="Modelo"
              required
              value={form.attrs.modelo}
              options={models}
              loading={modelsLoading}
              disabled={!form.attrs.marca}
              placeholder={
                form.attrs.marca
                  ? brandId
                    ? 'Buscar modelo…'
                    : 'Escribí el modelo'
                  : 'Elegí marca primero'
              }
              helperText={
                brandId
                  ? 'Si no está en la lista, usá «nuevo».'
                  : form.attrs.marca
                    ? 'Marca personalizada: escribí el modelo libremente.'
                    : undefined
              }
              emptyHint={
                brandId ? 'Sin modelos para esta marca' : 'Escribí un modelo nuevo'
              }
              onChange={(value) => {
                setForm((f) => {
                  const attrs = { ...f.attrs, modelo: value, version: '' }
                  const next = { ...f, attrs }
                  if (!titleTouched) {
                    const suggested = suggestTitle(attrs)
                    if (suggested) next.title = suggested
                  }
                  return next
                })
              }}
            />
            <SearchableCombobox
              label="Versión"
              value={form.attrs.version}
              options={versions}
              loading={versionsLoading}
              disabled={!form.attrs.modelo}
              placeholder={
                form.attrs.modelo
                  ? modelId
                    ? 'Buscar versión…'
                    : 'Escribí la versión'
                  : 'Elegí modelo primero'
              }
              helperText={
                modelId
                  ? 'Versiones ACARA. Si no está, usá «nuevo».'
                  : form.attrs.modelo
                    ? 'Modelo personalizado: escribí la versión libremente.'
                    : undefined
              }
              emptyHint={
                modelId
                  ? 'Sin versiones listadas — podés escribir una'
                  : 'Escribí una versión'
              }
              onChange={(value) => setAttr('version', value)}
            />
            <label className="block space-y-1">
              <span className="text-xs font-medium">Condición</span>
              <select
                className={fieldClass()}
                value={form.attrs.condicion}
                onChange={(e) => setAttr('condicion', e.target.value)}
              >
                <option value="0km">0 km</option>
                <option value="usado">Usado</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Año</span>
              <input
                type="number"
                required
                className={fieldClass()}
                value={form.attrs.anio}
                onChange={(e) => setAttr('anio', e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Kilómetros</span>
              <input
                type="number"
                required
                className={fieldClass()}
                value={form.attrs.km}
                onChange={(e) => setAttr('km', e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Combustible</span>
              <input
                className={fieldClass()}
                value={form.attrs.combustible}
                onChange={(e) => setAttr('combustible', e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Transmisión</span>
              <input
                className={fieldClass()}
                value={form.attrs.transmision}
                onChange={(e) => setAttr('transmision', e.target.value)}
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium">Equipamiento</span>
              <textarea
                className={fieldClass()}
                rows={2}
                value={form.attrs.equipamiento}
                onChange={(e) => setAttr('equipamiento', e.target.value)}
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium">Ideal para</span>
              <input
                className={fieldClass()}
                value={form.attrs.ideal_para}
                onChange={(e) => setAttr('ideal_para', e.target.value)}
              />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium">Tipo</span>
              <select
                className={fieldClass()}
                value={form.attrs.tipo}
                onChange={(e) => setAttr('tipo', e.target.value)}
              >
                <option value="depto">Depto</option>
                <option value="casa">Casa</option>
                <option value="ph">PH</option>
                <option value="local">Local</option>
                <option value="terreno">Terreno</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Operación</span>
              <select
                className={fieldClass()}
                value={form.attrs.operacion}
                onChange={(e) => setAttr('operacion', e.target.value)}
              >
                <option value="venta">Venta</option>
                <option value="alquiler">Alquiler</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Ambientes</span>
              <input
                type="number"
                required
                className={fieldClass()}
                value={form.attrs.ambientes}
                onChange={(e) => setAttr('ambientes', e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">m²</span>
              <input
                type="number"
                className={fieldClass()}
                value={form.attrs.m2}
                onChange={(e) => setAttr('m2', e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Barrio</span>
              <input
                required
                className={fieldClass()}
                value={form.attrs.barrio}
                onChange={(e) => setAttr('barrio', e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Ciudad</span>
              <input
                required
                className={fieldClass()}
                value={form.attrs.ciudad}
                onChange={(e) => setAttr('ciudad', e.target.value)}
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium">Amenities</span>
              <input
                className={fieldClass()}
                value={form.attrs.amenities}
                onChange={(e) => setAttr('amenities', e.target.value)}
              />
            </label>
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-xs font-medium">Resumen (1 línea)</span>
          <input
            className={fieldClass()}
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium">Descripción</span>
          <textarea
            className={fieldClass()}
            rows={4}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>

        {msg && (
          <p className="text-sm text-destructive" role="alert">
            {msg}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <Link
            href={`/config/catalog${slugQuery}`}
            className="px-4 py-1.5 border rounded-md text-sm"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  )
}
