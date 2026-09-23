import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { parse } from "jsonc-parser"
import type { StandaloneParityManifest } from "./contracts"
import { deployStandaloneParity, rollbackStandaloneParity, verifyStandaloneParity } from "./deployment"
import { generateStandaloneParity } from "./generator"

const ACTIONS = ["generate", "verify", "deploy", "rollback"] as const
const scriptDirectory = fileURLToPath(new URL(".", import.meta.url))
const packageRoot = join(scriptDirectory, "..", "..")
type Action = (typeof ACTIONS)[number]

export interface StandaloneParityCliInput {
  readonly action: Action
  readonly realHome: string
  readonly betaRoot: string
}

export interface StandaloneParityCliResult {
  readonly manifest?: StandaloneParityManifest
}

export async function runStandaloneParityCli(input: StandaloneParityCliInput): Promise<StandaloneParityCliResult> {
  const parityRoot = join(input.betaRoot, "standalone-parity")
  const stagingRoot = join(parityRoot, "staging")
  const configPath = join(input.betaRoot, "home", ".omo", "omo.jsonc")
  const settingsPath = join(input.betaRoot, "home", ".omo", "agent", "settings.json")
  if (input.action === "generate") {
    const openViking = await resolveOpenVikingSource(input.realHome)
    const generated = await generateStandaloneParity({
      outputRoot: stagingRoot,
      skillRoots: existingPaths([
        join(input.realHome, ".config", "opencode", "skills"),
        join(input.realHome, ".agents", "skills"),
        join(input.realHome, ".claude", "skills"),
      ]),
      commandRoots: existingPaths([join(input.realHome, ".config", "opencode", "commands")]),
      instructionPaths: existingPaths([
        join(input.realHome, ".config", "opencode", "AGENTS.md"),
        join(input.realHome, ".agents", "AGENTS.md"),
      ]),
      mcpConfigPaths: existingPaths([
        join(input.realHome, ".config", "opencode", "mcp.json"),
        join(input.realHome, ".agents", "mcp.json"),
        join(input.realHome, ".claude", ".mcp.json"),
      ]),
      opencodeRoutingPath: existsSync(join(input.realHome, ".omo", "omo.jsonc"))
        ? join(input.realHome, ".omo", "omo.jsonc")
        : undefined,
      availableModels: await betaModels(input.betaRoot),
      openVikingPluginRoot: openViking?.pluginRoot,
      openVikingCredentialPath: openViking?.credentialPath,
      openVikingConfigPath: openViking?.configPath,
      parityExtensionPath: join(packageRoot, "plugin", "extensions", "omo-standalone-parity.js"),
    })
    return { manifest: generated.manifest }
  }
  if (input.action === "verify") return { manifest: await verifyStandaloneParity(stagingRoot) }
  if (input.action === "deploy") {
    const manifest = await verifyStandaloneParity(stagingRoot)
    await deployStandaloneParity({
      stagingRoot,
      parityRoot,
      configPath,
      settingsPath,
      overlay: await createOverlay(configPath, join(stagingRoot, "routing.json")),
    })
    return { manifest }
  }
  await rollbackStandaloneParity({ parityRoot, configPath, settingsPath })
  return {}
}

interface OpenVikingSource {
  readonly pluginRoot: string
  readonly credentialPath?: string
  readonly configPath?: string
}

async function resolveOpenVikingSource(realHome: string): Promise<OpenVikingSource | undefined> {
  const opencodePath = join(realHome, ".config", "opencode", "opencode.json")
  if (!existsSync(opencodePath)) return undefined
  const opencode: unknown = parse(await readFile(opencodePath, "utf8"))
  if (opencode === null || typeof opencode !== "object" || Array.isArray(opencode)) return undefined
  const plugins = Reflect.get(opencode, "plugin")
  if (!Array.isArray(plugins)) return undefined
  const declaration = plugins.find((plugin): plugin is string => typeof plugin === "string" && plugin.startsWith("@openviking/opencode-plugin@"))
  if (declaration === undefined) return undefined
  const version = /^@openviking\/opencode-plugin@(\d+\.\d+\.\d+)$/u.exec(declaration)?.[1]
  if (version === undefined) throw new Error("OpenViking plugin must use an exact version")
  const pluginRoot = join(
    realHome,
    ".cache",
    "opencode",
    "packages",
    "@openviking",
    `opencode-plugin@${version}`,
    "node_modules",
    "@openviking",
    "opencode-plugin",
  )
  if (!existsSync(pluginRoot)) throw new Error(`OpenViking plugin package not found for version ${version}`)
  const credentialPath = join(realHome, ".openviking", "ovcli.conf")
  const behaviorConfigPath = join(realHome, ".config", "opencode", "openviking-config.json")
  return {
    pluginRoot,
    ...(existsSync(credentialPath) ? { credentialPath } : {}),
    ...(existsSync(behaviorConfigPath) ? { configPath: behaviorConfigPath } : {}),
  }
}

function existingPaths(paths: readonly string[]): readonly string[] {
  return paths.filter((path) => existsSync(path))
}

async function betaModels(betaRoot: string): Promise<readonly string[]> {
  const settingsPath = join(betaRoot, "home", ".omo", "agent", "settings.json")
  if (!existsSync(settingsPath)) return []
  const settings = parse(await readFile(settingsPath, "utf8"))
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return []
  const available = new Set<string>()
  const defaultProvider = Reflect.get(settings, "defaultProvider")
  const defaultModel = Reflect.get(settings, "defaultModel")
  if (typeof defaultProvider === "string" && typeof defaultModel === "string") {
    available.add(`${defaultProvider}/${defaultModel}`)
  }
  const models = Reflect.get(settings, "models")
  if (Array.isArray(models)) {
    for (const model of models) {
      if (model === null || typeof model !== "object" || Array.isArray(model)) continue
      const provider = Reflect.get(model, "provider")
      const id = Reflect.get(model, "id")
      if (typeof provider === "string" && typeof id === "string") available.add(`${provider}/${id}`)
    }
  }
  for (const key of ["modelThinkingLevels", "modelLastOnThinkingLevels"]) {
    const levels = recordField(settings, key)
    if (levels !== undefined) for (const model of Object.keys(levels)) available.add(model)
  }
  return [...available].sort()
}

async function createOverlay(configPath: string, routingPath: string): Promise<string> {
  const existing = existsSync(configPath) ? await readFile(configPath, "utf8") : "{}"
  const parsed: unknown = parse(existing)
  if (!isRecord(parsed)) throw new Error("isolated OMO config must be an object")
  const routing: unknown = JSON.parse(await readFile(routingPath, "utf8"))
  const routes = recordField(routing, "routes")
  const agentRoutes = routes === undefined ? {} : stringRecord(recordField(routes, "agents"))
  const categoryRoutes = routes === undefined ? {} : stringRecord(recordField(routes, "categories"))
  const currentSenpi = recordField(parsed, "[senpi]") ?? {}
  const agents = mergeRoutes(recordField(currentSenpi, "agents") ?? {}, agentRoutes)
  const categories = mergeRoutes(recordField(currentSenpi, "categories") ?? {}, categoryRoutes)
  return JSON.stringify({ ...parsed, "[senpi]": { ...currentSenpi, agents, categories } }, null, 2)
}

function mergeRoutes(existing: Record<string, unknown>, routes: Readonly<Record<string, string>>): Record<string, unknown> {
  const merged = { ...existing }
  for (const [name, model] of Object.entries(routes)) {
    const current = recordField(existing, name) ?? {}
    merged[name] = { ...current, model }
  }
  return merged
}

function stringRecord(value: Record<string, unknown> | undefined): Record<string, string> {
  if (value === undefined) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => typeof item === "string" ? [[key, item]] : []))
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const field = Reflect.get(value, key)
  return isRecord(field) ? field : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readAction(args: readonly string[]): Action {
  const candidate = args[0]
  if (!isAction(candidate)) throw new Error(`usage: standalone-parity <${ACTIONS.join("|")}> --real-home <path> --beta-root <path>`)
  return candidate
}

function readFlag(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag)
  if (index === -1) throw new Error(`missing ${flag}`)
  const value = args[index + 1]
  if (value === undefined || value.startsWith("--")) throw new Error(`missing ${flag}`)
  return value
}

function isAction(value: string | undefined): value is Action {
  return ACTIONS.some((action) => action === value)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const result = await runStandaloneParityCli({
    action: readAction(args),
    realHome: readFlag(args, "--real-home"),
    betaRoot: readFlag(args, "--beta-root"),
  })
  process.stdout.write(`${JSON.stringify({ skills: result.manifest?.skills.length ?? 0, commands: result.manifest?.commands.length ?? 0, mcps: result.manifest?.mcps.length ?? 0 })}\n`)
}
