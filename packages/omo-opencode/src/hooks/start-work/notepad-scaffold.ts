/// <reference types="bun-types" />

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./start-work-hook"

export const NOTEPAD_FILES = [
  "learnings.md",
  "decisions.md",
  "issues.md",
  "problems.md",
] as const

export type NotepadFileName = (typeof NOTEPAD_FILES)[number]

const NOTEPAD_PURPOSES: Readonly<Record<NotepadFileName, string>> = {
  "learnings.md": "Conventions, patterns, and successful approaches discovered during work on this plan.",
  "decisions.md": "Architectural choices and rationales discovered during work on this plan.",
  "issues.md": "Problems and gotchas encountered during work on this plan.",
  "problems.md": "Unresolved blockers and technical debt discovered during work on this plan.",
}

const NOTEPAD_LABELS: Readonly<Record<NotepadFileName, string>> = {
  "learnings.md": "Learnings",
  "decisions.md": "Decisions",
  "issues.md": "Issues",
  "problems.md": "Problems",
}

const NOTEPAD_FOOTER =
  "_Auto-scaffolded by /start-work. Append new entries below - never overwrite._"

function buildHeader(
  fileName: NotepadFileName,
  planName: string,
  timestamp: string,
): string {
  void timestamp
  const label = NOTEPAD_LABELS[fileName]
  const purpose = NOTEPAD_PURPOSES[fileName]
  return `# ${label} \u2014 ${planName}\n\n${purpose}\n\n${NOTEPAD_FOOTER}\n\n---\n`
}

export function ensureNotepadScaffold(params: {
  readonly directory: string
  readonly planName: string
  readonly timestamp?: string
}): { created: string[]; skipped: string[] } {
  const { directory, planName, timestamp = new Date().toISOString() } = params
  const notepadDir = join(directory, ".omo", "notepads", planName)
  mkdirSync(notepadDir, { recursive: true })

  const created: string[] = []
  const skipped: string[] = []

  for (const fileName of NOTEPAD_FILES) {
    const header = buildHeader(fileName, planName, timestamp)
    try {
      writeFileSync(join(notepadDir, fileName), header, { flag: "wx" })
      created.push(fileName)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        skipped.push(fileName)
      } else {
        throw err
      }
    }
  }

  log(`[${HOOK_NAME}] Notepad scaffold`, { planName, created, skipped })
  return { created, skipped }
}
