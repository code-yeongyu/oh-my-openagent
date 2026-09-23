import { existsSync } from "node:fs"
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path"

import { parse as parseJsonc } from "jsonc-parser"
import { generatedMcpSchema, type GeneratedCommand, type GeneratedMcp, type RoutingReport, type StandaloneParityManifest, standaloneParityManifestSchema, STANDALONE_PARITY_VERSION, StandaloneParityInputError } from "./contracts"
import { packageOpenVikingProxy } from "./openviking-package"
import { copyTree, ensureRegularSourceRoot, hashTree, relativeInside, writeText } from "./safe-files"

export interface StandaloneParityGeneratorInput {
  readonly outputRoot: string
  readonly skillRoots: readonly string[]
  readonly commandRoots: readonly string[]
  readonly instructionPaths: readonly string[]
  readonly mcpConfigPaths?: readonly string[]
  readonly opencodeRoutingPath?: string
  readonly availableModels?: readonly string[]
  readonly openVikingPluginRoot?: string
  readonly openVikingCredentialPath?: string
  readonly openVikingConfigPath?: string
  readonly parityExtensionPath?: string
}

export class StandaloneParityUnavailableError extends Error {
  readonly name = "StandaloneParityUnavailableError"

  constructor() {
    super("standalone parity generation is not implemented")
  }
}

export async function generateStandaloneParity(
  input: StandaloneParityGeneratorInput,
): Promise<{ readonly manifest: StandaloneParityManifest; readonly routing: RoutingReport }> {
  await mkdir(dirname(input.outputRoot), { recursive: true })
  const stagingRoot = await mkdtemp(join(dirname(input.outputRoot), ".standalone-parity-stage-"))
  try {
    const skills = await copySkills(input.skillRoots, stagingRoot)
    const commandGeneration = await copyCommands(input.commandRoots, stagingRoot)
    const commands = commandGeneration.commands
    const instructions = await expandInstructions(input.instructionPaths)
    const configuredMcps = await loadMcps(input.mcpConfigPaths ?? [])
    const openViking = await packageOpenVikingProxy({
      pluginRoot: input.openVikingPluginRoot,
      credentialPath: input.openVikingCredentialPath,
      configPath: input.openVikingConfigPath,
    }, stagingRoot)
    if (openViking !== undefined && configuredMcps.some((mcp) => mcp.name === openViking.name)) {
      throw new StandaloneParityInputError("duplicate MCP declaration: openviking")
    }
    const mcps = [...configuredMcps, ...(openViking === undefined ? [] : [openViking])]
      .sort((left, right) => left.name.localeCompare(right.name))
    const routing = await projectRouting(input.opencodeRoutingPath, input.availableModels ?? [])
    await stageParityPackage(input.parityExtensionPath, stagingRoot)
    await writeText(join(stagingRoot, "instructions.md"), instructions)
    await writeText(join(stagingRoot, "commands.json"), JSON.stringify(commands, null, 2))
    await writeText(join(stagingRoot, "command-report.json"), JSON.stringify({ skipped: commandGeneration.skipped }, null, 2))
    await writeText(join(stagingRoot, "mcps.json"), JSON.stringify(mcps, null, 2))
    await writeText(join(stagingRoot, "routing.json"), JSON.stringify(routing, null, 2))
    const files = await hashTree(stagingRoot)
    const manifest = standaloneParityManifestSchema.parse({
      version: STANDALONE_PARITY_VERSION,
      generatedAt: new Date().toISOString(),
      skills,
      commands: commands.map((command) => command.name),
      mcps,
      instructionsPath: "instructions.md",
      routingPath: "routing.json",
      files,
    })
    await writeText(join(stagingRoot, "manifest.json"), JSON.stringify(manifest, null, 2))
    await rm(input.outputRoot, { recursive: true, force: true })
    await rename(stagingRoot, input.outputRoot)
    return { manifest, routing }
  } catch (error: unknown) {
    await rm(stagingRoot, { recursive: true, force: true })
    throw error
  }
}

async function stageParityPackage(extensionPath: string | undefined, stagingRoot: string): Promise<void> {
  if (extensionPath === undefined) return
  const entry = await lstat(extensionPath)
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new StandaloneParityInputError(`standalone parity extension is not a regular file: ${extensionPath}`)
  }
  const packageRoot = join(stagingRoot, "package")
  await mkdir(join(packageRoot, "extensions"), { recursive: true })
  await copyFile(extensionPath, join(packageRoot, "extensions", "omo-standalone-parity.js"))
  await writeText(join(packageRoot, "package.json"), JSON.stringify({
    name: "@code-yeongyu/omo-senpi-standalone-parity",
    private: true,
    type: "module",
    pi: { extensions: ["./extensions/omo-standalone-parity.js"] },
  }, null, 2))
}

async function copySkills(roots: readonly string[], stagingRoot: string): Promise<readonly string[]> {
  const names = new Set<string>()
  const allowedRoots = await Promise.all(roots.map((root) => ensureRegularSourceRoot(root)))
  for (const root of allowedRoots) {
    const entries = await (await import("node:fs/promises")).readdir(root, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const candidate = join(root, entry.name)
      const stat = await lstat(candidate)
      if (!stat.isDirectory() && !stat.isSymbolicLink()) continue
      const source = stat.isSymbolicLink() ? await safeLinkedSkill(candidate, allowedRoots) : candidate
      if (stat.isSymbolicLink() && !(await lstat(source)).isDirectory()) {
        throw new StandaloneParityInputError(`skill symlink does not resolve to a directory: ${candidate}`)
      }
      if (names.has(entry.name)) continue
      const skillFile = join(source, "SKILL.md")
      try {
        await readFile(skillFile)
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue
        throw error
      }
      await copyTree(source, join(stagingRoot, "skills", entry.name))
      names.add(entry.name)
    }
  }
  return [...names].sort()
}

async function safeLinkedSkill(path: string, allowedRoots: readonly string[]): Promise<string> {
  let target: string
  try {
    target = await realpath(path)
  } catch {
    throw new StandaloneParityInputError(`symlink rejected: ${path}`)
  }
  if (allowedRoots.some((root) => isInsideRoot(root, target))) return target
  throw new StandaloneParityInputError(`symlink escapes selected skill roots: ${path}`)
}

function isInsideRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path.length > 0 && path !== ".." && !path.startsWith(`..${sep}`)
}

type SkippedCommand = {
  readonly name: string
  readonly reason: "OpenCode-only command metadata"
}

type ParsedCommand =
  | { readonly kind: "command"; readonly command: GeneratedCommand }
  | { readonly kind: "skipped"; readonly command: SkippedCommand }

async function copyCommands(roots: readonly string[], stagingRoot: string): Promise<{
  readonly commands: readonly GeneratedCommand[]
  readonly skipped: readonly SkippedCommand[]
}> {
  const commands = new Map<string, GeneratedCommand>()
  const skipped: SkippedCommand[] = []
  const seen = new Set<string>()
  for (const rootInput of roots) {
    const root = await ensureRegularSourceRoot(rootInput)
    const entries = await (await import("node:fs/promises")).readdir(root, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if ((await lstat(join(root, entry.name))).isSymbolicLink()) {
        throw new StandaloneParityInputError(`symlink rejected: ${join(root, entry.name)}`)
      }
      if (!entry.isFile() || parse(entry.name).ext !== ".md") continue
      const name = parse(entry.name).name
      if (seen.has(name)) continue
      seen.add(name)
      const parsed = parseCommand(name, await readFile(join(root, entry.name), "utf8"))
      if (parsed.kind === "command") commands.set(name, parsed.command)
      else skipped.push(parsed.command)
    }
  }
  const output = [...commands.values()].sort((left, right) => left.name.localeCompare(right.name))
  await writeText(join(stagingRoot, "commands", "README.md"), "Generated standalone command resources.\n")
  return { commands: output, skipped: skipped.sort((left, right) => left.name.localeCompare(right.name)) }
}

function parseCommand(name: string, source: string): ParsedCommand {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(source)
  if (frontmatter === null) throw new StandaloneParityInputError(`command frontmatter missing: ${name}`)
  const metadata = frontmatter[1]
  const body = frontmatter[2]
  if (/^(?:agent|model|subtask|tools|permission):/mu.test(metadata)) {
    return { kind: "skipped", command: { name, reason: "OpenCode-only command metadata" } }
  }
  const description = /^description:\s*(.+)$/mu.exec(metadata)?.[1]?.trim()
  if (description === undefined || description.length === 0) throw new StandaloneParityInputError(`command description missing: ${name}`)
  return { kind: "command", command: { name, description, template: body } }
}

async function expandInstructions(paths: readonly string[]): Promise<string> {
  const expanded: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  for (const path of paths) await expandInstruction(resolve(path), resolve(dirname(path)), visiting, visited, expanded)
  return expanded.join("\n\n")
}

async function expandInstruction(path: string, root: string, visiting: Set<string>, visited: Set<string>, output: string[]): Promise<void> {
  const resolved = resolve(path)
  relativeInside(root, resolved)
  if (visiting.has(resolved)) throw new StandaloneParityInputError(`instruction include cycle: ${basename(resolved)}`)
  if (visited.has(resolved)) return
  visiting.add(resolved)
  let source: string
  try {
    source = await readFile(resolved, "utf8")
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new StandaloneParityInputError(`instruction include missing: ${resolved}`)
    }
    throw error
  }
  const lines: string[] = []
  for (const line of source.split(/\r?\n/u)) {
    const include = /^\s*@([^\s]+)\s*$/u.exec(line)?.[1]
    if (include === undefined) {
      lines.push(line)
      continue
    }
    await expandInstruction(resolveInclude(dirname(resolved), include), root, visiting, visited, output)
  }
  output.push(lines.join("\n"))
  visiting.delete(resolved)
  visited.add(resolved)
}

function resolveInclude(base: string, include: string): string {
  return include === "~" || include.startsWith("~/")
    ? resolve(homedir(), include.slice(2))
    : resolve(base, include)
}

async function loadMcps(paths: readonly string[]): Promise<readonly GeneratedMcp[]> {
  const mcps = new Map<string, GeneratedMcp>()
  for (const path of paths) {
    const value = parseJsonc(await readFile(path, "utf8"))
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new StandaloneParityInputError(`MCP config must be an object: ${path}`)
    const servers = Reflect.get(value, "mcpServers")
    if (servers === null || typeof servers !== "object" || Array.isArray(servers)) continue
    for (const [name, declaration] of Object.entries(servers)) {
      if (name === "context7" || name === "grep_app" || name === "_ast_grep") throw new StandaloneParityInputError(`native MCP collision: ${name}`)
      if (declaration === null || typeof declaration !== "object" || Array.isArray(declaration)) throw new StandaloneParityInputError(`invalid MCP declaration: ${name}`)
      const serialized = JSON.stringify(declaration)
      if (/(?:api[_-]?key|token|secret|authorization)\s*[":=]/iu.test(serialized) && !serialized.includes("${") && !serialized.includes("{env:")) {
        throw new StandaloneParityInputError(`literal secret rejected in MCP: ${name}`)
      }
      const type = Reflect.get(declaration, "type")
      if (type !== "http" && type !== "stdio") throw new StandaloneParityInputError(`unsupported MCP transport: ${name}`)
      if (type === "stdio") {
        const command = Reflect.get(declaration, "command")
        if (typeof command !== "string" || !executableExists(command)) {
          throw new StandaloneParityInputError(`MCP executable not found: ${name}`)
        }
      }
      const parsed = generatedMcpSchema.parse({ name, declaration })
      mcps.set(name, parsed)
    }
  }
  return [...mcps.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function executableExists(command: string): boolean {
  if (command.includes("/") || command.includes("\\")) return existsSync(command)
  return (process.env.PATH ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .some((directory) => directory.length > 0 && existsSync(join(directory, command)))
}

async function projectRouting(path: string | undefined, availableModels: readonly string[]): Promise<RoutingReport> {
  if (path === undefined) return { routes: { agents: {}, categories: {} }, optionalMisses: [] }
  const value = parseJsonc(await readFile(path, "utf8"))
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new StandaloneParityInputError("OpenCode routing config must be an object")
  const opencode = Reflect.get(value, "[opencode]")
  if (opencode === null || typeof opencode !== "object" || Array.isArray(opencode)) {
    return { routes: { agents: {}, categories: {} }, optionalMisses: [] }
  }
  const agentRoutes: Record<string, string> = {}
  const categoryRoutes: Record<string, string> = {}
  const optionalMisses: string[] = []
  const defaultRunAgent = Reflect.get(opencode, "default_run_agent")
  const agents = routeGroup(Reflect.get(opencode, "agents"), "agent")
  const categories = routeGroup(Reflect.get(opencode, "categories"), "category")
  for (const route of [...agents, ...categories]) {
    const candidates = route.model.startsWith("openai/")
      ? ["openai-codex", "chatgpt-subscription"].map((provider) => `${provider}/${route.model.slice("openai/".length)}`)
      : [route.model]
    const mapped = candidates.find((candidate) => availableModels.includes(candidate))
    if (mapped !== undefined) {
      const destination = route.kind === "agent" ? agentRoutes : categoryRoutes
      destination[route.key] = mapped
    }
    else if (route.kind === "agent" && route.key === defaultRunAgent) {
      throw new StandaloneParityInputError(`mandatory route unavailable: ${route.key}`)
    } else optionalMisses.push(route.kind === "category" ? `category:${route.key}` : route.key)
  }
  return { routes: { agents: agentRoutes, categories: categoryRoutes }, optionalMisses: optionalMisses.sort() }
}

function routeGroup(value: unknown, kind: "agent" | "category"): readonly { readonly key: string; readonly kind: "agent" | "category"; readonly model: string }[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value).flatMap(([key, declaration]) => {
    if (declaration === null || typeof declaration !== "object" || Array.isArray(declaration)) return []
    const model = Reflect.get(declaration, "model")
    return typeof model === "string" ? [{ key, kind, model }] : []
  })
}
