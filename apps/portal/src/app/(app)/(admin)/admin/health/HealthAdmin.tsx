"use client";

import { useCallback, useEffect, useState } from "react";

interface ProfileHealth {
  slug: string;
  profile: string;
  name: string;
  status: string;
  channels: string[];
  lead_count: number;
  gateway_online: boolean;
  gateway_pid: number | null;
  gateway_state: string | null;
  gateway_source: "runtime_status" | "pid_file" | "none";
  has_kb: boolean;
  db_size_bytes: number | null;
}

interface HealthSummary {
  system_status: "ok" | "degraded" | "down";
  total_tenants: number;
  active_tenants: number;
  suspended_tenants: number;
  gateways_online: number;
  gateways_down: number;
  total_leads: number;
  sentry_active: boolean;
}

function formatBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_STYLES: Record<HealthSummary["system_status"], { color: string; label: string }> = {
  ok: { color: "text-green-600", label: "Sistemas operativos" },
  degraded: { color: "text-yellow-600", label: "Degradado" },
  down: { color: "text-red-600", label: "Caído" },
};

export function HealthAdmin() {
  const [profiles, setProfiles] = useState<ProfileHealth[]>([]);
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/health");
      if (!r.ok) throw new Error("No se pudo cargar el estado");
      const data = await r.json();
      setProfiles(data.profiles);
      setSummary(data.summary);
      setGeneratedAt(data.generated_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && profiles.length === 0) {
    return <div className="p-8">Cargando…</div>;
  }
  if (error) {
    return <div className="p-8 text-destructive">{error}</div>;
  }

  const statusStyle = summary ? STATUS_STYLES[summary.system_status] : null;

  return (
    <div className="p-8 max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Salud del sistema</h1>
        <div className="text-xs text-muted-foreground">
          {generatedAt
            ? `Actualizado: ${new Date(generatedAt).toLocaleTimeString("es-AR")}`
            : ""}
        </div>
      </div>

      {summary && statusStyle && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border rounded-lg p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Estado
            </div>
            <div className={`text-lg font-bold ${statusStyle.color}`}>
              {statusStyle.label}
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Gateways
            </div>
            <div className="text-lg font-bold tabular-nums">
              <span className="text-green-600">{summary.gateways_online}</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-red-600">{summary.gateways_down}</span>
              <span className="text-xs text-muted-foreground ml-1">up/down</span>
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Tenants
            </div>
            <div className="text-lg font-bold tabular-nums">
              {summary.active_tenants}
              <span className="text-muted-foreground text-xs ml-1">
                activos · {summary.suspended_tenants} susp.
              </span>
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Observabilidad
            </div>
            <div className="text-lg font-bold">
              {summary.sentry_active ? (
                <span className="text-green-600">Sentry ON</span>
              ) : (
                <span className="text-muted-foreground">Sentry OFF</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left p-3">Tenant</th>
              <th className="text-left p-3">Estado</th>
              <th className="text-left p-3">Gateway</th>
              <th className="text-right p-3">Leads</th>
              <th className="text-right p-3">DB</th>
              <th className="text-left p-3">KB</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.slug} className="border-t">
                <td className="p-3">
                  <div className="font-medium">{p.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {p.slug}
                  </div>
                </td>
                <td className="p-3">{p.status}</td>
                <td className="p-3">
                  <span
                    className={
                      p.gateway_online
                        ? "text-green-600 font-medium"
                        : "text-red-600 font-medium"
                    }
                  >
                    {p.gateway_online ? "online" : "offline"}
                  </span>
                  {p.gateway_state && (
                    <span className="text-xs text-muted-foreground ml-1">
                      · {p.gateway_state}
                    </span>
                  )}
                  {p.gateway_pid !== null && (
                    <span className="text-xs text-muted-foreground ml-1">
                      (pid {p.gateway_pid})
                    </span>
                  )}
                  {p.gateway_source === "pid_file" && (
                    <span
                      className="ml-1 text-[10px] uppercase tracking-wider text-yellow-600"
                      title="No se encontró gateway_state.json; verificado por PID file legacy."
                    >
                      pid
                    </span>
                  )}
                </td>
                <td className="p-3 text-right tabular-nums">{p.lead_count}</td>
                <td className="p-3 text-right tabular-nums text-muted-foreground">
                  {formatBytes(p.db_size_bytes)}
                </td>
                <td className="p-3">
                  {p.has_kb ? (
                    <span className="text-green-600">sí</span>
                  ) : (
                    <span className="text-yellow-600">vacía</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {profiles.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Sin perfiles en disco todavía.
          </p>
        )}
      </div>
    </div>
  );
}
