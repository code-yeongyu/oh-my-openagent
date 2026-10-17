import { existsSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, relative, sep } from "node:path"

/** Bun entry names are relative to --root, not to the relocated executable's cwd. */
export function senpiWorkerCompileArgs(repoRoot: string): string[] {
  const candidate = join(repoRoot, "node_modules/@code-yeongyu/senpi/dist/modes/rpc/session-worker.js")
  // Older pinned engines do not have a shared-session worker.
  if (!existsSync(candidate)) return []
  const entry = realpathSync(candidate)
  let root = realpathSync(repoRoot)
  let worker = relative(root, entry)
  if (isAbsolute(worker)) throw new Error("The wrapper and session worker must share a filesystem root")
  // Bun embeds the physical entry name, including .bun store paths. Linked
  // development engines outside the repo need a root containing both entries.
  while (worker.startsWith(`..${sep}`)) {
    root = dirname(root)
    worker = relative(root, entry)
  }
  return [
    `--root=${root}`,
    `--define=SENPI_RPC_SESSION_WORKER_ENTRY=${JSON.stringify(`./${worker.split(sep).join("/")}`)}`,
    entry,
  ]
}
