import fs from "node:fs";
import path from "node:path";
import { expandHome } from "@/lib/paths.server";

export const PROFILES_DIR = expandHome(
  process.env.HERMES_PROFILES_DIR || "~/.hermes/profiles"
);

const RUNTIME_STATUS_FILENAME = "gateway_state.json";
const PID_FILENAME = "gateway.pid";

/**
 * States the gateway itself reports when it knows it is not serving traffic.
 * Source: gateway/status.py `get_runtime_status_running_pid`.
 */
const DOWN_STATES = new Set(["stopped", "startup_failed", null]);

export interface PlatformStatus {
  state: string;
  error_code: string | null;
  error_message: string | null;
  updated_at: string | null;
}

/**
 * Mirror of what Hermes writes to gateway_state.json, augmented with a
 * normalized `online` boolean computed with the same liveness rules Hermes
 * uses internally (gateway/status.py:get_runtime_status_running_pid).
 */
export interface GatewayRuntime {
  pid: number | null;
  kind: string | null;
  gateway_state: string | null;
  online: boolean;
  active_agents: number;
  exit_reason: string | null;
  platforms: Record<string, PlatformStatus>;
  served_profiles: string[];
  updated_at: string | null;
  /** Where the verdict came from. */
  source: "runtime_status" | "pid_file" | "none";
}

export function profileDir(profile: string): string {
  return path.join(PROFILES_DIR, profile);
}

export function gatewayPidPath(profile: string): string {
  return path.join(profileDir(profile), PID_FILENAME);
}

export function gatewayStatePath(profile: string): string {
  return path.join(profileDir(profile), RUNTIME_STATUS_FILENAME);
}

function isRecordKindGateway(payload: Record<string, unknown>): boolean {
  if (payload.kind === "hermes-gateway") return true;
  const argv = payload.argv;
  if (Array.isArray(argv)) {
    return argv.some(
      (a) => typeof a === "string" && a.includes("gateway")
    );
  }
  return false;
}

/**
 * Reads the gateway PID from a Hermes `gateway.pid` file.
 *
 * Hermes writes the file in two flavors depending on the version:
 *  - New: `{"pid": 12345, "kind": "hermes-gateway", "argv": [...], ...}`
 *  - Legacy: a bare integer like `12345`
 */
export function readGatewayPid(profile: string): number | null {
  let raw: string;
  try {
    raw = fs.readFileSync(gatewayPidPath(profile), "utf-8").trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown };
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0
    ) {
      return parsed.pid;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

export function isPidAlive(pid: number): boolean {
  // process.kill(pid, 0) is a single kill(2) syscall that returns 0 if the
  // process exists (or EPERM, which still means it exists) and throws
  // otherwise. The previous implementation forked /bin/kill per probe,
  // which is slow and unnecessary.
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e) {
      const code = (e as { code?: string }).code;
      if (code === "EPERM") return true; // exists, just not ours
      if (code === "ESRCH") return false; // no such process
    }
    return false;
  }
}

function isPlatformStatus(v: unknown): v is PlatformStatus {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).state === "string"
  );
}

function readJsonFile(p: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(p, "utf-8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Read the gateway runtime status for a profile and compute `online` using
 * the same rules Hermes uses internally (gateway/status.py). Falls back to
 * the legacy `gateway.pid` file when `gateway_state.json` is missing.
 *
 * No HTTP, no ports: the gateway already writes its self-reported state to
 * disk and we read that.
 */
export function readGatewayRuntime(profile: string): GatewayRuntime {
  const statePath = gatewayStatePath(profile);
  const payload = fs.existsSync(statePath) ? readJsonFile(statePath) : null;

  if (payload) {
    const rawPlatforms = payload.platforms;
    const platforms: Record<string, PlatformStatus> = {};
    if (rawPlatforms && typeof rawPlatforms === "object") {
      for (const [k, v] of Object.entries(
        rawPlatforms as Record<string, unknown>
      )) {
        if (isPlatformStatus(v)) {
          platforms[k] = {
            state: v.state,
            error_code: v.error_code ?? null,
            error_message: v.error_message ?? null,
            updated_at: v.updated_at ?? null,
          };
        }
      }
    }

    const gatewayState =
      typeof payload.gateway_state === "string" ||
      payload.gateway_state === null
        ? (payload.gateway_state as string | null)
        : null;

    const pid =
      typeof payload.pid === "number" && Number.isInteger(payload.pid)
        ? payload.pid
        : null;

    // Mirror gateway/status.py:get_runtime_status_running_pid:
    //  - if the gateway reports it is stopped / failed → offline
    //  - else require a live PID whose record still looks like a gateway
    let online = false;
    if (!DOWN_STATES.has(gatewayState) && pid !== null) {
      const looksLikeGateway =
        isRecordKindGateway(payload) || isPidAlive(pid);
      if (looksLikeGateway && isPidAlive(pid)) {
        online = true;
      }
    }

    return {
      pid,
      kind: typeof payload.kind === "string" ? payload.kind : null,
      gateway_state: gatewayState,
      online,
      active_agents:
        typeof payload.active_agents === "number"
          ? payload.active_agents
          : 0,
      exit_reason:
        typeof payload.exit_reason === "string"
          ? payload.exit_reason
          : null,
      platforms,
      served_profiles: Array.isArray(payload.served_profiles)
        ? payload.served_profiles.filter(
            (s): s is string => typeof s === "string"
          )
        : [],
      updated_at:
        typeof payload.updated_at === "string" ? payload.updated_at : null,
      source: "runtime_status",
    };
  }

  // Legacy / older Hermes: only gateway.pid exists.
  const pid = readGatewayPid(profile);
  const online = pid !== null && isPidAlive(pid);
  return {
    pid,
    kind: online ? "hermes-gateway" : null,
    gateway_state: online ? "running" : null,
    online,
    active_agents: 0,
    exit_reason: null,
    platforms: {},
    served_profiles: [],
    updated_at: null,
    source: pid !== null ? "pid_file" : "none",
  };
}

export function isGatewayOnline(profile: string): boolean {
  return readGatewayRuntime(profile).online;
}
