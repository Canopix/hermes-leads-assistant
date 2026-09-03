'use client'

import Link from 'next/link'
import {
  Bot,
  FileText,
  FileCog,
  ClipboardList,
  MessageSquare,
  Store,
  Package,
  type LucideIcon,
} from 'lucide-react'

interface TabDef {
  id: string
  label: string
  technicalName?: string
  href: string
  desc: string
  icon: LucideIcon
  advanced?: boolean
}

const TABS: TabDef[] = [
  {
    id: 'soul',
    label: 'Personalidad del bot',
    technicalName: 'SOUL.md',
    href: '/config/soul',
    desc: 'Cómo habla el bot, qué rol cumple y qué no debe hacer. Asistente paso a paso.',
    icon: Bot,
  },
  {
    id: 'catalog',
    label: 'Inventario',
    technicalName: 'Catálogo',
    href: '/config/catalog',
    desc: 'Fichas de autos o propiedades con precio y datos exactos. Sin Markdown.',
    icon: Package,
  },
  {
    id: 'knowledge',
    label: 'Documentos y FAQs',
    technicalName: 'Knowledge Base',
    href: '/config/knowledge',
    desc: 'FAQs, políticas y cómo trabajan. El inventario va en Inventario.',
    icon: FileText,
  },
  {
    id: 'hints',
    label: 'Datos a capturar del lead',
    technicalName: 'extraction_hints',
    href: '/config/extraction-hints',
    desc: 'Elegí qué info querés guardar de cada lead: presupuesto, forma de pago, plazo, etc.',
    icon: ClipboardList,
  },
  {
    id: 'business',
    label: 'Datos del negocio',
    href: '/config/business',
    desc: 'Nombre visible, horarios de atención, mensajes automáticos y límites de uso.',
    icon: Store,
  },
  {
    id: 'platforms',
    label: 'Canales',
    href: '/config/platforms',
    desc: 'Conectá el bot con Telegram, WhatsApp u otros canales de mensajería.',
    icon: MessageSquare,
  },
  {
    id: 'settings',
    label: 'Configuración avanzada',
    technicalName: 'config.yaml',
    href: '/config/settings',
    desc: 'Editar el config.yaml crudo. Solo si sabés lo que estás haciendo.',
    icon: FileCog,
    advanced: true,
  },
]

export default function ConfigPage() {
  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Editá el comportamiento del bot y la información de tu negocio.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className="block p-6 border rounded-lg hover:bg-accent transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">{tab.label}</h3>
                </div>
                {tab.advanced && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    Avanzado
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{tab.desc}</p>
              {tab.technicalName && (
                <p className="text-xs text-muted-foreground/70 mt-2 font-mono">
                  {tab.technicalName}
                </p>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
