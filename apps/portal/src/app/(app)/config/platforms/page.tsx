'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Field, inputCls } from '@/components/ui/field'

interface PlatformConfig {
  telegram: { enabled: boolean; bot_token: string; webhook_url: string }
  kapso: { enabled: boolean; api_key: string }
}

const TELEGRAM_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/

export default function PlatformsConfigPage() {
  const searchParams = useSearchParams()
  const slug = searchParams.get('slug') || ''
  const slugQuery = slug ? `?slug=${encodeURIComponent(slug)}` : ''
  const [config, setConfig] = useState<PlatformConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/config/platforms${slugQuery}`)
      .then((r) => r.json())
      .then((d) => {
        setConfig(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slugQuery])

  const save = async () => {
    if (!config) return
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`/api/config/platforms${slugQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.ok) {
        setMsg('Guardado. Si cambiaste un token, reiniciá el gateway.')
        setTimeout(() => setMsg(''), 4000)
      } else {
        setMsg('Error: ' + (data.error || 'unknown'))
      }
    } catch (e: any) {
      setMsg('Error: ' + e.message)
    }
    setSaving(false)
  }

  const tokenTieneMalFormato =
    config && config.telegram.enabled && config.telegram.bot_token.length > 0
      ? !TELEGRAM_TOKEN_RE.test(config.telegram.bot_token)
      : false

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Link href="/config" className="text-sm text-muted-foreground hover:text-foreground">
          Configuración
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Canales</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Conectá el bot con tus canales de mensajería. Solo responden los canales que estén activos.
      </p>

      {loading ? (
        <div className="text-muted-foreground py-8">Cargando…</div>
      ) : !config ? (
        <div className="text-muted-foreground py-8">Error al cargar</div>
      ) : (
        <div className="space-y-6">
          {/* Telegram */}
          <section className="border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-lg">Telegram</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  El bot responde mensajes privados en Telegram cuando está activo.
                </p>
              </div>
              <span
                className={
                  'inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ' +
                  (config.telegram.enabled
                    ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                    : 'bg-muted text-muted-foreground')
                }
              >
                <span
                  className={
                    'inline-block h-1.5 w-1.5 rounded-full ' +
                    (config.telegram.enabled ? 'bg-green-500' : 'bg-muted-foreground/50')
                  }
                />
                {config.telegram.enabled ? 'Activo' : 'Inactivo'}
              </span>
            </div>

            <div className="space-y-4">
              <Field
                label="Activar Telegram"
                hint="Cuando está activo, el bot recibe y responde mensajes en este canal."
              >
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.telegram.enabled}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        telegram: { ...config.telegram, enabled: e.target.checked },
                      })
                    }
                    className="h-4 w-4"
                  />
                  <span className="text-sm">
                    {config.telegram.enabled ? 'Bot escuchando Telegram' : 'Bot pausado en Telegram'}
                  </span>
                </label>
              </Field>

              <Field
                label="Bot Token"
                hint="Lo conseguís hablando con @BotFather en Telegram (mensaje /newbot)."
              >
                <input
                  type="password"
                  value={config.telegram.bot_token}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      telegram: { ...config.telegram, bot_token: e.target.value },
                    })
                  }
                  placeholder="123456789:ABC-DEF1234ghIkl-zyx57W2v4u8aoR15"
                  className={inputCls + ' font-mono'}
                />
              </Field>

              {tokenTieneMalFormato && (
                <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm text-yellow-900 dark:text-yellow-100">
                  El token no parece válido. El formato esperado es{' '}
                  <code className="px-1 py-0.5 rounded bg-muted">números:letras_y_símbolos</code>.
                  Revisá copiar/pegar de @BotFather.
                </div>
              )}

              <Field
                label="Webhook URL"
                hint="Solo tocar si sabés que tu dominio cambió. Es la URL pública a la que Telegram envía los mensajes."
              >
                <input
                  type="text"
                  value={config.telegram.webhook_url}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      telegram: { ...config.telegram, webhook_url: e.target.value },
                    })
                  }
                  placeholder="https://tu-dominio.com/webhook/telegram"
                  className={inputCls}
                />
              </Field>
            </div>
          </section>

          {/* Kapso (WhatsApp) */}
          <section className="border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-lg">WhatsApp (Kapso)</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Conectá WhatsApp vía Kapso. El bot responde mensajes entrantes en este canal.
                </p>
              </div>
              <span
                className={
                  'inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ' +
                  (config.kapso.enabled
                    ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                    : 'bg-muted text-muted-foreground')
                }
              >
                <span
                  className={
                    'inline-block h-1.5 w-1.5 rounded-full ' +
                    (config.kapso.enabled ? 'bg-green-500' : 'bg-muted-foreground/50')
                  }
                />
                {config.kapso.enabled ? 'Activo' : 'Inactivo'}
              </span>
            </div>

            <div className="space-y-4">
              <Field
                label="Activar WhatsApp"
                hint="Cuando está activo, el bot recibe y responde mensajes en este canal."
              >
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.kapso.enabled}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        kapso: { ...config.kapso, enabled: e.target.checked },
                      })
                    }
                    className="h-4 w-4"
                  />
                  <span className="text-sm">
                    {config.kapso.enabled ? 'Bot escuchando WhatsApp' : 'Bot pausado en WhatsApp'}
                  </span>
                </label>
              </Field>

              <Field
                label="API Key de Kapso"
                hint="La conseguís desde el panel de Kapso. Sin este valor el canal no responde."
              >
                <input
                  type="password"
                  value={config.kapso.api_key}
                  onChange={(e) =>
                    setConfig({ ...config, kapso: { ...config.kapso, api_key: e.target.value } })
                  }
                  placeholder="kapso_xxxxxxxxxxxxxxxxxxxx"
                  className={inputCls + ' font-mono'}
                />
              </Field>
            </div>
          </section>

          {/* Guardar */}
          <div className="flex items-center gap-4">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
