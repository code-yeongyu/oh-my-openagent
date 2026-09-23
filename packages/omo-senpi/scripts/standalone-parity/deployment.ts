import { randomUUID } from "node:crypto"
import { cp, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"

import { standaloneParityManifestSchema, type StandaloneParityManifest, StandaloneParityInputError, StandaloneParityVerificationError } from "./contracts"
import { sha256 } from "./safe-files"

export interface DeploymentOptions {
  readonly stagingRoot: string
  readonly parityRoot: string
  readonly configPath: string
  readonly settingsPath?: string
  readonly overlay: string
  readonly afterMutation?: (boundary: DeploymentMutation) => void | Promise<void>
}

export interface RollbackOptions {
  readonly parityRoot: string
  readonly configPath: string
  readonly settingsPath?: string
}

export type DeploymentMutation = "journal" | "payload" | "config" | "settings"

type DeploymentJournal = {
  readonly version: 1
  readonly backupRoot: string
  readonly status: "in_progress" | "deployed"
}

export async function verifyStandaloneParity(root: string): Promise<StandaloneParityManifest> {
  const manifestPath = join(root, "manifest.json")
  const manifest = standaloneParityManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")))
  for (const [path, expected] of Object.entries(manifest.files)) {
    const candidate = resolve(root, path)
    if (!isInside(root, candidate)) throw new StandaloneParityVerificationError(`manifest path escapes payload: ${path}`)
    if ((await sha256(candidate)) !== expected) throw new StandaloneParityVerificationError(`hash mismatch: ${path}`)
  }
  return manifest
}

export async function deployStandaloneParity(options: DeploymentOptions): Promise<void> {
  const settingsPath = options.settingsPath ?? join(dirname(options.configPath), "agent", "settings.json")
  await verifyStandaloneParity(options.stagingRoot)
  await assertAllowedTargets(options.parityRoot, options.configPath, settingsPath)
  await recoverInterruptedDeployment(options.parityRoot, options.configPath, settingsPath)
  const payloadRoot = join(options.parityRoot, "current")
  const backupRoot = join(options.parityRoot, "backups", `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`)
  const journalPath = join(options.parityRoot, "journal.json")
  const stagedPayload = join(options.parityRoot, ".next")
  await rm(stagedPayload, { recursive: true, force: true })
  await cp(options.stagingRoot, stagedPayload, { recursive: true, dereference: false, errorOnExist: true })
  await verifyStandaloneParity(stagedPayload)
  await mkdir(backupRoot, { recursive: true })
  await snapshot(payloadRoot, join(backupRoot, "payload"))
  await snapshot(options.configPath, join(backupRoot, "omo.jsonc"))
  await snapshot(settingsPath, join(backupRoot, "settings.json"))
  let journalWritten = false
  try {
    await writeJournal(journalPath, { version: 1, backupRoot, status: "in_progress" })
    journalWritten = true
    await options.afterMutation?.("journal")
    await rm(payloadRoot, { recursive: true, force: true })
    await rename(stagedPayload, payloadRoot)
    await options.afterMutation?.("payload")
    await writeAtomic(options.configPath, options.overlay)
    await options.afterMutation?.("config")
    await activateParityPackage(settingsPath, join(payloadRoot, "package"))
    await options.afterMutation?.("settings")
    await writeJournal(journalPath, { version: 1, backupRoot, status: "deployed" })
  } catch (error: unknown) {
    if (journalWritten) await restoreDeployment(backupRoot, payloadRoot, options.configPath, settingsPath)
    await rm(stagedPayload, { recursive: true, force: true })
    await rm(journalPath, { force: true })
    throw error
  }
}

export async function rollbackStandaloneParity(options: RollbackOptions): Promise<void> {
  const settingsPath = options.settingsPath ?? join(dirname(options.configPath), "agent", "settings.json")
  await assertAllowedTargets(options.parityRoot, options.configPath, settingsPath)
  const journalPath = join(options.parityRoot, "journal.json")
  const journal = await readJournal(journalPath, options.parityRoot)
  const payloadRoot = join(options.parityRoot, "current")
  await restoreDeployment(journal.backupRoot, payloadRoot, options.configPath, settingsPath)
  await rm(join(options.parityRoot, ".next"), { recursive: true, force: true })
  await rm(journalPath, { force: true })
}

async function assertAllowedTargets(parityRoot: string, configPath: string, settingsPath: string): Promise<void> {
  const betaRoot = dirname(parityRoot)
  if (resolve(parityRoot) !== join(resolve(betaRoot), "standalone-parity")) {
    throw new StandaloneParityInputError(`payload root is not standalone-parity: ${parityRoot}`)
  }
  if (resolve(configPath) !== join(resolve(betaRoot), "home", ".omo", "omo.jsonc")) {
    throw new StandaloneParityInputError(`config path is outside beta home: ${configPath}`)
  }
  if (resolve(settingsPath) !== join(resolve(betaRoot), "home", ".omo", "agent", "settings.json")) {
    throw new StandaloneParityInputError(`settings path is outside beta home: ${settingsPath}`)
  }
  await rejectSymlinkSegments(betaRoot, parityRoot)
  await rejectSymlinkSegments(betaRoot, configPath)
  await rejectSymlinkSegments(betaRoot, settingsPath)
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), candidate)
  return rel.length > 0 && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
}

async function snapshot(source: string, destination: string): Promise<void> {
  const current = await stat(source, { throwIfNoEntry: false })
  if (current === undefined) return
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: current.isDirectory(), dereference: false, errorOnExist: true })
}

async function restore(source: string, destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true })
  const backup = await stat(source, { throwIfNoEntry: false })
  if (backup === undefined) return
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: backup.isDirectory(), dereference: false, errorOnExist: true })
}

async function restoreDeployment(backupRoot: string, payloadRoot: string, configPath: string, settingsPath: string): Promise<void> {
  await restore(join(backupRoot, "payload"), payloadRoot)
  await restore(join(backupRoot, "omo.jsonc"), configPath)
  await restore(join(backupRoot, "settings.json"), settingsPath)
}

async function recoverInterruptedDeployment(parityRoot: string, configPath: string, settingsPath: string): Promise<void> {
  const journalPath = join(parityRoot, "journal.json")
  if ((await stat(journalPath, { throwIfNoEntry: false })) === undefined) return
  const journal = await readJournal(journalPath, parityRoot)
  if (journal.status !== "in_progress") return
  await restoreDeployment(journal.backupRoot, join(parityRoot, "current"), configPath, settingsPath)
  await rm(join(parityRoot, ".next"), { recursive: true, force: true })
  await rm(journalPath, { force: true })
}

async function readJournal(path: string, parityRoot: string): Promise<DeploymentJournal> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"))
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new StandaloneParityVerificationError("invalid deployment journal")
  }
  const version = Reflect.get(value, "version")
  const backupRoot = Reflect.get(value, "backupRoot")
  const status = Reflect.get(value, "status")
  if (version !== 1 || typeof backupRoot !== "string" || (status !== "in_progress" && status !== "deployed")) {
    throw new StandaloneParityVerificationError("invalid deployment journal")
  }
  if (!isInside(join(parityRoot, "backups"), backupRoot)) {
    throw new StandaloneParityVerificationError("deployment journal backup escapes parity root")
  }
  return { version, backupRoot, status }
}

async function writeJournal(path: string, journal: DeploymentJournal): Promise<void> {
  await writeAtomic(path, JSON.stringify(journal))
}

async function rejectSymlinkSegments(root: string, target: string): Promise<void> {
  const rel = relative(resolve(root), resolve(target))
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new StandaloneParityInputError(`target escapes beta root: ${target}`)
  }
  let current = resolve(root)
  for (const segment of rel.split(process.platform === "win32" ? "\\" : "/").filter(Boolean)) {
    current = join(current, segment)
    const entry = await lstat(current).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    if (entry?.isSymbolicLink()) throw new StandaloneParityInputError(`symlink target rejected: ${current}`)
    if (entry === undefined) return
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const next = `${path}.next`
  await rm(next, { recursive: true, force: true })
  await writeFile(next, content)
  await rename(next, path)
}

async function activateParityPackage(settingsPath: string, packagePath: string): Promise<void> {
  const existing = await readTextIfPresent(settingsPath) ?? "{}"
  const errors: ParseError[] = []
  const settings = parse(existing, errors)
  if (errors.length > 0 || settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    throw new StandaloneParityInputError("isolated beta settings must be an object")
  }
  const packages = Reflect.get(settings, "packages")
  if (packages !== undefined && (!Array.isArray(packages) || !packages.every((value) => typeof value === "string"))) {
    throw new StandaloneParityInputError("isolated beta settings packages must be a string array")
  }
  const nextPackages = packages === undefined
    ? [packagePath]
    : packages.includes(packagePath) ? packages : [...packages, packagePath]
  const edits = modify(existing, ["packages"], nextPackages, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  })
  await writeAtomic(settingsPath, applyEdits(existing, edits))
}

async function readTextIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}
