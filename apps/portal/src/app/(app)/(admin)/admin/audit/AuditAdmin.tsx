"use client";

import { useCallback, useEffect, useState } from "react";

interface AuditEntry {
  id: number;
  actor_email: string | null;
  tenant_id: string | null;
  action: string;
  target: string | null;
  payload: string | null;
  ip: string | null;
  created_at: string;
}

export function AuditAdmin() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (actionFilter) qs.set("action", actionFilter);
      qs.set("limit", "200");
      const r = await fetch(`/api/admin/audit?${qs.toString()}`);
      if (!r.ok) throw new Error("No se pudo cargar la auditoría");
      const data = (await r.json()) as { entries: AuditEntry[] };
      setEntries(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [actionFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Auditoría</h1>
        <input
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          placeholder="Filtrar por acción (ej: tenant., config., lead.)"
          className="border rounded-md px-3 py-1.5 text-sm bg-background w-72"
        />
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
                <th className="text-left p-3">Fecha</th>
                <th className="text-left p-3">Actor</th>
                <th className="text-left p-3">Acción</th>
                <th className="text-left p-3">Objetivo</th>
                <th className="text-left p-3">Tenant</th>
                <th className="text-left p-3">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString("es-AR")}
                  </td>
                  <td className="p-3 text-xs">{a.actor_email || "—"}</td>
                  <td className="p-3 font-mono text-xs">{a.action}</td>
                  <td className="p-3 font-mono text-xs">{a.target || "—"}</td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">
                    {a.tenant_id ? a.tenant_id.slice(0, 8) : "—"}
                  </td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">
                    {a.ip || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Sin eventos para el filtro actual.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
