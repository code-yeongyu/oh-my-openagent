import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { DomainFile, Row } from "./schema"

const PARITY_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(PARITY_DIR, "../..")
export const ROWS_DIR = join(PARITY_DIR, "rows")
export const TEMPLATE_PATH = join(PARITY_DIR, "section6.template.md")
export const DESIGN_PATH = join(REPO_ROOT, "docs/reference/omo-sdk-first-party-design.md")

export function loadDomainFiles(dir: string = ROWS_DIR): DomainFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .toSorted()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as DomainFile)
}

export const allRows = (files: readonly DomainFile[]): Row[] => files.flatMap((file) => file.rows)
