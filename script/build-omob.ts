#!/usr/bin/env bun
// script/build-omob.ts
// Builds a single-file dev binary ("omob") from the latest tracked senpi (origin/main)
// and omo (origin/dev) commits and installs it under the omob name. Dev builds share
// ~/.omo state with a regular omo installation; only the binary and its provisioned
// runtime dir are namespaced by the commit pair.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync, renameSync, cpSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseBuildInfo, versionLines, type OmoBuildInfo } from "../packages/omo-native/build-info"
import { RELEASE_BINARY_TARGETS } from "./build-omo-binary"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")

export interface OmobOptions {
	readonly senpiRef: string
	readonly omoRef: string
	readonly cacheDir: string
	readonly installDir: string
	readonly name: string
	readonly target: string
	readonly keep: number
	readonly senpiUrl: string
	readonly skipFetch: boolean
	readonly skipInstall: boolean
}

export function hostTargetFor(platform: string, arch: string): string {
	if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64"
	if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64"
	if (platform === "win32") return "windows-x64"
	throw new Error(`unsupported host platform: ${platform} ${arch}`)
}

const DEFAULT_SENPI_URL = "https://github.com/code-yeongyu/senpi.git"

export function parseOmobArgs(argv: readonly string[], platform: string, arch: string, homeDir: string): OmobOptions {
	const options: { senpiRef?: string; omoRef?: string; cacheDir?: string; installDir?: string; name?: string; target?: string; senpiUrl?: string; keep?: number; skipFetch: boolean; skipInstall: boolean } = {
		senpiUrl: undefined,
		skipFetch: false,
		skipInstall: false,
	}
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		const value = argv[index + 1]
		if (argument === "--senpi-ref" || argument === "--omo-ref" || argument === "--cache-dir" || argument === "--install-dir" || argument === "--name" || argument === "--target" || argument === "--senpi-url") {
			if (value === undefined) throw new Error(`${argument} requires a value`)
			const normalizedKey = argument === "--senpi-ref" ? "senpiRef" : argument === "--omo-ref" ? "omoRef" : argument === "--cache-dir" ? "cacheDir" : argument === "--install-dir" ? "installDir" : argument === "--name" ? "name" : argument === "--senpi-url" ? "senpiUrl" : "target"
			;(options as Record<string, unknown>)[normalizedKey] = value
			index += 1
		} else if (argument === "--keep") {
			if (value === undefined) throw new Error("--keep requires a value")
			const keep = Number.parseInt(value, 10)
			if (!Number.isInteger(keep) || keep < 0) throw new Error("--keep must be a non-negative integer")
			options.keep = keep
			index += 1
		} else if (argument === "--skip-fetch") {
			options.skipFetch = true
		} else if (argument === "--skip-install") {
			options.skipInstall = true
		} else {
			throw new Error(`unknown argument: ${argument}`)
		}
	}
	return {
		senpiRef: options.senpiRef ?? "origin/main",
		omoRef: options.omoRef ?? "origin/dev",
		cacheDir: options.cacheDir ?? join(homeDir, ".cache", "omob"),
		installDir: options.installDir ?? join(homeDir, ".local", "bin"),
		name: options.name ?? "omob",
		target: options.target ?? hostTargetFor(platform, arch),
		keep: options.keep ?? 2,
		senpiUrl: options.senpiUrl ?? DEFAULT_SENPI_URL,
		skipFetch: options.skipFetch,
		skipInstall: options.skipInstall,
	}
}

export function deriveOmobAiVersion(omoCommit: string, senpiCommit: string): string {
	return `0.0.0-omob.${omoCommit.slice(0, 7)}.${senpiCommit.slice(0, 7)}`
}

export interface PruneEntry {
	readonly name: string
	readonly mtimeMs: number
}

const OMOB_RUNTIME_PREFIX = "0.0.0-omob."

export function isOmobRuntimeDir(name: string): boolean {
	return name.startsWith(OMOB_RUNTIME_PREFIX)
}

/**
 * Prune plan for a build about to provision `currentVersion`: that version owns one
 * of the `keep` slots (whether or not its dir exists yet), so only `keep - 1` OTHER
 * dev runtimes survive. Release runtimes are never touched.
 */
export function planRuntimePrune(entries: readonly PruneEntry[], keep: number, currentVersion: string): string[] {
	const others = entries.filter((entry) => entry.name !== currentVersion)
	return selectPruneEntries(others, Math.max(0, keep - 1))
}

/** Names of dev runtime dirs to delete: omob dirs beyond the newest `keep`. Release runtimes are never touched. */
export function selectPruneEntries(entries: readonly PruneEntry[], keep: number): string[] {
	const omob = entries.filter((entry) => isOmobRuntimeDir(entry.name))
	const sorted = omob.slice().sort((left, right) => right.mtimeMs - left.mtimeMs)
	return sorted.slice(Math.max(0, keep)).reverse().map((entry) => entry.name)
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
	const result = spawnSync(command, [...args], { cwd, stdio: "inherit", env })
	if (result.error !== undefined) throw result.error
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`)
}

function runCaptured(command: string, args: readonly string[], cwd: string): string {
	const result = spawnSync(command, [...args], { cwd, encoding: "utf8" })
	if (result.error !== undefined) throw result.error
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}:\n${result.stdout}\n${result.stderr}`)
	return result.stdout.trim()
}

export interface CacheLock {
	readonly path: string
	release(): void
}

/** True when a process with this pid exists; signal 0 only probes. */
function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

/**
 * Takes an exclusive lock on the shared build cache. The clone, isolated install, tarball
 * directory and output directory are all shared mutable state, so two concurrent builds
 * would interleave and could pack one run's engine under another run's provenance stamp.
 * Fail fast instead, naming the holder. A lock left by a dead process is reclaimed.
 */
export function acquireCacheLock(cacheDir: string, pid: number = process.pid): CacheLock {
	mkdirSync(cacheDir, { recursive: true })
	const path = join(cacheDir, ".lock")
	const claim = (): void => writeFileSync(path, `${pid}\n`, { flag: "wx" })
	try {
		claim()
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
		const holder = Number.parseInt(readFileSync(path, "utf8").trim(), 10)
		if (Number.isFinite(holder) && holder !== pid && processIsAlive(holder)) {
			throw new Error(
				`another omob build is running (pid ${holder}); lock: ${path}. Wait for it to finish, or remove the lock if that process is gone.`,
			)
		}
		// Stale lock: the owner died without releasing it.
		rmSync(path, { force: true })
		claim()
	}
	let released = false
	const release = (): void => {
		if (released) return
		released = true
		try {
			if (existsSync(path) && readFileSync(path, "utf8").trim() === String(pid)) rmSync(path, { force: true })
		} catch {
			// A best-effort release must never mask the build's own outcome.
		}
	}
	return { path, release }
}

export function ensureCacheClone(url: string, directory: string, ref: string, skipFetch: boolean): { readonly directory: string; readonly commit: string } {
	mkdirSync(dirname(directory), { recursive: true })
	if (!existsSync(join(directory, ".git"))) {
		// --recurse-submodules bootstraps the submodules; the post-reset sync below is the
		// single place that points them at the requested ref, on this and every later run.
		run("git", ["clone", "--recurse-submodules", "--shallow-submodules", url, directory], dirname(directory))
	}
	if (!skipFetch) {
		// A plain `origin/<branch>` narrows the fetch to that one refspec. Anything else —
		// a raw SHA, or a revision expression such as `origin/dev~1` — is not a refspec git
		// can fetch, so fall back to fetching every branch and resolving locally.
		const branch = ref.startsWith("origin/") ? ref.slice("origin/".length) : ""
		const isPlainBranch = branch !== "" && !/[~^:@\\]|\.\.|^-/.test(branch)
		const fetchArgs = isPlainBranch ? ["--prune", "origin", branch] : ["--prune", "origin"]
		run("git", ["fetch", ...fetchArgs], directory)
	}
	// A cache checkout must land on the exact ref tree: drop leftovers from a previous
	// ref (tracked deletions, staged swaps). `clean -ffd` deliberately omits `-x`, so
	// ignored build outputs and node_modules survive for cache reuse.
	run("git", ["clean", "-ffd"], directory)
	run("git", ["checkout", "--force", ref], directory)
	run("git", ["reset", "--hard", ref], directory)
	// checkout/reset do not recurse, so submodule pointers only match the ref AFTER it
	// lands; omo materializes plugin skills from these upstreams during its build.
	run("git", ["submodule", "update", "--init", "--recursive", "--force"], directory)
	const commit = runCaptured("git", ["rev-parse", "HEAD"], directory)
	return { directory, commit }
}

interface CommitInfo {
	readonly commit: string
	readonly committedAt: string
	readonly branch: string
}

function readCommitInfo(directory: string, ref: string): CommitInfo {
	const commit = runCaptured("git", ["rev-parse", "HEAD"], directory)
	const committedAt = runCaptured("git", ["log", "-1", "--format=%cI"], directory)
	const rawBranch = runCaptured("git", ["rev-parse", "--abbrev-ref", ref], directory).trim()
	const branch = (rawBranch === "HEAD" || rawBranch === "" ? ref : rawBranch).replace(/^origin\//, "")
	return { commit, committedAt, branch }
}

/**
 * Packs senpi into an empty directory and returns the sole tarball name.
 *
 * The tarball name carries senpi's package version, so a reused cache that kept the previous
 * version's tarball would offer two candidates; picking either arbitrarily can install the OLD
 * engine under the NEW provenance stamp. Start empty and require exactly one result.
 */
export function packSoleSenpiTarball(tarballDir: string, pack: () => void): string {
	rmSync(tarballDir, { recursive: true, force: true })
	mkdirSync(tarballDir, { recursive: true })
	pack()
	// readdirSync order is filesystem-defined; sort so the diagnostic is reproducible.
	const tarballs = readdirSync(tarballDir)
		.filter((name) => name.endsWith(".tgz"))
		.sort()
	if (tarballs.length !== 1) {
		throw new Error(`expected exactly one senpi tarball in ${tarballDir}, found ${tarballs.length}: ${tarballs.join(", ")}`)
	}
	return tarballs[0] as string
}

function buildSenpiPackage(senpiDir: string, cacheDir: string): string {
	run("bun", ["install"], senpiDir)
	materializeNestedLockDeps(senpiDir)
	run("bun", ["run", "build:bun"], senpiDir)
	// Stage the bundled workspaces exactly like the release pipeline, then pack.
	run("node", [join("scripts", "prepare-senpi-bundled-workspaces.mjs")], senpiDir)
	const tarballDir = join(cacheDir, "tarballs")
	const tarballName = packSoleSenpiTarball(tarballDir, () =>
		run("bun", ["pm", "pack", "--destination", tarballDir], join(senpiDir, "packages", "coding-agent")),
	)
	// Isolated production install: the tarball plus its registry deps, resolved under
	// a dedicated root so the resulting tree can be dropped into omo's node_modules.
	const installRoot = join(cacheDir, "senpi-install")
	rmSync(installRoot, { recursive: true, force: true })
	mkdirSync(installRoot, { recursive: true })
	writeFileSync(join(installRoot, "package.json"), `${JSON.stringify({ private: true, dependencies: { "@code-yeongyu/senpi": `file:../tarballs/${tarballName}` } }, undefined, "\t")}\n`)
	run("bun", ["install", "--production", "--ignore-scripts"], installRoot)
	nestHoistedDeps(installRoot)
	return join(installRoot, "node_modules", "@code-yeongyu", "senpi")
}

/** Moves the isolated install's hoisted deps under the senpi package, mirroring the published nested layout. */
/**
 * senpi's publish staging (prepare-senpi-bundled-workspaces.mjs) reads npm lock
 * entries shaped "packages/<workspace>/node_modules/<pkg>" and expects those
 * packages installed INSIDE the workspace directory. A bun workspace install
 * hoists everything, so materialize the nested layout from the lock: every
 * package the lock nests under a workspace is copied from the hoisted root
 * install into <workspace>/node_modules.
 */
function materializeNestedLockDeps(senpiRoot: string): void {
	const lockPath = join(senpiRoot, "package-lock.json")
	if (!existsSync(lockPath)) throw new Error("senpi cache clone has no package-lock.json")
	const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
		packages?: Record<string, { optional?: boolean }>
	}
	const rootNm = join(senpiRoot, "node_modules")
	for (const entry of Object.keys(lock.packages ?? {})) {
		// Shape: packages/<workspace>/node_modules/<pkg> — skip root-level deps, workspace manifests, and anything deeper.
		const match = /^packages\/([^/]+)\/node_modules\/(.+)$/.exec(entry)
		if (match === null) continue
		const [, workspaceName, pkgName] = match
		if (pkgName.includes("node_modules/")) continue
		const optional = lock.packages?.[entry]?.optional === true
		const sourcePath = join(rootNm, pkgName)
		if (!existsSync(sourcePath)) {
			if (optional) continue
			throw new Error(`bun install produced no hoisted ${pkgName} required by packages/${workspaceName} (lock entry ${entry})`)
		}
		const nestedPath = join(senpiRoot, "packages", workspaceName, "node_modules", pkgName)
		if (existsSync(nestedPath)) continue
		mkdirSync(dirname(nestedPath), { recursive: true })
		cpSync(sourcePath, nestedPath, { recursive: true })
	}
}

function nestHoistedDeps(installRoot: string): void {
	const senpiNodeModules = join(installRoot, "node_modules", "@code-yeongyu", "senpi", "node_modules")
	const topLevel = join(installRoot, "node_modules")
	mkdirSync(senpiNodeModules, { recursive: true })
	for (const entry of readdirSync(topLevel)) {
		if (entry.startsWith(".") || entry === "@code-yeongyu") continue
		// A scope directory may already exist under the package from bundling; moving the
		// whole scope would silently drop its hoisted siblings, so merge child by child.
		if (entry.startsWith("@")) {
			const scopeTarget = join(senpiNodeModules, entry)
			mkdirSync(scopeTarget, { recursive: true })
			for (const child of readdirSync(join(topLevel, entry))) {
				const childTarget = join(scopeTarget, child)
				if (existsSync(childTarget)) continue
				renameSync(join(topLevel, entry, child), childTarget)
			}
			continue
		}
		const from = join(topLevel, entry)
		const to = join(senpiNodeModules, entry)
		if (existsSync(to)) continue
		renameSync(from, to)
	}
}

function swapSenpi(omoDir: string, builtSenpiRoot: string): void {
	const target = join(omoDir, "node_modules", "@code-yeongyu", "senpi")
	if (existsSync(target)) rmSync(target, { recursive: true, force: true })
	mkdirSync(dirname(target), { recursive: true })
	cpSync(builtSenpiRoot, target, { recursive: true })
	// Re-apply the launcher's claude-code version floor patch on the swapped engine.
	run("bun", [join("packages", "omo-native", "bin", "senpi-patch.mjs")], omoDir, { ...process.env, OMO_SENPI_PATCH_ROOT: target })
}

function pruneOmobRuntimes(keep: number, currentVersion: string): void {
	const runtimeRoot = join(homedir(), ".omo", "binary-runtime")
	if (!existsSync(runtimeRoot)) return
	const entries: PruneEntry[] = readdirSync(runtimeRoot).map((name) => {
		const stats = statSync(join(runtimeRoot, name))
		return { name, mtimeMs: stats.mtimeMs }
	})
	for (const name of planRuntimePrune(entries, keep, currentVersion)) {
		rmSync(join(runtimeRoot, name), { recursive: true, force: true })
		console.log(`pruned dev runtime ${name}`)
	}
}

function installBinary(binaryPath: string, installDir: string, name: string): string {
	mkdirSync(installDir, { recursive: true })
	const destination = join(installDir, name)
	const temporary = `${destination}.tmp-${process.pid}`
	rmSync(temporary, { force: true })
	cpSync(binaryPath, temporary)
	chmodSync(temporary, 0o755)
	renameSync(temporary, destination)
	return destination
}

async function main(argv: readonly string[]): Promise<number> {
	const options = parseOmobArgs(argv, process.platform, process.arch, homedir())
	const lock = acquireCacheLock(options.cacheDir)
	const releaseOnExit = (): void => lock.release()
	process.once("exit", releaseOnExit)
	try {
		return await runBuild(options)
	} finally {
		process.off("exit", releaseOnExit)
		lock.release()
	}
}

async function runBuild(options: OmobOptions): Promise<number> {
	const senpiUrl = options.senpiUrl ?? DEFAULT_SENPI_URL
	const senpi = ensureCacheClone(senpiUrl, join(options.cacheDir, "senpi"), options.senpiRef, options.skipFetch)
	const omo = ensureCacheClone(runCaptured("git", ["remote", "get-url", "origin"], repoRoot), join(options.cacheDir, "omo"), options.omoRef, options.skipFetch)

	const senpiInfo = readCommitInfo(senpi.directory, options.senpiRef)
	const omoInfo = readCommitInfo(omo.directory, options.omoRef)
	const buildInfo: OmoBuildInfo = {
		command: options.name,
		omo: omoInfo,
		engine: { commit: senpiInfo.commit, committedAt: senpiInfo.committedAt, branch: senpiInfo.branch },
	}

	const builtSenpiRoot = buildSenpiPackage(senpi.directory, options.cacheDir)
	// The omo prepare chain materializes gitignored plugin/skills from the shared-skills
	// upstream submodules; a caller's OMO_SKIP_MATERIALIZE=1 would skip that and break the
	// build, so the dev-binary install always runs the full materialization.
	const installEnv: NodeJS.ProcessEnv = { ...process.env }
	delete installEnv.OMO_SKIP_MATERIALIZE
	run("bun", ["install"], omo.directory, installEnv)
	swapSenpi(omo.directory, builtSenpiRoot)

	const target = RELEASE_BINARY_TARGETS.find((entry) => entry.target === options.target)
	if (target === undefined) throw new Error(`unknown target: ${options.target}`)
	const omoAiVersion = deriveOmobAiVersion(omoInfo.commit, senpiInfo.commit)
	const outDir = join(options.cacheDir, "out")
	rmSync(outDir, { recursive: true, force: true })
	// Build INSIDE the cache clone: build-omo-binary.ts derives repoRoot from its own
	// location, so only the clone's script sees the swapped engine + the clone's install.
	run(
		"bun",
		[
			"run",
			join("script", "build-omo-binary.ts"),
			"--target",
			target.target,
			"--omo-version",
			omoAiVersion,
			"--omo-ai-version",
			omoAiVersion,
			"--out-dir",
			outDir,
			"--build-info",
			JSON.stringify(buildInfo),
		],
		omo.directory,
		installEnv,
	)
	const binaryPath = join(outDir, target.binaryName)
	if (!existsSync(binaryPath)) throw new Error(`build-omo-binary produced no binary at ${binaryPath}`)
	const result = { binaryPath, size: statSync(binaryPath).size }

	if (!options.skipInstall) {
		const installed = installBinary(result.binaryPath, options.installDir, options.name)
		console.log(`installed ${installed} (${result.size} bytes)`)
	}
	// Pruning is only safe once the new binary is in place: a --skip-install run would
	// otherwise delete the runtime a still-installed (possibly running) omob depends on.
	if (!options.skipInstall) pruneOmobRuntimes(options.keep, omoAiVersion)
	// versionLines is the single formatter for provenance output; --version, doctor, the
	// startup banner and this summary must never drift apart.
	console.log(versionLines(buildInfo).join("\n"))
	return 0
}

if (import.meta.main) {
	try {
		process.exit(await main(process.argv.slice(2)))
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
