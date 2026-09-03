import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  type LucideIcon,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Users,
  Wand2,
} from "lucide-react";
import { getSession } from "@/lib/session";
import { UserMenu } from "@/components/user-menu";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { getSidebarTenantState } from "./actions";

/**
 * Shell for every authenticated route. Forces a session — anonymous
 * visitors never reach a page in this group (middleware already redirects
 * to /login, but this is the second-line defense for server renders).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const role = (session.user as { role?: string }).role ?? "viewer";
  const isSuperAdmin = role === "super_admin";

  const { tenants, activeSlug } = await getSidebarTenantState();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-64 border-r bg-muted/40 flex flex-col">
        <div className="flex items-center gap-2.5 p-5 border-b">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shrink-0">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight leading-tight">
              Hermes Leads
            </h1>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Portal de gestión
            </p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <NavSection>
            <NavLink href="/dashboard" label="Dashboard" icon={LayoutDashboard} />
            <NavLink href="/leads" label="Contactos" icon={ClipboardList} />
            <NavLink href="/analytics" label="Analytics" icon={BarChart3} />
            <NavLink href="/config" label="Configuración" icon={Settings2} />
          </NavSection>

          {isSuperAdmin && (
            <>
              <div className="pt-4 pb-1 px-3 text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3 w-3" />
                Super admin
              </div>
              <NavSection>
                <NavLink href="/admin/tenants" label="Tenants" icon={Boxes} />
                <NavLink href="/admin/users" label="Usuarios" icon={Users} />
                <NavLink href="/admin/audit" label="Auditoría" icon={ClipboardList} />
                <NavLink href="/admin/health" label="Salud" icon={Stethoscope} />
                <NavLink href="/admin/playground" label="Playground" icon={Wand2} />
              </NavSection>
            </>
          )}
        </nav>

        <div className="border-t p-3 space-y-2">
          <div className="px-1 pb-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Perfil activo
            </p>
          </div>
          <ProfileSwitcher
            tenants={tenants}
            activeSlug={activeSlug}
            isSuperAdmin={isSuperAdmin}
          />
          <div className="pt-1">
            <UserMenu
              name={session.user.name ?? "Usuario"}
              email={session.user.email ?? ""}
              role={role}
            />
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function NavSection({ children }: { children: React.ReactNode }) {
  return <div className="space-y-0.5">{children}</div>;
}

function NavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}
