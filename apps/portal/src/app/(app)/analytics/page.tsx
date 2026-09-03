'use client'

import { useEffect, useState } from 'react'

interface AnalyticsData {
  byDay: { date: string; frio: number; tibio: number; caliente: number; total: number }[]
  byPlatform: Record<string, number>
  topFields: { field: string; count: number }[]
  trend: { current: number; previous: number; change: number }
  urgencyCounts: { low: number; medium: number; high: number }
  totalInPeriod: number
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('7d')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // slug resolved by the API from the active_tenant cookie.
    fetch(`/api/analytics?period=${period}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [period])

  const maxDay = data ? Math.max(...data.byDay.map((d) => d.total), 1) : 1
  const maxPlatform = data ? Math.max(...Object.values(data.byPlatform), 1) : 1
  const maxField = data ? Math.max(...data.topFields.map((f) => f.count), 1) : 1

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Metricas detalladas de tu negocio</p>
        </div>
        <div className="flex border rounded-md overflow-hidden">
          {(['7d', '30d', '90d'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm ${
                period === p ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Cargando...</div>
      ) : !data ? (
        <div className="text-center py-16 text-muted-foreground">Error al cargar</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">Leads en periodo</div>
              <div className="text-3xl font-bold mt-1">{data.totalInPeriod}</div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">vs Periodo anterior</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-3xl font-bold">{data.trend.change > 0 ? '+' : ''}{data.trend.change}%</span>
              </div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">Plataformas activas</div>
              <div className="text-3xl font-bold mt-1">{Object.keys(data.byPlatform).length}</div>
            </div>
          </div>

          {/* Leads by day - stacked bar chart */}
          <div className="border rounded-lg p-6 mb-8">
            <h2 className="font-semibold mb-4">Leads por dia</h2>
            <div className="flex items-end gap-1 h-40">
              {data.byDay.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col" style={{ height: `${(d.total / maxDay) * 100}%`, minHeight: d.total > 0 ? '4px' : '0' }}>
                    {d.caliente > 0 && (
                      <div className="w-full bg-red-500 rounded-t" style={{ flex: d.caliente }} />
                    )}
                    {d.tibio > 0 && (
                      <div className="w-full bg-yellow-500" style={{ flex: d.tibio }} />
                    )}
                    {d.frio > 0 && (
                      <div className="w-full bg-blue-500 rounded-b" style={{ flex: d.frio }} />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(d.date).toLocaleDateString('es-AR', { day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><div className="h-2 w-2 rounded bg-blue-500" /> Frio</span>
              <span className="flex items-center gap-1"><div className="h-2 w-2 rounded bg-yellow-500" /> Tibio</span>
              <span className="flex items-center gap-1"><div className="h-2 w-2 rounded bg-red-500" /> Caliente</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* By platform */}
            <div className="border rounded-lg p-6">
              <h2 className="font-semibold mb-4">Por Plataforma</h2>
              {Object.entries(data.byPlatform).length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin datos</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(data.byPlatform)
                    .sort((a, b) => b[1] - a[1])
                    .map(([platform, count]) => (
                      <div key={platform}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="capitalize">{platform}</span>
                          <span className="text-muted-foreground">{count}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${(count / maxPlatform) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Top fields */}
            <div className="border rounded-lg p-6">
              <h2 className="font-semibold mb-4">Campos mas consultados</h2>
              {data.topFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin datos</p>
              ) : (
                <div className="space-y-3">
                  {data.topFields.map((f) => (
                    <div key={f.field}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{f.field}</span>
                        <span className="text-muted-foreground">{f.count}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${(f.count / maxField) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Urgency distribution */}
          <div className="border rounded-lg p-6 mt-6">
            <h2 className="font-semibold mb-4">Distribucion por Urgencia</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-green-500/5 rounded-lg">
                <div className="text-2xl font-bold">{data.urgencyCounts.low}</div>
                <div className="text-sm text-muted-foreground">Baja</div>
              </div>
              <div className="text-center p-4 bg-yellow-500/5 rounded-lg">
                <div className="text-2xl font-bold">{data.urgencyCounts.medium}</div>
                <div className="text-sm text-muted-foreground">Media</div>
              </div>
              <div className="text-center p-4 bg-red-500/5 rounded-lg">
                <div className="text-2xl font-bold">{data.urgencyCounts.high}</div>
                <div className="text-sm text-muted-foreground">Alta</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
