"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  ChevronsUpDown,
  Loader2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveTenant } from "@/app/(app)/actions";
import type { TenantRole } from "@/lib/tenants";

export interface SwitcherTenant {
  slug: string;
  name: string;
  hermesProfile: string;
  role: TenantRole;
}

interface ProfileSwitcherProps {
  tenants: SwitcherTenant[];
  activeSlug: string | null;
  isSuperAdmin: boolean;
}

const ROLE_LABEL: Record<TenantRole, string> = {
  owner: "Owner",
  admin: "Admin",
  viewer: "Viewer",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ProfileSwitcher({
  tenants,
  activeSlug,
  isSuperAdmin,
}: ProfileSwitcherProps) {
  const router = useRouter();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [transitioning, startTransition] = useTransition();

  const active = tenants.find((t) => t.slug === activeSlug) ?? tenants[0] ?? null;

  async function handleSelect(slug: string) {
    if (slug === activeSlug) return;
    setPendingSlug(slug);
    startTransition(async () => {
      const result = await setActiveTenant(slug);
      if (result.ok) {
        router.refresh();
      }
      setPendingSlug(null);
    });
  }

  // Empty state: no profiles at all.
  if (tenants.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-center">
        <Users className="mx-auto h-5 w-5 text-muted-foreground" />
        <p className="mt-2 text-xs font-medium">Sin perfiles asignados</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Contactá a un administrador para que te asigne uno.
        </p>
      </div>
    );
  }

  const busy = transitioning && pendingSlug !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-md border bg-background px-2.5 py-2 text-left text-sm transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
          "disabled:opacity-50 disabled:pointer-events-none"
        )}
        disabled={busy}
      >
        <Avatar className="h-8 w-8 rounded-md">
          <AvatarFallback className="rounded-md bg-primary/10 text-primary text-xs font-semibold">
            {active ? initials(active.name) : "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">
              {active?.name ?? "Seleccionar perfil"}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {isSuperAdmin ? (
              <>
                <ShieldCheck className="h-3 w-3" />
                <span>Super admin</span>
              </>
            ) : (
              <span>{active ? ROLE_LABEL[active.role] : "—"}</span>
            )}
          </div>
        </div>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="top"
        className="w-[calc(var(--radix-dropdown-menu-trigger-width))] min-w-[240px]"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal uppercase tracking-wide">
          Cambiar perfil
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenants.map((t) => {
          const isActive = t.slug === activeSlug;
          const isPending = t.slug === pendingSlug;
          return (
            <DropdownMenuItem
              key={t.slug}
              onSelect={() => handleSelect(t.slug)}
              className="gap-2.5 py-2"
            >
              <Avatar className="h-7 w-7 rounded-md">
                <AvatarFallback className="rounded-md bg-muted text-[10px] font-semibold">
                  {initials(t.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{t.name}</span>
                  {isActive && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Building2 className="h-3 w-3" />
                  <span className="truncate">{t.hermesProfile}</span>
                </div>
              </div>
              {isPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              {!isPending && !isActive && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                  {ROLE_LABEL[t.role]}
                </Badge>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
