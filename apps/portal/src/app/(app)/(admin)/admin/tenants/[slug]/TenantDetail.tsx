"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Member {
  user_id: string;
  role: string;
  created_at: string;
  email: string;
  name: string | null;
}

interface EligibleUser {
  id: string;
  email: string;
  name: string | null;
}

interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  hermes_profile: string;
  status: string;
  channels: string[];
}

interface AuditEntry {
  id: number;
  actor_email: string | null;
  action: string;
  target: string | null;
  payload: string | null;
  created_at: string;
}

const MEMBER_ROLES: Array<{ value: "owner" | "admin" | "viewer"; label: string; hint: string }> = [
  {
    value: "owner",
    label: "Owner",
    hint: "Todo: leads, stats, config del bot (SOUL, knowledge, settings) y members",
  },
  {
    value: "admin",
    label: "Admin",
    hint: "Todo lo operativo: leads, stats, config del bot. NO puede gestionar members",
  },
  {
    value: "viewer",
    label: "Viewer",
    hint: "Solo lectura: ver leads, stats y dashboards. No edita config ni miembros",
  },
];

export function TenantDetail({ slug }: { slug: string }) {
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-member form state.
  const [allUsers, setAllUsers] = useState<EligibleUser[]>([]);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"owner" | "admin" | "viewer">("viewer");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addOk, setAddOk] = useState<string | null>(null);

  // Deprovision flow state.
  const [depStep, setDepStep] = useState<0 | 1 | 2>(0);
  const [depConfirm, setDepConfirm] = useState("");
  const [depKeepProfile, setDepKeepProfile] = useState(false);
  const [depBusy, setDepBusy] = useState(false);
  const [depResult, setDepResult] = useState<{
    archive_path: string | null;
    archive_password: string | null;
    wiped_profile: boolean;
    note?: string;
  } | null>(null);
  const [depError, setDepError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/tenants/${slug}`);
      if (!r.ok) throw new Error("No se pudo cargar el tenant");
      const data = await r.json();
      setTenant(data.tenant);
      setMembers(data.members);
      setAudit(data.recent_audit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const loadUsers = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/users");
      if (!r.ok) return;
      const data = (await r.json()) as { users: EligibleUser[] };
      setAllUsers(data.users);
    } catch {
      // non-fatal — the form just won't have suggestions
    }
  }, []);

  useEffect(() => {
    load();
    loadUsers();
  }, [load, loadUsers]);

  async function removeMember(userId: string) {
    if (!confirm("¿Quitar este usuario del tenant?")) return;
    const r = await fetch(`/api/admin/tenants/${slug}/members?user_id=${userId}`, {
      method: "DELETE",
    });
    if (r.ok) await load();
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setAddBusy(true);
    setAddError(null);
    setAddOk(null);
    try {
      const r = await fetch(`/api/admin/tenants/${slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: addUserId, role: addRole }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAddError(data.error || "No se pudo agregar el miembro");
        return;
      }
      const added = allUsers.find((u) => u.id === addUserId);
      setAddOk(
        added
          ? `${added.email} ahora es ${addRole} del tenant.`
          : "Miembro agregado."
      );
      setAddUserId("");
      setAddRole("viewer");
      await load();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Error");
    } finally {
      setAddBusy(false);
    }
  }

  async function deprovision() {
    setDepBusy(true);
    setDepError(null);
    try {
      const r = await fetch(`/api/admin/tenants/${slug}/deprovision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: depConfirm,
          keepProfile: depKeepProfile,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setDepError(data.error || "Error al desprovisionar");
        return;
      }
      setDepResult({
        archive_path: data.archive_path,
        archive_password: data.archive_password,
        wiped_profile: data.wiped_profile,
        note: data.note,
      });
      setDepStep(2);
      // Reload to reflect the suspended status.
      await load();
    } catch (e) {
      setDepError(e instanceof Error ? e.message : "Error");
    } finally {
      setDepBusy(false);
    }
  }

  if (loading) return <div className="p-8">Cargando…</div>;
  if (error) return <div className="p-8 text-destructive">{error}</div>;
  if (!tenant) return <div className="p-8">Tenant no encontrado</div>;

  const memberIds = new Set(members.map((m) => m.user_id));
  const eligibleUsers = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div className="p-8 max-w-5xl space-y-8">
      <div>
        <Link
          href="/admin/tenants"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Volver a tenants
        </Link>
        <h1 className="text-2xl font-bold mt-2">{tenant.name}</h1>
        <p className="text-sm text-muted-foreground font-mono">
          {tenant.slug} · {tenant.hermes_profile}
        </p>
      </div>

      <section>
        <h2 className="font-semibold mb-3">Miembros ({members.length})</h2>
        <div className="border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Usuario</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Rol</th>
                <th className="text-left p-3">Desde</th>
                <th className="text-left p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id} className="border-t">
                  <td className="p-3">{m.name || "—"}</td>
                  <td className="p-3 font-mono text-xs">{m.email}</td>
                  <td className="p-3">{m.role}</td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(m.created_at).toLocaleDateString("es-AR")}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => removeMember(m.user_id)}
                      className="text-xs underline hover:text-destructive"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {members.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Sin miembros todavía. Usá el formulario de abajo para asignar el
              primero.
            </p>
          )}
        </div>

        {/* Add member form */}
        <div className="mt-4 border rounded-lg p-4 bg-muted/20">
          <h3 className="text-sm font-semibold mb-1">Agregar miembro</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Este rol es <strong>solo para este tenant</strong> ({tenant.name}).
            Controla qué puede hacer la persona con los leads y la configuración
            de este bot. No le da permisos sobre otros tenants ni sobre el
            sistema — para eso usamos el rol global (&quot;super_admin&quot;) que se
            cambia desde <Link href="/admin/users" className="underline">/admin/users</Link>.
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            El usuario tiene que haberse registrado antes en <code>/signup</code>.
            Si no existe, compartile el link del portal.
          </p>

          {eligibleUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todos los usuarios registrados ya son miembros de este tenant.
              {allUsers.length === 0 && " (No se pudieron cargar usuarios.)"}
            </p>
          ) : (
            <form onSubmit={addMember} className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-end">
              <div className="space-y-1">
                <label htmlFor="add-user" className="text-xs font-medium">
                  Usuario
                </label>
                <select
                  id="add-user"
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  required
                  className="w-full border rounded px-2 py-2 text-sm bg-background"
                >
                  <option value="" disabled>
                    Seleccionar…
                  </option>
                  {eligibleUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                      {u.name ? ` — ${u.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="add-role" className="text-xs font-medium">
                  Rol
                </label>
                <select
                  id="add-role"
                  value={addRole}
                  onChange={(e) =>
                    setAddRole(e.target.value as "owner" | "admin" | "viewer")
                  }
                  className="border rounded px-2 py-2 text-sm bg-background"
                >
                  {MEMBER_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={addBusy || !addUserId}
                className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {addBusy ? "Agregando…" : "Agregar"}
              </button>

              {addError && (
                <p className="md:col-span-3 text-sm text-destructive" role="alert">
                  {addError}
                </p>
              )}
              {addOk && (
                <p className="md:col-span-3 text-sm text-green-700">{addOk}</p>
              )}
            </form>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              ¿Qué puede hacer cada rol dentro de este tenant?
            </summary>
            <ul className="mt-2 text-xs space-y-1 text-muted-foreground">
              {MEMBER_ROLES.map((r) => (
                <li key={r.value}>
                  <strong className="text-foreground">{r.label}</strong>: {r.hint}
                </li>
              ))}
              <li className="pt-2 border-t mt-2">
                <strong className="text-foreground">super_admin</strong> (rol
                global, no se asigna acá): acceso a <code>/admin/*</code>, ve
                todos los tenants, gestiona usuarios. Solo se otorga desde{" "}
                <Link href="/admin/users" className="underline">/admin/users</Link>.
              </li>
            </ul>
          </details>
        </div>
      </section>

      <section className="border-2 border-destructive/30 rounded-lg p-5 bg-destructive/5">
        <h2 className="font-semibold mb-2 text-destructive">
          Zona de peligro · Desprovisionar
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Detiene el bot, crea un backup encriptado (<code>tar.gz.enc</code>) y
          borra el perfil del disco. El tenant queda marcado{" "}
          <code>suspended</code> (no se elimina el registro ni el historial de
          auditoría). La contraseña del backup se muestra una sola vez.
        </p>

        {depStep === 0 && (
          <button
            onClick={() => setDepStep(1)}
            disabled={tenant.status === "suspended"}
            className="px-3 py-2 rounded bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50"
          >
            {tenant.status === "suspended"
              ? "Este tenant ya está suspendido"
              : "Desprovisionar tenant…"}
          </button>
        )}

        {depStep === 1 && (
          <div className="space-y-3">
            <p className="text-sm">
              Escribí el slug del tenant ({" "}
              <code className="font-mono bg-muted px-1 rounded">{tenant.slug}</code>{" "}
              ) para confirmar:
            </p>
            <input
              type="text"
              value={depConfirm}
              onChange={(e) => setDepConfirm(e.target.value)}
              placeholder={tenant.slug}
              className="px-3 py-2 border rounded font-mono w-full max-w-md"
              autoComplete="off"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={depKeepProfile}
                onChange={(e) => setDepKeepProfile(e.target.checked)}
              />
              Mantener el perfil en disco (solo archivar, sin borrar)
            </label>
            {depError && (
              <p className="text-sm text-destructive">{depError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={deprovision}
                disabled={depBusy || depConfirm !== tenant.slug}
                className="px-3 py-2 rounded bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50"
              >
                {depBusy ? "Desprovisionando…" : "Confirmar desprovisionamiento"}
              </button>
              <button
                onClick={() => {
                  setDepStep(0);
                  setDepConfirm("");
                  setDepError(null);
                }}
                disabled={depBusy}
                className="px-3 py-2 rounded border text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {depStep === 2 && depResult && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-green-700">
              Desprovisionamiento completo.
            </p>
            <div className="text-sm space-y-1">
              <div>
                <strong>Backup:</strong>{" "}
                <code className="font-mono bg-muted px-1 rounded">
                  {depResult.archive_path || "(sin backup — el perfil no existía)"}
                </code>
              </div>
              {depResult.archive_password && (
                <div>
                  <strong>Contraseña del backup (mostrada una sola vez):</strong>
                  <div className="mt-1 p-2 bg-yellow-50 border border-yellow-300 rounded font-mono text-xs break-all">
                    {depResult.archive_password}
                  </div>
                </div>
              )}
              <div>
                <strong>Perfil en disco:</strong>{" "}
                {depResult.wiped_profile ? "borrado" : "mantenido"}
              </div>
              {depResult.note && (
                <p className="text-xs text-muted-foreground mt-2">
                  {depResult.note}
                </p>
              )}
            </div>
            <button
              onClick={() => {
                setDepStep(0);
                setDepResult(null);
                setDepConfirm("");
              }}
              className="px-3 py-2 rounded border text-sm"
            >
              Cerrar
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-3">Auditoría reciente</h2>
        <div className="border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Fecha</th>
                <th className="text-left p-3">Actor</th>
                <th className="text-left p-3">Acción</th>
                <th className="text-left p-3">Objetivo</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="p-3 text-muted-foreground text-xs">
                    {new Date(a.created_at).toLocaleString("es-AR")}
                  </td>
                  <td className="p-3 text-xs">{a.actor_email || "—"}</td>
                  <td className="p-3 font-mono text-xs">{a.action}</td>
                  <td className="p-3 font-mono text-xs">{a.target || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Sin eventos.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
