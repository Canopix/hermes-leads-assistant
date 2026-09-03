'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface CatalogItem {
  id: string
  title: string
  status: string
  price_amount: number | null
  price_currency: string
  price_kind: string
  summary: string
  sku: string | null
  attrs: Record<string, unknown>
  updated_at: string
}

type SortKey = 'updated_at' | 'title' | 'price_amount' | 'status'
type Order = 'asc' | 'desc'

const STATUS_LABEL: Record<string, string> = {
  available: 'Disponible',
  reserved: 'Reservado',
  sold: 'Vendido',
  draft: 'Borrador',
}

const STATUS_STYLE: Record<string, string> = {
  available: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  reserved: 'bg-amber-50 text-amber-800 border-amber-200',
  sold: 'bg-slate-100 text-slate-600 border-slate-200',
  draft: 'bg-sky-50 text-sky-800 border-sky-200',
}

const PAGE_SIZES = [25, 50, 100]

function formatPrice(item: CatalogItem): string {
  if (item.price_kind === 'on_request' || item.price_amount === null) {
    return 'A consultar'
  }
  const n = `$${item.price_amount.toLocaleString('es-AR')}`
  if (item.price_kind === 'from') return `Desde ${n}`
  return n
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function SortIcon({
  active,
  order,
}: {
  active: boolean
  order: Order
}) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
  return order === 'asc' ? (
    <ArrowUp className="h-3.5 w-3.5" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5" />
  )
}

export default function CatalogPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const slug = searchParams.get('slug') || ''
  const slugQuery = slug ? `?slug=${encodeURIComponent(slug)}` : ''

  const [items, setItems] = useState<CatalogItem[]>([])
  const [vertical, setVertical] = useState<'autos' | 'inmobiliaria'>('autos')
  const [total, setTotal] = useState(0)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [marcas, setMarcas] = useState<string[]>([])
  const [barrios, setBarrios] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  const [q, setQ] = useState('')
  const debouncedQ = useDebounced(q, 300)
  const [status, setStatus] = useState('')
  const [marca, setMarca] = useState('')
  const [condicion, setCondicion] = useState('')
  const [barrio, setBarrio] = useState('')
  const [tipo, setTipo] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [sort, setSort] = useState<SortKey>('updated_at')
  const [order, setOrder] = useState<Order>('desc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (slug) params.set('slug', slug)
    if (status) params.set('status', status)
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim())
    if (marca) params.set('marca', marca)
    if (condicion) params.set('condicion', condicion)
    if (barrio) params.set('barrio', barrio)
    if (tipo) params.set('tipo', tipo)
    if (priceMin) params.set('price_min', priceMin)
    if (priceMax) params.set('price_max', priceMax)
    params.set('sort', sort)
    params.set('order', order)
    params.set('limit', String(pageSize))
    params.set('offset', String(page * pageSize))

    fetch(`/api/config/catalog?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || [])
        setVertical(data.vertical === 'inmobiliaria' ? 'inmobiliaria' : 'autos')
        setTotal(data.total || 0)
        setStatusCounts(data.status_counts || {})
        setMarcas(data.filter_options?.marcas || [])
        setBarrios(data.filter_options?.barrios || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [
    slug,
    status,
    debouncedQ,
    marca,
    condicion,
    barrio,
    tipo,
    priceMin,
    priceMax,
    sort,
    order,
    page,
    pageSize,
  ])

  useEffect(() => {
    load()
  }, [load])

  // Reset to first page when filters change
  useEffect(() => {
    setPage(0)
  }, [
    debouncedQ,
    status,
    marca,
    condicion,
    barrio,
    tipo,
    priceMin,
    priceMax,
    pageSize,
  ])

  const totalAll = useMemo(
    () => Object.values(statusCounts).reduce((a, b) => a + b, 0),
    [statusCounts]
  )

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)

  const hasFilters = Boolean(
    q || status || marca || condicion || barrio || tipo || priceMin || priceMax
  )

  const clearFilters = () => {
    setQ('')
    setStatus('')
    setMarca('')
    setCondicion('')
    setBarrio('')
    setTipo('')
    setPriceMin('')
    setPriceMax('')
    setPage(0)
  }

  const toggleSort = (key: SortKey) => {
    if (sort === key) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(key)
      setOrder(key === 'title' ? 'asc' : 'desc')
    }
  }

  const remove = async (id: string, title: string) => {
    if (!confirm(`Eliminar “${title}”?`)) return
    setMsg('')
    try {
      const res = await fetch(`/api/config/catalog/${id}${slugQuery}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (data.ok) {
        setMsg('Eliminado. El bot ya tiene el catálogo actualizado.')
        load()
      } else {
        setMsg(data.error || 'Error al eliminar')
      }
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Error')
    }
  }

  const verticalLabel = vertical === 'inmobiliaria' ? 'Inmobiliaria' : 'Autos'

  const thBtn = (key: SortKey, label: string, align: 'left' | 'right' = 'left') => (
    <th className={cn('p-0', align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn(
          'inline-flex w-full items-center gap-1.5 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground',
          align === 'right' && 'justify-end'
        )}
      >
        {label}
        <SortIcon active={sort === key} order={order} />
      </button>
    </th>
  )

  return (
    <div className="p-6 md:p-8 max-w-[1400px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link href="/config" className="hover:text-foreground">
              Configuración
            </Link>
            <span>/</span>
            <span className="text-foreground">Inventario</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {verticalLabel}
            {totalAll > 0 ? ` · ${totalAll.toLocaleString('es-AR')} fichas en total` : null}
            . El bot usa estos datos para cotizar sin inventar precios.
          </p>
        </div>
        <Button asChild className="shrink-0">
          <Link href={`/config/catalog/new${slugQuery}`}>
            <Plus className="h-4 w-4" />
            Nueva ficha
          </Link>
        </Button>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => setStatus('')}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            !status
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background hover:bg-muted'
          )}
        >
          Todos {totalAll > 0 ? `(${totalAll})` : ''}
        </button>
        {(['available', 'reserved', 'sold', 'draft'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(status === s ? '' : s)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              status === s
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background hover:bg-muted'
            )}
          >
            {STATUS_LABEL[s]} ({statusCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* Filters toolbar */}
      <div className="rounded-lg border bg-card p-3 mb-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={
                vertical === 'autos'
                  ? 'Buscar título, marca, modelo, SKU…'
                  : 'Buscar título, barrio, SKU…'
              }
              className="pl-9 h-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {vertical === 'autos' ? (
            <>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={marca}
                onChange={(e) => setMarca(e.target.value)}
              >
                <option value="">Todas las marcas</option>
                {marcas.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={condicion}
                onChange={(e) => setCondicion(e.target.value)}
              >
                <option value="">0 km y usados</option>
                <option value="0km">Solo 0 km</option>
                <option value="usado">Solo usados</option>
              </select>
            </>
          ) : (
            <>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={barrio}
                onChange={(e) => setBarrio(e.target.value)}
              >
                <option value="">Todos los barrios</option>
                {barrios.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
              >
                <option value="">Todos los tipos</option>
                <option value="depto">Depto</option>
                <option value="casa">Casa</option>
                <option value="ph">PH</option>
                <option value="local">Local</option>
                <option value="terreno">Terreno</option>
              </select>
            </>
          )}

          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              inputMode="numeric"
              placeholder="Precio min"
              className="h-9 w-[7.5rem]"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
            />
            <span className="text-muted-foreground text-xs">–</span>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="Precio max"
              className="h-9 w-[7.5rem]"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
            />
          </div>

          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="shrink-0"
            >
              <X className="h-4 w-4" />
              Limpiar
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {loading
              ? 'Buscando…'
              : total === 0
                ? hasFilters
                  ? 'Ningún resultado con estos filtros'
                  : 'Sin fichas todavía'
                : `Mostrando ${from.toLocaleString('es-AR')}–${to.toLocaleString('es-AR')} de ${total.toLocaleString('es-AR')}`}
          </span>
          <label className="inline-flex items-center gap-2">
            Filas
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {msg && (
        <p className="text-sm text-muted-foreground mb-3" role="status">
          {msg}
        </p>
      )}

      <div className="border rounded-lg overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                {thBtn('title', 'Título')}
                {vertical === 'autos' ? (
                  <>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Marca / modelo
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Año
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Km
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Condición
                    </th>
                  </>
                ) : (
                  <>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Tipo
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Barrio
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Amb.
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Operación
                    </th>
                  </>
                )}
                {thBtn('price_amount', 'Precio', 'right')}
                {thBtn('status', 'Estado')}
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground w-[7rem]">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t hover:bg-muted/40 cursor-pointer group"
                    onClick={() =>
                      router.push(`/config/catalog/${item.id}${slugQuery}`)
                    }
                  >
                    <td className="px-3 py-2.5 max-w-[18rem]">
                      <div className="font-medium truncate group-hover:text-primary">
                        {item.title}
                      </div>
                      {item.sku ? (
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                          {item.sku}
                        </div>
                      ) : null}
                    </td>
                    {vertical === 'autos' ? (
                      <>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {[item.attrs.marca, item.attrs.modelo]
                            .filter(Boolean)
                            .join(' ')}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {item.attrs.anio !== null && item.attrs.anio !== undefined
                            ? String(item.attrs.anio)
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                          {item.attrs.km !== null && item.attrs.km !== undefined
                            ? Number(item.attrs.km).toLocaleString('es-AR')
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          {item.attrs.condicion === '0km'
                            ? '0 km'
                            : item.attrs.condicion === 'usado'
                              ? 'Usado'
                              : '—'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 capitalize">
                          {item.attrs.tipo ? String(item.attrs.tipo) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {item.attrs.barrio ? String(item.attrs.barrio) : '—'}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {item.attrs.ambientes !== null && item.attrs.ambientes !== undefined
                            ? String(item.attrs.ambientes)
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 capitalize">
                          {item.attrs.operacion
                            ? String(item.attrs.operacion)
                            : '—'}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-medium">
                      {formatPrice(item)}
                      {item.price_amount !== null && item.price_amount !== undefined ? (
                        <span className="text-muted-foreground font-normal text-xs ml-1">
                          {item.price_currency}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium',
                          STATUS_STYLE[item.status] || STATUS_STYLE.draft
                        )}
                      >
                        {STATUS_LABEL[item.status] || item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/config/catalog/${item.id}${slugQuery}`}>
                            Editar
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(item.id, item.title)}
                          aria-label={`Eliminar ${item.title}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {loading && (
          <p className="p-8 text-center text-sm text-muted-foreground">Cargando…</p>
        )}

        {!loading && items.length === 0 && (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {hasFilters
                ? 'No hay resultados. Probá limpiar los filtros.'
                : 'Todavía no hay fichas. Creá la primera para que el bot pueda cotizar.'}
            </p>
            {hasFilters ? (
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href={`/config/catalog/new${slugQuery}`}>
                  <Plus className="h-4 w-4" />
                  Nueva ficha
                </Link>
              </Button>
            )}
          </div>
        )}

        {!loading && total > 0 && (
          <div className="flex items-center justify-between gap-3 border-t px-3 py-2.5 bg-muted/20">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              Página {page + 1} de {pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-4">
        FAQs y políticas van en{' '}
        <Link href={`/config/knowledge${slugQuery}`} className="underline hover:text-foreground">
          Documentos
        </Link>
        .
      </p>
    </div>
  )
}
