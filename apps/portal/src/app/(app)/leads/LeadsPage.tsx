'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Users, MessageSquare, TrendingUp, Clock, AlertCircle, Trash2, RotateCcw, Sparkles } from 'lucide-react'
import { formatFieldLabel } from './_utils'

interface Lead {
  id: string
  name?: string
  email?: string
  phone?: string
  interest?: string
  temperature: 'frio' | 'tibio' | 'caliente'
  column: 'frio' | 'tibio' | 'caliente' | 'descartado'
  platform?: string
  urgency?: string
  summary?: string
  last_message?: string
  raw_fields?: Record<string, string>
  created_at: string
  updated_at?: string
  manual_override?: boolean
}

interface Stats {
  total: number
  today: number
  by_column: { frio: number; tibio: number; caliente: number; descartado: number }
}

const COLUMNS = ['frio', 'tibio', 'caliente', 'descartado'] as const

export default function LeadsPage() {
  const searchParams = useSearchParams()
  const slugFromUrl = searchParams.get('slug') || ''

  const [leads, setLeads] = useState<Lead[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const dragCounterRef = useRef<Record<string, number>>({})

  // The slug is resolved by the API from the active_tenant cookie when
  // ?slug= is absent. Deep links still work by passing the slug explicitly.
  const slugQuery = slugFromUrl ? `?slug=${encodeURIComponent(slugFromUrl)}` : ''
  const slugSuffix = slugFromUrl ? `&slug=${encodeURIComponent(slugFromUrl)}` : ''

  const loadLeads = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [leadsRes, statsRes] = await Promise.all([
        fetch(`/api/leads${slugQuery}`),
        fetch(`/api/stats${slugQuery}`),
      ])
      if (!leadsRes.ok) {
        if (leadsRes.status === 403) {
          setError('No tenés acceso a este perfil')
        } else {
          throw new Error('No se pudieron cargar los leads')
        }
      }
      if (leadsRes.ok) setLeads(await leadsRes.json())
      else setLeads([])
      if (statsRes.ok) setStats(await statsRes.json())
      else setStats(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
      setLeads([])
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [slugQuery])

  useEffect(() => {
    loadLeads()
  }, [loadLeads])

  const getLeadsByColumn = (column: string) =>
    leads.filter((l) => l.column === column)

  const getTemperatureColor = (temp: string) => {
    switch (temp) {
      case 'caliente': return 'bg-red-500'
      case 'tibio': return 'bg-amber-500'
      case 'frio': return 'bg-blue-500'
      default: return 'bg-gray-400'
    }
  }

  const getTemperatureBadge = (temp: string) => {
    switch (temp) {
      case 'caliente': return 'destructive' as const
      case 'tibio': return 'secondary' as const
      case 'frio': return 'outline' as const
      default: return 'outline' as const
    }
  }

  const getUrgencyIcon = (urgency?: string) => {
    if (urgency === 'high') return <AlertCircle className="h-3 w-3 text-destructive" />
    return null
  }

  const moveLeadToColumn = async (leadId: string, column: string) => {
    try {
      const res = await fetch(`/api/leads/${leadId}${slugQuery}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column }),
      })
      if (res.ok) {
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId
              ? { ...l, column: column as Lead['column'], manual_override: true }
              : l
          )
        )
        setStats((prev) => {
          if (!prev) return prev
          const oldLead = leads.find((l) => l.id === leadId)
          if (!oldLead) return prev
          const byCol = { ...prev.by_column }
          byCol[oldLead.column as keyof typeof byCol]--
          byCol[column as keyof typeof byCol]++
          return { ...prev, by_column: byCol }
        })
      }
    } catch (e) {
      console.error('Error moviendo lead:', e)
    }
  }

  const unlockLead = async (leadId: string) => {
    if (!confirm('¿Dejar que el LLM vuelva a clasificar este lead en el próximo mensaje?')) return
    try {
      const res = await fetch(`/api/leads/${leadId}/unlock${slugQuery}`, {
        method: 'POST',
      })
      if (res.ok) {
        setLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, manual_override: false } : l))
        )
      }
    } catch (e) {
      console.error('Error desbloqueando lead:', e)
    }
  }

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    setDraggedLeadId(leadId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', leadId)
  }

  const handleDragEnd = () => {
    setDraggedLeadId(null)
    setDragOverColumn(null)
    dragCounterRef.current = {}
  }

  const handleDragEnterColumn = (e: React.DragEvent, column: string) => {
    e.preventDefault()
    dragCounterRef.current[column] = (dragCounterRef.current[column] || 0) + 1
    setDragOverColumn(column)
  }

  const handleDragLeaveColumn = (e: React.DragEvent, column: string) => {
    dragCounterRef.current[column] = (dragCounterRef.current[column] || 0) - 1
    if (dragCounterRef.current[column] <= 0) {
      dragCounterRef.current[column] = 0
      setDragOverColumn((prev) => (prev === column ? null : prev))
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDropOnColumn = (e: React.DragEvent, targetColumn: string) => {
    e.preventDefault()
    const leadId = e.dataTransfer.getData('text/plain')
    if (!leadId) return
    const lead = leads.find((l) => l.id === leadId)
    if (lead && lead.column !== targetColumn) {
      moveLeadToColumn(leadId, targetColumn)
    }
    setDraggedLeadId(null)
    setDragOverColumn(null)
    dragCounterRef.current = {}
  }

  const formatRelativeTime = (dateStr: string) => {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 60) return `hace ${diffMin}m`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `hace ${diffH}h`
    const diffD = Math.floor(diffH / 24)
    return `hace ${diffD}d`
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Contactos</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Personas que conversaron con el bot. Arrastralas entre columnas para
          clasificarlas según su interés.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-muted rounded w-1/3 mb-3" />
                <div className="h-3 bg-muted rounded w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? null : (
        <>
          {/* Stats cards */}
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.total}</p>
                      <p className="text-xs text-muted-foreground">Total contactos</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                      <Clock className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.today}</p>
                      <p className="text-xs text-muted-foreground">Hoy</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-500/10 rounded-lg">
                      <TrendingUp className="h-4 w-4 text-red-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.by_column.caliente}</p>
                      <p className="text-xs text-muted-foreground">Calientes</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-500/10 rounded-lg">
                      <MessageSquare className="h-4 w-4 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.by_column.tibio}</p>
                      <p className="text-xs text-muted-foreground">Tibios</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-400/10 rounded-lg">
                      <Trash2 className="h-4 w-4 text-gray-400" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.by_column.descartado}</p>
                      <p className="text-xs text-muted-foreground">Descartados</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Kanban columns */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {COLUMNS.map((column) => {
              const isOver = dragOverColumn === column
              return (
                <div
                  key={column}
                  className={`space-y-3 rounded-lg p-2 transition-colors min-h-[200px] ${
                    isOver ? 'bg-primary/5 ring-2 ring-primary/30' : ''
                  }`}
                  onDragEnter={(e) => handleDragEnterColumn(e, column)}
                  onDragLeave={(e) => handleDragLeaveColumn(e, column)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDropOnColumn(e, column)}
                >
                  <div className="flex items-center gap-2 px-1">
                    <span className={`h-2.5 w-2.5 rounded-full ${column === 'descartado' ? 'bg-gray-400' : getTemperatureColor(column)}`} />
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {column === 'frio' ? 'Frío' : column === 'tibio' ? 'Tibio' : column === 'caliente' ? 'Caliente' : 'Descartados'}
                    </h2>
                    <Badge variant="outline" className="ml-auto text-xs">
                      {getLeadsByColumn(column).length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {getLeadsByColumn(column).map((lead) => {
                      const isDragging = draggedLeadId === lead.id
                      return (
                        <div
                          key={lead.id}
                          className={`group ${isDragging ? 'opacity-40' : ''}`}
                          draggable
                          onDragStart={(e) => handleDragStart(e, lead.id)}
                          onDragEnd={handleDragEnd}
                        >
                          <Link href={`/leads/${lead.id}${slugQuery ? `?${slugQuery.slice(1)}` : ''}`}>
                            <Card className={`hover:shadow-md transition-shadow cursor-pointer ${column === 'descartado' ? 'opacity-60' : ''}`}>
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between mb-2 gap-2">
                                  <h3 className="font-medium text-sm group-hover:text-primary transition-colors flex items-center gap-1.5 min-w-0">
                                    <span className="truncate">{lead.name || 'Sin nombre'}</span>
                                    {lead.manual_override && (
                                      <span
                                        title="Lo moviste manualmente — el LLM no va a recategorizar este lead hasta que lo desbloquees."
                                        className="inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap"
                                      >
                                        Manual
                                      </span>
                                    )}
                                  </h3>
                                  <div className="flex items-center gap-1">
                                    {getUrgencyIcon(lead.urgency)}
                                    <button
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        moveLeadToColumn(lead.id, column === 'descartado' ? 'frio' : 'descartado')
                                      }}
                                      className={`p-1 rounded-md transition-colors ${
                                        column === 'descartado'
                                          ? 'hover:bg-primary/10 text-muted-foreground hover:text-primary'
                                          : 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
                                      }`}
                                      title={column === 'descartado' ? 'Restaurar lead' : 'Descartar lead'}
                                    >
                                      {column === 'descartado' ? (
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                      )}
                                    </button>
                                  </div>
                                </div>

                                {lead.raw_fields && Object.entries(lead.raw_fields).slice(0, 3).map(([key, val]) => (
                                  <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                                    <span className="font-medium">{formatFieldLabel(key)}:</span> {val}
                                  </div>
                                ))}

                                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                                  {lead.summary || lead.last_message || 'Sin resumen'}
                                </p>

                                <Separator className="mb-2" />

                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <Badge variant={getTemperatureBadge(lead.temperature)} className="text-[10px] px-1.5 py-0">
                                      {lead.temperature}
                                    </Badge>
                                    {lead.platform && (
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                        {lead.platform}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {lead.manual_override && (
                                      <button
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          unlockLead(lead.id)
                                        }}
                                        title="Volver a clasificación automática (el LLM decidirá en el próximo mensaje)"
                                        className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                                      >
                                        <Sparkles className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    <span className="text-[10px] text-muted-foreground">
                                      {lead.created_at ? formatRelativeTime(lead.created_at) : ''}
                                    </span>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          </Link>
                        </div>
                      )
                    })}
                    {getLeadsByColumn(column).length === 0 && (
                      <Card className="border-dashed">
                        <CardContent className="py-8 text-center">
                          <p className="text-sm text-muted-foreground">
                            {column === 'descartado' ? 'Sin descartados' : 'Sin contactos'}
                          </p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
