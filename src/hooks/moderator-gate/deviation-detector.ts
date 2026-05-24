import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"
import { log } from "../../shared/logger"

const BOULDER_DIR = ".omo"
const BOULDER_FILE = "boulder.json"
const PLANS_DIR = "plans"

export interface ToolEvent {
  tool: string
  sessionID: string
  callID: string
  output: string
  metadata: Record<string, unknown>
}

export interface Deviation {
  severity: "leve" | "media" | "grave"
  category: string
  detail: string
  filePath?: string
}

const WRITE_TOOLS = new Set(["write", "edit"])
const DANGEROUS_COMMANDS = [
  "git push", "git merge", "git rebase", "git reset",
  "npm publish",
  "rm -rf", "drop table", "alter table",
  "npx", "bunx",
] as const

function getBoulderState(projectDir: string): Record<string, unknown> | null {
  const filePath = join(projectDir, BOULDER_DIR, BOULDER_FILE)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function getPlanProgressSum(projectDir: string): { total: number; completed: number } {
  const plansDir = join(projectDir, BOULDER_DIR, PLANS_DIR)
  if (!existsSync(plansDir)) return { total: 0, completed: 0 }

  try {
    const files = readdirSync(plansDir).filter((f) => f.endsWith(".md"))
    let total = 0
    let completed = 0

    for (const file of files) {
      const content = readFileSync(join(plansDir, file), "utf-8")
      const unchecked = content.match(/\[ \]/g)
      const checked = content.match(/\[x\]/gi)
      const tasks = content.match(/[-*]\s+\[[\sx]\]/gi)
      if (tasks) {
        total += tasks.length
        completed += checked?.length ?? 0
      }
    }

    return { total, completed }
  } catch {
    return { total: 0, completed: 0 }
  }
}

function getFileFromMeta(metadata: Record<string, unknown>): string | undefined {
  return (metadata?.filePath as string) ?? (metadata?.file_path as string) ?? undefined
}

function detectFileDeviations(event: ToolEvent): Deviation[] {
  const deviations: Deviation[] = []
  if (!WRITE_TOOLS.has(event.tool.toLowerCase())) return deviations

  const filePath = getFileFromMeta(event.metadata)
  if (!filePath) return deviations

  if (filePath.includes("node_modules")) {
    deviations.push({
      severity: "grave",
      category: "protected-area-write",
      detail: `Writing to node_modules: ${filePath}`,
      filePath,
    })
  }

  const configPatterns = ["tsconfig", "package.json", "bunfig", ".env", "docker"]
  if (configPatterns.some((p) => filePath.toLowerCase().includes(p))) {
    deviations.push({
      severity: "grave",
      category: "config-change",
      detail: `Modifying configuration file: ${filePath}`,
      filePath,
    })
  }

  if (
    filePath.includes("/src/features/")
    && !filePath.endsWith(".test.ts")
    && !filePath.includes("/test/")
  ) {
    deviations.push({
      severity: "media",
      category: "feature-change",
      detail: `Modifying feature source: ${filePath}`,
      filePath,
    })
  }

  return deviations
}

function detectBashDeviations(event: ToolEvent): Deviation[] {
  const deviations: Deviation[] = []
  if (event.tool.toLowerCase() !== "bash") return deviations

  const command = (event.metadata?.command as string) ?? event.output?.slice(0, 200) ?? ""

  for (const dangerous of DANGEROUS_COMMANDS) {
    if (command.toLowerCase().includes(dangerous)) {
      deviations.push({
        severity: "grave",
        category: "dangerous-command",
        detail: `Executing dangerous command pattern: ${dangerous}`,
      })
      break
    }
  }

  if (
    command.includes("npm install")
    || command.includes("bun add")
    || command.includes("pip install")
    || command.includes("go get")
  ) {
    deviations.push({
      severity: "media",
      category: "dependency-add",
      detail: `Adding new dependency: ${command.slice(0, 100)}`,
    })
  }

  return deviations
}

function detectOutputDeviations(event: ToolEvent): Deviation[] {
  const deviations: Deviation[] = []
  const output = event.output ?? ""

  const errorPatterns = [
    /\bError:/, /\bfailed\b/i, /\bcannot find module\b/i,
    /\bERR!\b/, /\bexit code 1\b/, /\bTypeError:/,
  ]

  for (const pattern of errorPatterns) {
    if (pattern.test(output)) {
      deviations.push({
        severity: "media",
        category: "error-in-output",
        detail: `Error pattern detected in ${event.tool} output`,
      })
      break
    }
  }

  return deviations
}

export function detectDeviations(
  event: ToolEvent,
  projectDir?: string,
): Deviation[] {
  const deviations: Deviation[] = [
    ...detectFileDeviations(event),
    ...detectBashDeviations(event),
    ...detectOutputDeviations(event),
  ]

  if (projectDir && WRITE_TOOLS.has(event.tool.toLowerCase())) {
    try {
      const progress = getPlanProgressSum(projectDir)
      if (progress.total > 0 && progress.completed === 0) {
        deviations.push({
          severity: "media",
          category: "no-plan-progress",
          detail: `Writing files but no plan steps completed (0/${progress.total})`,
        })
      }
    } catch {
      // Silently ignore plan read errors
    }
  }

  return deviations
}

export function formatDeviations(deviations: Deviation[]): string {
  if (deviations.length === 0) return ""
  const parts = deviations.map((d) => {
    const icon = d.severity === "grave" ? "🔴" : d.severity === "media" ? "🟡" : "🟢"
    const path = d.filePath ? ` (${d.filePath})` : ""
    return `${icon} [${d.severity.toUpperCase()}] ${d.category}${path}: ${d.detail}`
  })
  return ["", "---", "⚠️ Moderator Gate — Deviation Report:", ...parts, "---", ""].join("\n")
}
