import os from "node:os"
import path from "node:path"

/**
 * Expand a leading `~/` to the current user's home directory.
 *
 * Node's `path` module never expands `~`, so values coming from env vars
 * or config files that use the shell convention (`HERMES_PROFILES_DIR=~/.hermes/...`)
 * must be normalized before being passed to `path.join` / `fs.*`.
 */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir()
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2))
  return p
}
