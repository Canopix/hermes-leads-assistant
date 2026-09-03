import fs from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { getProfilesDir } from "./profiles";

const SAFE_FILENAME_RE = /^[a-z0-9_\-]+\.md$/i;
const SAFE_SLUG_RE = /^[a-z0-9\-]+$/;

function profileDir(slug: string): string | null {
  if (!SAFE_SLUG_RE.test(slug)) return null;
  const dir = path.join(getProfilesDir(), `${slug}-leads`);
  return fs.existsSync(dir) ? dir : null;
}

function validateFilename(name: string): boolean {
  return SAFE_FILENAME_RE.test(name) && !name.includes("..");
}

function backupFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  }
}

// --- SOUL.md ---

export function getSoul(slug: string): string | null {
  const dir = profileDir(slug);
  if (!dir) return null;
  const p = path.join(dir, "SOUL.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;
}

export function updateSoul(slug: string, content: string): boolean {
  const dir = profileDir(slug);
  if (!dir) return false;
  const p = path.join(dir, "SOUL.md");
  backupFile(p);
  fs.writeFileSync(p, content, "utf-8");
  return true;
}

// --- Knowledge Base ---

export interface KnowledgeFile {
  name: string;
  size: number;
  modified: string;
}

function knowledgeDir(slug: string): string | null {
  const dir = profileDir(slug);
  if (!dir) return null;
  const kb = path.join(dir, "knowledge");
  if (!fs.existsSync(kb)) {
    fs.mkdirSync(kb, { recursive: true });
  }
  return kb;
}

export function listKnowledgeFiles(slug: string): KnowledgeFile[] {
  const kb = knowledgeDir(slug);
  if (!kb) return [];
  return fs
    .readdirSync(kb)
    .filter((f) => f.endsWith(".md") && !f.startsWith("."))
    .map((f) => {
      const stat = fs.statSync(path.join(kb, f));
      return {
        name: f,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getKnowledgeFile(slug: string, filename: string): string | null {
  if (!validateFilename(filename)) return null;
  const kb = knowledgeDir(slug);
  if (!kb) return null;
  const p = path.join(kb, filename);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;
}

export function createKnowledgeFile(
  slug: string,
  filename: string,
  content: string
): boolean {
  if (!validateFilename(filename)) return false;
  const kb = knowledgeDir(slug);
  if (!kb) return false;
  const p = path.join(kb, filename);
  if (fs.existsSync(p)) return false;
  fs.writeFileSync(p, content, "utf-8");
  return true;
}

export function updateKnowledgeFile(
  slug: string,
  filename: string,
  content: string
): boolean {
  if (!validateFilename(filename)) return false;
  const kb = knowledgeDir(slug);
  if (!kb) return false;
  const p = path.join(kb, filename);
  if (!fs.existsSync(p)) return false;
  backupFile(p);
  fs.writeFileSync(p, content, "utf-8");
  return true;
}

export function deleteKnowledgeFile(
  slug: string,
  filename: string
): boolean {
  if (!validateFilename(filename)) return false;
  const kb = knowledgeDir(slug);
  if (!kb) return false;
  const p = path.join(kb, filename);
  if (!fs.existsSync(p)) return false;
  fs.copyFileSync(p, `${p}.bak`);
  fs.unlinkSync(p);
  return true;
}

// --- config.yaml ---

export function getConfigYaml(slug: string): string | null {
  const dir = profileDir(slug);
  if (!dir) return null;
  const p = path.join(dir, "config.yaml");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;
}

export function updateConfigYaml(slug: string, content: string): boolean {
  const dir = profileDir(slug);
  if (!dir) return false;
  const p = path.join(dir, "config.yaml");
  backupFile(p);
  fs.writeFileSync(p, content, "utf-8");
  return true;
}

// --- extraction_hints (stored inside config.yaml under lead_capture.extraction_hints) ---

export function getExtractionHints(slug: string): string | null {
  const yaml = getConfigYaml(slug);
  if (!yaml) return null;
  const match = yaml.match(/extraction_hints:\s*["']?([\s\S]*?)(?=\n\w|\n$|$)/);
  if (!match) return null;
  return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
}

export function updateExtractionHints(slug: string, content: string): boolean {
  const yaml = getConfigYaml(slug);
  if (!yaml) return false;
  const escaped = content.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const newYaml = yaml.replace(
    /extraction_hints:\s*["']?[\s\S]*?(?=\n\w|\n$|$)/,
    `extraction_hints: "${escaped}"`
  );
  return updateConfigYaml(slug, newYaml);
}

// --- Gateway / RAG operations ---
//
// These are *explicit* actions invoked from dedicated endpoints — never
// implicit side effects of a save. They use execFileSync (no shell) with
// the slug validated against SAFE_SLUG_RE to eliminate injection risk
// even if the regex were ever bypassed.

export interface OpResult {
  ok: boolean;
  output: string;
}

function runHermes(slug: string, args: string[], timeoutMs: number): OpResult {
  if (!SAFE_SLUG_RE.test(slug)) {
    return { ok: false, output: `invalid slug: ${slug}` };
  }
  const fullArgs = ["-p", `${slug}-leads`, ...args];
  try {
    const output = execFileSync("hermes", fullArgs, {
      timeout: timeoutMs,
      encoding: "utf-8",
    });
    return { ok: true, output };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
        ? err
        : "operation failed";
    return { ok: false, output: msg };
  }
}

export function restartGateway(slug: string): OpResult {
  return runHermes(slug, ["gateway", "restart"], 30000);
}

export function reindexRag(slug: string): OpResult {
  return runHermes(slug, ["lead-rag", "ingest"], 60000);
}

// --- Playground (chat) ---

export interface AgentMessageResult {
  ok: boolean;
  reply: string;          // agente's final response (clean, no metadata)
  sessionId?: string;     // parsed from stderr — present on new AND resumed sessions
  error?: string;
}

/**
 * Send a single message to the tenant's agent and return the response.
 *
 * Uses `hermes -p <slug>-leads chat -q <msg> -Q` (quiet mode) plus optional
 * `-r <session_id>` to resume an existing conversation.
 *
 * Runtime contract (verified against hermes CLI on 2026-06):
 *   - stdout contains ONLY the agent's reply.
 *   - stderr contains the line `session_id: <id>` (and sometimes a
 *     `↻ Resumed session ...` notice when resuming).
 *
 * We use `spawnSync` instead of `execFileSync` so we can read stdout and
 * stderr separately — `execFileSync` merges them on error.
 */
export function runAgentMessage(
  slug: string,
  message: string,
  options: { resumeSessionId?: string; timeoutMs?: number } = {}
): AgentMessageResult {
  if (!SAFE_SLUG_RE.test(slug)) {
    return { ok: false, reply: "", error: `invalid slug: ${slug}` };
  }
  const args = ["-p", `${slug}-leads`, "chat", "-q", message, "-Q"];
  if (options.resumeSessionId) {
    // Defensive — Hermes session ids are timestamps + hex; reject anything weird.
    if (!/^[A-Za-z0-9_\-]+$/.test(options.resumeSessionId)) {
      return {
        ok: false,
        reply: "",
        error: "invalid session_id format",
      };
    }
    args.push("-r", options.resumeSessionId);
  }
  const result = spawnSync("hermes", args, {
    timeout: options.timeoutMs ?? 120_000,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) {
    return {
      ok: false,
      reply: "",
      error:
        result.error.message.includes("ETIMEDOUT") ||
        result.signal === "SIGTERM"
          ? "el agente tardó demasiado en responder (timeout)"
          : result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reply: "",
      error: (result.stderr || result.stdout || "agent failed").trim(),
    };
  }
  const reply = (result.stdout || "").trim();
  const sessionIdMatch = (result.stderr || "").match(
    /^session_id:\s+(\S+)/m
  );
  return {
    ok: true,
    reply,
    sessionId: sessionIdMatch ? sessionIdMatch[1] : undefined,
  };
}
