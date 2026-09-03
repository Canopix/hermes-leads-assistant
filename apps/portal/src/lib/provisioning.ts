import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { logger } from "./logger";
import { expandHome } from "@/lib/paths.server";

/**
 * Tenant deprovisioning / archive logic, mirroring `provision_destroy` in
 * cli/leadai.py. Lives in the portal so super-admins can trigger it from
 * `/admin/tenants` without SSH'ing to the host.
 *
 * The flow is the same as the CLI:
 *   1. Stop the gateway (best-effort; profile may already be down).
 *   2. tar+encrypt the profile dir → ~/backups/{slug}-{ts}.tar.gz.enc
 *   3. Wipe the profile dir.
 *   4. The caller (admin route) marks the tenant row as `suspended` and
 *      records the audit entry.
 *
 * All filesystem paths are constructed from a sanitized slug — callers pass
 * through `resolveTenantContext` first, which already validated membership.
 */

export interface DeprovisionResult {
  slug: string;
  archivePath: string | null;
  archivePassword: string | null;
  wipedProfile: boolean;
}

const SAFE_SLUG_RE = /^[a-z0-9-]+$/;

function profilesDir(): string {
  return expandHome(
    process.env.HERMES_PROFILES_DIR || "~/.hermes/profiles"
  );
}

function backupsDir(): string {
  return process.env.LEADAI_BACKUPS_DIR
    ? path.resolve(process.env.LEADAI_BACKUPS_DIR)
    : path.join(os.homedir(), "backups");
}

/**
 * Stop the gateway for a profile. Best-effort — a missing pid file is treated
 * as "already stopped" and ignored.
 */
function stopGateway(profileName: string): void {
  try {
    execFileSync(
      "hermes",
      ["gateway", "stop", "--profile", profileName],
      { stdio: "ignore", timeout: 15000 }
    );
  } catch (e) {
    // Don't fail the whole deprovision if the gateway is already down.
    logger.warn({ err: e, profile: profileName }, "deprovision_stop_failed_best_effort");
  }
}

/**
 * Archive a profile dir to an encrypted tar.gz. Returns the absolute path of
 * the encrypted archive and the password (so the caller can surface it to the
 * operator ONE time). The plaintext tar is shredded after encryption.
 *
 * Uses `openssl enc -aes-256-cbc -pbkdf2` so the archive is decryptable with
 * the same one-liner documented in the CLI (`openssl enc -d ... | tar -xzf -`).
 *
 * The password is passed via an env var (`-pass env:LEADAI_ARCHIVE_PASS`) so it
 * does not appear in `ps`, `/proc/<pid>/cmdline`, or shell history. The var
 * is scoped to the openssl child process only.
 */
function archiveProfile(
  profileName: string,
  password: string
): string {
  const bdir = backupsDir();
  fs.mkdirSync(bdir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const tarPath = path.join(bdir, `${profileName}-${ts}.tar.gz`);
  const encPath = `${tarPath}.enc`;

  // tar -czf <tar> -C <profilesDir> <profileName>
  execFileSync(
    "tar",
    ["-czf", tarPath, "-C", profilesDir(), profileName],
    { stdio: "ignore" }
  );
  // openssl enc -aes-256-cbc -pbkdf2 -salt -in <tar> -out <enc> -pass env:VAR
  execFileSync(
    "openssl",
    [
      "enc", "-aes-256-cbc", "-pbkdf2", "-salt",
      "-in", tarPath,
      "-out", encPath,
      "-pass", "env:LEADAI_ARCHIVE_PASS",
    ],
    {
      stdio: "ignore",
      env: { ...process.env, LEADAI_ARCHIVE_PASS: password },
    }
  );

  // shred plaintext if available, else unlink.
  try {
    execFileSync("shred", ["-u", tarPath], { stdio: "ignore" });
  } catch {
    fs.unlinkSync(tarPath);
  }

  fs.chmodSync(encPath, 0o600);
  return encPath;
}

/**
 * Deprovision a tenant. `slug` is the tenant slug (validated by caller);
 * `hermesProfile` is the on-disk profile name (typically `${slug}-leads`).
 *
 * Set `keepProfile: true` to skip the wipe (e.g. dry-run).
 */
export function deprovisionTenant(opts: {
  slug: string;
  hermesProfile: string;
  password?: string;
  keepProfile?: boolean;
}): DeprovisionResult {
  if (!SAFE_SLUG_RE.test(opts.slug)) {
    throw new Error(`Refusing to deprovision invalid slug: ${opts.slug}`);
  }
  if (!SAFE_SLUG_RE.test(opts.hermesProfile)) {
    throw new Error(`Refusing to deprovision invalid profile name: ${opts.hermesProfile}`);
  }

  // 1. Stop the gateway.
  stopGateway(opts.hermesProfile);

  const profilePath = path.join(profilesDir(), opts.hermesProfile);
  if (!fs.existsSync(profilePath)) {
    logger.warn(
      { slug: opts.slug, profile: opts.hermesProfile },
      "deprovision_profile_missing"
    );
    // Mark result so the caller knows there was nothing to archive.
    return {
      slug: opts.slug,
      archivePath: null,
      archivePassword: null,
      wipedProfile: false,
    };
  }

  // 2. Archive.
  const password = opts.password ?? randomBytes(24).toString("base64url");
  const archivePath = archiveProfile(opts.hermesProfile, password);

  // 3. Wipe.
  let wiped = false;
  if (!opts.keepProfile) {
    fs.rmSync(profilePath, { recursive: true, force: true });
    wiped = true;
  }

  logger.info(
    { slug: opts.slug, profile: opts.hermesProfile, archivePath, wiped },
    "deprovision_completed"
  );

  return {
    slug: opts.slug,
    archivePath,
    archivePassword: password,
    wipedProfile: wiped,
  };
}
