import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

function getMatrixHome(): string {
  return join(process.cwd(), ".matrix")
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function appendLog(subdir: string, entry: Record<string, unknown>) {
  const dir = join(getMatrixHome(), subdir)
  ensureDir(dir)
  const file = join(dir, "log.jsonl")
  appendFileSync(file, JSON.stringify({ ...entry, ts: Date.now() }) + "\n", "utf-8")
}

export function readLogs(subdir: string, limit = 50) {
  const file = join(getMatrixHome(), subdir, "log.jsonl")
  if (!existsSync(file)) return []
  const raw = readFileSync(file, "utf-8") as string
  return raw.split("\n").filter(Boolean).slice(-limit).map((l) => JSON.parse(l))
}

export function writeHtml(subdir: string, filename: string, html: string) {
  const dir = join(getMatrixHome(), subdir)
  ensureDir(dir)
  writeFileSync(join(dir, filename), html, "utf-8")
}

export { getMatrixHome }
