'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface DashboardData {
  stats: {
    total: number
    today: number
    byColumn: { frio: number; tibio: number; caliente: number; descartado: number }
    conversionRate: number
  }
  activity: { date: string; count: number }[]
  hotLeads: {
    id: string
    name: string
    interest: string
    column: string
    created_at: string
  }[]
  botStatus: 'online' | 'offline'
}

export default function DashboardPage() {
  const searchParams = useSearchParams()
  const slug = searchParams.get('slug') || ''
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // The slug is optional: the API resolves it from the active_tenant
    // cookie when ?slug= is absent. Deep links still work.
    const url = slug ? `/api/dashboard?slug=${slug}` : `/api/dashboard`
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('fetch failed')
        return r.json()
      })
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slug])

  const maxActivity = data ? Math.max(...data.activity.map((a) => a.count), 1) : 1

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Vista general de tu negocio</p>
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Cargando...</div>
      ) : !data ? (
        <div className="text-center py-16 text-muted-foreground">Error al cargar datos</div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">Total Leads</div>
              <div className="text-3xl font-bold mt-1">{data.stats.total}</div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">Hoy</div>
              <div className="text-3xl font-bold mt-1">{data.stats.today}</div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">Conversion</div>
              <div className="text-3xl font-bold mt-1">{data.stats.conversionRate}%</div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">Bot</div>
              <div className="flex items-center gap-2 mt-1">
                <div
                  className={`h-3 w-3 rounded-full ${
                    data.botStatus === 'online' ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <span className="text-lg font-medium capitalize">{data.botStatus}</span>
              </div>
            </div>
          </div>

          {/* Temperature breakdown */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="border rounded-lg p-4 bg-blue-500/5">
              <div className="text-sm text-muted-foreground">Frio</div>
              <div className="text-2xl font-bold mt-1">{data.stats.byColumn.frio}</div>
            </div>
            <div className="border rounded-lg p-4 bg-yellow-500/5">
              <div className="text-sm text-muted-foreground">Tibio</div>
              <div className="text-2xl font-bold mt-1">{data.stats.byColumn.tibio}</div>
            </div>
            <div className="border rounded-lg p-4 bg-red-500/5">
              <div className="text-sm text-muted-foreground">Caliente</div>
              <div className="text-2xl font-bold mt-1">{data.stats.byColumn.caliente}</div>
            </div>
            <div className="border rounded-lg p-4 bg-gray-400/5">
              <div className="text-sm text-muted-foreground">Descartados</div>
              <div className="text-2xl font-bold mt-1">{data.stats.byColumn.descartado}</div>
            </div>
          </div>

          {/* Activity chart */}
          <div className="border rounded-lg p-6 mb-8">
            <h2 className="font-semibold mb-4">Actividad ultimos 7 dias</h2>
            <div className="flex items-end gap-2 h-32">
              {data.activity.map((a) => (
                <div key={a.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-muted-foreground">{a.count}</span>
                  <div
                    className="w-full bg-primary/20 rounded-t"
                    style={{ height: `${(a.count / maxActivity) * 100}%`, minHeight: a.count > 0 ? '4px' : '0' }}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(a.date).toLocaleDateString('es-AR', { weekday: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Hot leads */}
          <div className="border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Leads Calientes</h2>
              <Link href="/leads" className="text-sm text-primary hover:underline">
                Ver todos
              </Link>
            </div>
            {data.hotLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay leads calientes</p>
            ) : (
              <div className="space-y-3">
                {data.hotLeads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="block border rounded-md p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">
                        {lead.name || 'Sin nombre'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(lead.created_at).toLocaleDateString('es-AR')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      {lead.interest}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
