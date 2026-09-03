"use client";

import { useCallback, useEffect, useState } from "react";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  created_at: string;
  member_of: number;
}

const ROLES = ["viewer", "admin", "owner", "super_admin"] as const;

export function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/users");
      if (!r.ok) throw new Error("No se pudieron cargar los usuarios");
      const data = (await r.json()) as { users: UserRow[] };
      setUsers(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(userId: string, email: string, role: string) {
    const r = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, role }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      alert(body.error || "No se pudo actualizar");
      return;
    }
    await load();
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Usuarios</h1>
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
                <th className="text-left p-3">Nombre</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Rol</th>
                <th className="text-left p-3">Tenants</th>
                <th className="text-left p-3">Creado</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="p-3">{u.name || "—"}</td>
                  <td className="p-3 font-mono text-xs">{u.email}</td>
                  <td className="p-3">
                    <select
                      value={u.role || "viewer"}
                      onChange={(e) => changeRole(u.id, u.email, e.target.value)}
                      className="border rounded px-2 py-1 text-xs bg-background"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">{u.member_of}</td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("es-AR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Sin usuarios todavía.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
