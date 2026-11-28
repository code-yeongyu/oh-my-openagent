import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOmoSdk, type OmoResult, type OmoSdkPorts } from ".."
import { ENGINE_READ_AT_VERSION } from "./engine"

type Env = Readonly<Record<string, string | undefined>>
type Doc = Readonly<Record<string, unknown>>

export const LAUNCH = { provider: "anthropic", model: "claude-opus-5-5" } as const

/**
 * A temp home with the project directory under it, so neither the omo loader's nor the engine's
 * walk-up leaves the sandbox (both stop at home), and an agent dir pinned through the environment.
 */
export function configSandbox() {
  const root = mkdtempSync(join(tmpdir(), "omo-sdk-config-"))
  const home = join(root, "home")
  const project = join(home, "work", "project")
  const agentDir = join(home, ".omo", "agent")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(project, { recursive: true })
  const env: Env = { HOME: home, OMO_CODING_AGENT_DIR: agentDir }
  const writeJson = (path: string, doc: Doc | string): string => {
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, typeof doc === "string" ? doc : `${JSON.stringify(doc, null, 2)}\n`)
    return path
  }
  let sessionCount = 0
  return {
    root,
    home,
    project,
    agentDir,
    env,
    userConfig: (doc: Doc | string) => writeJson(join(home, ".omo", "omo.jsonc"), doc),
    projectConfig: (doc: Doc | string) => writeJson(join(project, ".omo", "omo.jsonc"), doc),
    engineGlobal: (doc: Doc | string) => writeJson(join(agentDir, "settings.json"), doc),
    engineProject: (doc: Doc | string) => writeJson(join(project, ".omo", "settings.json"), doc),
    session(entries: readonly Doc[], id = `0199${String((sessionCount += 1)).padStart(4, "0")}-test`): string {
      const lines = [{ type: "session", id, cwd: project, timestamp: "2026-11-09T12:00:00.000Z" }, ...entries]
      return writeJson(
        join(agentDir, "sessions", "--work-project--", `2026-11-09T12-00-00-000Z_${id}.jsonl`),
        `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
      )
    },
    config(options: { readonly env?: Env; readonly ports?: OmoSdkPorts } = {}) {
      return createOmoSdk({
        env: { ...env, ...options.env },
        cwd: project,
        ports: { engineVersion: () => ENGINE_READ_AT_VERSION, ...options.ports },
      }).config
    },
    snapshot(): Readonly<Record<string, string>> {
      const files: Record<string, string> = {}
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name)
          if (statSync(path).isDirectory()) walk(path)
          else files[path] = readFileSync(path, "utf-8")
        }
      }
      walk(root)
      return files
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

export type ConfigSandbox = ReturnType<typeof configSandbox>

export const modelChange = (
  timestamp: string,
  to: string,
  reason?: "fallback" | "fallback-revert",
  from?: string,
): Doc => {
  const [provider, modelId] = to.split("/")
  const [originalProvider, originalModelId] = (from ?? "").split("/")
  return {
    type: "model_change",
    timestamp,
    provider,
    modelId,
    ...(reason === undefined ? {} : { reason, originalProvider, originalModelId, source: reason, duringTurn: true }),
  }
}

export const assistantTurn = (timestamp: string, model: string): Doc => {
  const [provider, id] = model.split("/")
  return { type: "message", timestamp, message: { role: "assistant", provider, model: id, content: [] } }
}

export const valueOf = <T>(result: OmoResult<T>): T => {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result.value
}

export const errorOf = <T>(result: OmoResult<T>) => {
  if (result.kind !== "error") throw new Error(`expected an error, got ${JSON.stringify(result)}`)
  return result.error
}
