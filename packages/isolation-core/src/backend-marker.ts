import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { BACKEND_FILE, type BackendKind } from "./backend"

export async function markStarted(base: string, backend: BackendKind, extra: Record<string, string> = {}): Promise<void> {
  let previous: Record<string, unknown> = {}
  try { previous = JSON.parse(await readFile(join(base, BACKEND_FILE), "utf8")) } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  await writeFile(join(base, BACKEND_FILE), JSON.stringify({ ...previous, backend, started_at: new Date().toISOString(), ...extra }))
}
