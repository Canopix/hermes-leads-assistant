import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { expandHome } from "@/lib/paths.server";

export interface ProfileOption {
  slug: string;
  profile: string;
  name: string;
  lead_count: number;
}

export function getProfilesDir(): string {
  return expandHome(process.env.HERMES_PROFILES_DIR || "~/.hermes/profiles");
}

/**
 * Lists every `*-leads` directory on disk with a live lead count.
 *
 * Operator-only surface (super-admin health page). Tenant users must never
 * see this list — they see only the tenants they belong to via
 * `listTenantsForUser` in `tenants.ts`.
 */
export function listProfiles(): ProfileOption[] {
  const profilesDir = getProfilesDir();
  if (!fs.existsSync(profilesDir)) {
    return [];
  }

  const options: ProfileOption[] = [];
  for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith("-leads")) {
      continue;
    }
    const profile = entry.name;
    const slug = profile.replace(/-leads$/, "");
    const dbPath = path.join(profilesDir, profile, ".lead-capture", "leads.db");
    if (!fs.existsSync(dbPath)) {
      continue;
    }

    let leadCount = 0;
    try {
      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare("SELECT COUNT(*) as total FROM leads").get() as {
        total: number;
      };
      leadCount = row?.total ?? 0;
      db.close();
    } catch {
      leadCount = 0;
    }

    options.push({
      slug,
      profile,
      name: slug,
      lead_count: leadCount,
    });
  }

  return options.sort((a, b) => a.name.localeCompare(b.name));
}
