import { readFile } from "node:fs/promises"
import path from "node:path"

const DOCS_ROOT = path.resolve(process.cwd(), "..", "docs")

export async function loadDocSource(file: string): Promise<string> {
  const fullPath = path.join(DOCS_ROOT, file)
  return readFile(fullPath, "utf8")
}
