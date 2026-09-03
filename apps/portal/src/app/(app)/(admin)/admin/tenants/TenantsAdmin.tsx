"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Tenant {
  id: string;
  slug: string;
  name: string;
  hermes_profile: string;
  status: string;
  channels: string[];
  created_at: string;
}

/**
 * Copy-to-clipboard code block. Falls back to selecting the text if the
 * Clipboard API is unavailable (older browsers / insecure context).
 */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — user can still select-and-copy manually
    }
  }
  return (
    <div className="relative group">
      <pre className="bg-zinc-900 text-zinc-100 rounded-md p-3 text-xs overflow-x-auto font-mono">
        <code>{code}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 px-2 py-1 rounded bg-zinc-700 text-zinc-100 text-xs opacity-0 group-hover:opacity-100 transition"
        aria-label="Copiar"
      >
        {copied ? "Copiado ✓" : "Copiar"}
      </button>
    </div>
  );
}

export function TenantsAdmin() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/tenants");
      if (!r.ok) throw new Error("No se pudieron cargar los tenants");
      const data = (await r.json()) as { tenants: Tenant[] };
      setTenants(data.tenants);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(slug: string, status: "active" | "suspended" | "inactive") {
    const r = await fetch("/api/admin/tenants", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, status }),
    });
    if (r.ok) await load();
  }

  const wizardCmd = `# Opción recomendada — te guía paso a paso con menús interactivos
./packages/ops/setup-wizard.sh

# o, si querés invocar el Python directo:
python packages/ops/setup-wizard.py`;

  const cliWizard = `# 1. Registrá el tenant en el CLI
python cli/leadai.py tenants add \\
  --slug acme \\
  --name "Acme Corp" \\
  --channels telegram

# 2. Provisioná el perfil Hermes completo
#    (instala el perfil, escribe .env, habilita plugins, arranca el gateway)
bash packages/ops/provision-client.sh \\
  --slug acme \\
  --name "Acme Corp" \\
  --telegram-token "123:ABC..." \\
  --owner-telegram-id "123456789" \\
  --openai-api-key "sk-..." \\
  --mem0-key "$MEM0_API_KEY"

# 3. Asignate como miembro del tenant (para verlo en el portal)
#    Reemplazá TU_USER_ID con tu ID de la tabla user
sqlite3 ~/.hermes/portal/auth.sqlite \\
  "INSERT INTO tenant_members (user_id, tenant_id, role, created_at) \\
   SELECT 'TU_USER_ID', id, 'owner', datetime('now') \\
   FROM tenants WHERE slug='acme';"

# 4. Verificá que el bot está corriendo
hermes -p acme-leads gateway status`;

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Tenants</h1>

      <div className="bg-card border rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">¿Cómo crear un tenant?</h2>
            <p className="text-sm text-muted-foreground mt-1">
              El provisioning completo (perfil Hermes, plugins, RAG, gateway) se
              hace desde la consola del servidor.
            </p>
          </div>
          <button
            onClick={() => setShowWizard((v) => !v)}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            {showWizard ? "Ocultar pasos" : "Ver paso a paso"}
          </button>
        </div>

        {showWizard && (
          <div className="mt-4 space-y-6 text-sm">
            {/* Recommended: interactive wizard */}
            <div className="border-2 border-primary/40 rounded-md p-4 bg-primary/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-primary text-primary-foreground">
                  Recomendado
                </span>
                <h3 className="font-semibold">Wizard interactivo</h3>
              </div>
              <p className="text-muted-foreground mb-3">
                Te guía paso a paso con menús bonitos (Typer + Rich + questionary),
                valida los tokens, y arma todo: tenant, perfil Hermes, plugins,
                embeddings, gateway. Es la forma más simple — la usamos siempre.
              </p>
              <CodeBlock code={wizardCmd} />
              <p className="text-xs text-muted-foreground mt-2">
                Pedirá nombre del negocio, token de Telegram, owner ID, API key
                de OpenAI y opcionalmente Kapso / Mem0 / embeddings custom.
                Son 7 pasos y al final el bot queda funcionando.
              </p>
            </div>

            {/* Alternative: manual commands */}
            <details className="border rounded-md p-4">
              <summary className="cursor-pointer font-medium">
                Alternativa: comandos manuales (avanzado)
              </summary>
              <p className="text-muted-foreground mt-2 mb-3">
                Si preferís los comandos uno por uno o querés scriptear el
                provisioning:
              </p>
              <CodeBlock code={cliWizard} />

              <details className="border-l-2 border-muted pl-3 mt-3">
                <summary className="cursor-pointer text-xs font-medium">
                  Opciones del provision-client.sh
                </summary>
                <table className="w-full text-xs mt-3">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left p-2">Flag</th>
                      <th className="text-left p-2">Para qué</th>
                      <th className="text-left p-2">Requerido</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="p-2 font-mono">--slug, --name</td>
                      <td className="p-2">Identidad del tenant</td>
                      <td className="p-2 font-semibold">Sí</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2 font-mono">--telegram-token</td>
                      <td className="p-2">Bot de Telegram</td>
                      <td className="p-2">Si usás Telegram</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2 font-mono">--owner-telegram-id</td>
                      <td className="p-2">Quién puede usar /admin en el bot</td>
                      <td className="p-2">Recomendado</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2 font-mono">--openai-api-key</td>
                      <td className="p-2">LLM (o compatible)</td>
                      <td className="p-2 font-semibold">Sí</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2 font-mono">--model-provider, --model</td>
                      <td className="p-2">openai, openrouter, custom</td>
                      <td className="p-2">Default: openai</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2 font-mono">--mem0-key</td>
                      <td className="p-2">Memoria de largo plazo</td>
                      <td className="p-2">Opcional</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2 font-mono">--kapso-*</td>
                      <td className="p-2">WhatsApp</td>
                      <td className="p-2">Opcional</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2 font-mono">--client-knowledge PATH</td>
                      <td className="p-2">Importar KB inicial</td>
                      <td className="p-2">Opcional</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2 font-mono">--dry-run</td>
                      <td className="p-2">Ver qué haría sin ejecutar</td>
                      <td className="p-2">Útil para debug</td>
                    </tr>
                  </tbody>
                </table>
              </details>
            </details>

            <div className="bg-muted/30 border-l-4 border-primary p-3 text-xs">
              <strong>Después:</strong> recargá esta página. El tenant debería
              aparecer automáticamente con su status de gateway y conteo de
              leads. Si no aparece, fijate en{" "}
              <Link href="/admin/health" className="underline">
                /admin/health
              </Link>{" "}
              para ver el estado de cada perfil.
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive mb-4" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Slug</th>
                <th className="text-left p-3">Nombre</th>
                <th className="text-left p-3">Estado</th>
                <th className="text-left p-3">Canales</th>
                <th className="text-left p-3">Creado</th>
                <th className="text-left p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-3 font-mono">
                    <Link
                      href={`/admin/tenants/${t.slug}`}
                      className="underline hover:text-primary"
                    >
                      {t.slug}
                    </Link>
                  </td>
                  <td className="p-3">{t.name}</td>
                  <td className="p-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {t.channels.join(", ") || "—"}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(t.created_at).toLocaleDateString("es-AR")}
                  </td>
                  <td className="p-3 space-x-2">
                    {t.status === "active" ? (
                      <button
                        onClick={() => setStatus(t.slug, "suspended")}
                        className="text-xs underline hover:text-destructive"
                      >
                        Suspender
                      </button>
                    ) : (
                      <button
                        onClick={() => setStatus(t.slug, "active")}
                        className="text-xs underline hover:text-primary"
                      >
                        Activar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tenants.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Sin tenants todavía. Creá el primero con el wizard de arriba.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "active"
      ? "bg-green-100 text-green-800"
      : status === "suspended"
      ? "bg-yellow-100 text-yellow-800"
      : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${color}`}>
      {status}
    </span>
  );
}
