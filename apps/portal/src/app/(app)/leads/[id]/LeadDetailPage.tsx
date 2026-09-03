'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft, AlertCircle,
  MessageSquare, Phone, Mail, Globe, Clock, Heart, FileText, Bot, User, ListOrdered,
  Trash2, RotateCcw
} from 'lucide-react'
import { formatFieldLabel } from '../_utils'

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_name?: string
  timestamp: number
}

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
  conversation?: ConversationMessage[]
}

export default function LeadDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = searchParams.get('slug') || ''
  // The slug is optional: the API resolves it from the active_tenant cookie
  // when ?slug= is absent. Deep links still work.
  const slugQuery = slug ? `?slug=${encodeURIComponent(slug)}` : ''
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    fetch(`/api/leads/${params.id}${slugQuery}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 403) {
            throw new Error('No tenés acceso a este contacto en el perfil actual')
          }
          throw new Error('Contacto no encontrado')
        }
        return res.json()
      })
      .then(setLead)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false))
  }, [params.id, slugQuery])

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-8 bg-muted rounded w-1/3" />
        <div className="h-4 bg-muted rounded w-2/3" />
        <div className="h-48 bg-muted rounded" />
      </div>
    )
  }

  if (error || !lead) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-lg font-medium">{error || 'Contacto no encontrado'}</p>
            <Link
              href="/leads"
              className="text-primary hover:underline text-sm mt-2 inline-block"
            >
              Volver a Contactos
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const getTemperatureBadge = (temp: string) => {
    switch (temp) {
      case 'caliente': return 'destructive' as const
      case 'tibio': return 'secondary' as const
      case 'frio': return 'outline' as const
      default: return 'outline' as const
    }
  }

  const getTemperatureLabel = (temp: string) => {
    switch (temp) {
      case 'caliente': return 'Caliente'
      case 'tibio': return 'Tibio'
      case 'frio': return 'Frío'
      default: return temp
    }
  }

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleString('es-AR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return d
    }
  }

  const moveLeadToColumn = async (targetColumn: string) => {
    if (!lead || moving) return
    setMoving(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}${slugQuery}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column: targetColumn }),
      })
      if (res.ok) {
        setLead((prev) => prev ? { ...prev, column: targetColumn as Lead['column'] } : prev)
      }
    } catch (e) {
      console.error('Error moviendo contacto:', e)
    } finally {
      setMoving(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a Contactos
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {lead.name || 'Sin nombre'}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge variant={getTemperatureBadge(lead.temperature)}>
              {getTemperatureLabel(lead.temperature)}
            </Badge>
            {lead.platform && (
              <Badge variant="outline">
                <Globe className="h-3 w-3 mr-1" />
                {lead.platform}
              </Badge>
            )}
            {lead.urgency && (
              <Badge variant={lead.urgency === 'high' ? 'destructive' : 'outline'}>
                urgencia: {lead.urgency}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {lead.summary && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Resumen del contacto
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{lead.summary}</p>
              </CardContent>
            </Card>
          )}

          {lead.interest && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Heart className="h-4 w-4" />
                  Interés expresado
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{lead.interest}</p>
              </CardContent>
            </Card>
          )}

          {/* Full Conversation */}
          {lead.conversation && lead.conversation.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Conversación completa
                  <Badge variant="outline" className="ml-auto text-xs">
                    {lead.conversation.length} mensajes
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                  {lead.conversation.map((msg, i) => (
                    <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                      {msg.role === 'user' && (
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div className={`max-w-[80%] ${msg.role === 'user' ? '' : ''}`}>
                        <div className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-muted'
                            : 'bg-primary text-primary-foreground'
                        }`}>
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                        <p className={`text-[10px] text-muted-foreground mt-1 ${msg.role === 'user' ? '' : 'text-right'}`}>
                          {msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </p>
                      </div>
                      {msg.role === 'assistant' && (
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                          <Bot className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {(!lead.conversation || lead.conversation.length === 0) && lead.last_message && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Último mensaje del contacto
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/50 rounded-lg p-4 text-sm leading-relaxed italic">
                  &ldquo;{lead.last_message}&rdquo;
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* Acciones */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Acciones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lead.column === 'descartado' ? (
                <button
                  onClick={() => moveLeadToColumn('frio')}
                  disabled={moving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Restaurar a Frío
                </button>
              ) : (
                <>
                  <button
                    onClick={() => moveLeadToColumn('descartado')}
                    disabled={moving}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-destructive/30 bg-destructive/5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  >
                  <Trash2 className="h-4 w-4" />
                  Descartar contacto
                  </button>
                  {lead.column !== 'caliente' && (
                    <button
                      onClick={() => moveLeadToColumn('caliente')}
                      disabled={moving}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
                    >
                      Marcar como Caliente
                    </button>
                  )}
                  {lead.column !== 'frio' && lead.column !== 'caliente' && (
                    <button
                      onClick={() => moveLeadToColumn('frio')}
                      disabled={moving}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
                    >
                      Mover a Frío
                    </button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow icon={<Phone className="h-4 w-4" />} label="Teléfono" value={lead.phone} />
              <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={lead.email} />
              <Separator />
              <InfoRow icon={<Clock className="h-4 w-4" />} label="Creado" value={lead.created_at ? formatDate(lead.created_at) : undefined} />
              <InfoRow icon={<Clock className="h-4 w-4" />} label="Actualizado" value={lead.updated_at ? formatDate(lead.updated_at) : undefined} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ListOrdered className="h-4 w-4" />
                Datos del contacto
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lead.raw_fields && Object.entries(lead.raw_fields).map(([key, val]) => (
                <InfoRow key={key} label={formatFieldLabel(key)} value={val} />
              ))}
              {(!lead.raw_fields || Object.keys(lead.raw_fields).length === 0) && (
                <p className="text-sm text-muted-foreground">Sin datos adicionales</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value }: { icon?: React.ReactNode; label: string; value?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      {icon && <span className="text-muted-foreground mt-0.5">{icon}</span>}
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value || '—'}</p>
      </div>
    </div>
  )
}
