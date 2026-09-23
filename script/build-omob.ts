#!/usr/bin/env bun
// script/build-omob.ts
// Builds a single-file dev binary ("omob") from the latest tracked senpi (origin/main)
// and omo (origin/dev) commits and installs it under the omob name. Dev builds share
// ~/.omo state with a regular omo installation; only the binary and its provisioned
// runtime dir are namespaced by the commit pair.

import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync, renameSync, cpSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { versionLines, type OmoBuildInfo } from "../packages/omo-native/build-info"
import { installOmobLauncher, isCurrentOmobBuild } from "./omob-launcher"
import { writeProvenanceMarker } from "./omob-provenance"
import { pruneOmobRuntimes } from "./omob-runtime-prune"
import { resetSenpiWorkspaceInstalls } from "./omob-senpi-workspace-reset"
import { installSenpiTarball } from "./omob-senpi-install"
export { installOmobLauncher, isCurrentOmobBuild } from "./omob-launcher"

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
	readonly ifChanged: boolean
	readonly launcher: boolean
}

export function hostTargetFor(platform: string, arch: string): string {
	if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64"
	if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64"
	if (platform === "win32") return "windows-x64"
	throw new Error(`unsupported host platform: ${platform} ${arch}`)
}

const DEFAULT_SENPI_URL = "https://github.com/code-yeongyu/senpi.git"

export function parseOmobArgs(argv: readonly string[], platform: string, arch: string, homeDir: string): OmobOptions {
	const options: { senpiRef?: string; omoRef?: string; cacheDir?: string; installDir?: string; name?: string; target?: string; senpiUrl?: string; keep?: number; skipFetch: boolean; skipInstall: boolean; ifChanged: boolean; launcher: boolean; binaryOnly: boolean } = {
		senpiUrl: undefined,
		skipFetch: false,
		skipInstall: false,
		ifChanged: false,
		launcher: false,
		binaryOnly: false,
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
		} else if (argument === "--if-changed") {
			options.ifChanged = true
		} else if (argument === "--launcher") {
			options.launcher = true
		} else if (argument === "--binary-only") {
			options.binaryOnly = true
		} else {
			throw new Error(`unknown argument: ${argument}`)
		}
	}
	if (options.launcher && (options.binaryOnly || options.skipInstall)) throw new Error("--launcher conflicts with --binary-only and --skip-install")
	const launcher = options.launcher || (!options.binaryOnly && !options.skipInstall && platform !== "win32" && (options.name ?? "omob") === "omob")
	const mainline = (options.omoRef ?? "origin/dev") === "origin/dev" && (options.senpiRef ?? "origin/main") === "origin/main" && (options.senpiUrl ?? DEFAULT_SENPI_URL) === DEFAULT_SENPI_URL
	if (!mainline && (launcher || (!options.skipInstall && (options.name ?? "omob") === "omob"))) {
		throw new Error("the managed omob name requires origin/dev + origin/main; use --name omob-feature or --skip-install for feature builds")
	}
	return {
		senpiRef: options.senpiRef ?? "origin/main",
		omoRef: options.omoRef ?? "origin/dev",
		cacheDir: resolve(options.cacheDir ?? join(homeDir, ".cache", options.name ?? (mainline ? "omob" : "omob-feature"))),
		installDir: resolve(options.installDir ?? join(homeDir, ".local", "bin")),
		name: options.name ?? "omob",
		target: options.target ?? hostTargetFor(platform, arch),
		keep: options.keep ?? 2,
		senpiUrl: options.senpiUrl ?? DEFAULT_SENPI_URL,
		skipFetch: options.skipFetch,
		skipInstall: options.skipInstall,
		ifChanged: options.ifChanged || launcher,
		launcher,
	}
}

export function deriveOmobAiVersion(omoCommit: string, senpiCommit: string): string {
	return `0.0.0-omob.${omoCommit.slice(0, 7)}.${senpiCommit.slice(0, 7)}`
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
	const result = spawnSync(command, [...args], { cwd, stdio: "inherit", env })
	if (result.error !== undefined) throw result.error
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`)
}

function runAsync(command: string, args: readonly string[], cwd: string): Promise<void> {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, [...args], { cwd, stdio: "inherit" })
		child.on("error", rejectRun)
		child.on("close", (status, signal) => {
			if (status === 0) {
				resolveRun()
				return
			}
			const reason = signal === null ? `exit code ${status ?? 1}` : `signal ${signal}`
			rejectRun(new Error(`${command} ${args.join(" ")} failed with ${reason}`))
		})
	})
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
		// Serialize stale-owner reclamation too: two contenders must not unlink
		// a fresh claim after both observed the same dead owner.
		const reclaim = `${path}.reclaim`
		mkdirSync(reclaim)
		try {
			if (existsSync(path)) {
				const holder = Number.parseInt(readFileSync(path, "utf8").trim(), 10)
				if (!Number.isInteger(holder) || holder <= 0 || processIsAlive(holder)) {
					throw new Error(`another omob build is running (pid ${holder}); lock: ${path}. Wait for it to finish; an incomplete claim must not be stolen.`)
				}
				rmSync(path)
			}
			claim()
		} finally {
			rmSync(reclaim, { recursive: true })
		}
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

export interface CacheCloneSpec {
	readonly url: string
	readonly directory: string
	readonly ref: string
}

/**
 * A plain `origin/<branch>` narrows the fetch to that one refspec. Anything else — a raw SHA,
 * or a revision expression such as `origin/dev~1` — is not a refspec git can fetch, so fall
 * back to fetching every branch and resolving locally.
 */
export function fetchRefArgs(ref: string): string[] {
	const branch = ref.startsWith("origin/") ? ref.slice("origin/".length) : ""
	const isPlainBranch = branch !== "" && !/[~^:@\\]|\.\.|^-/.test(branch)
	return isPlainBranch ? ["--prune", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`] : ["--prune", "origin"]
}

/**
 * The two cache clones are independent repositories, so fetching them one after the other adds
 * a whole network round trip to every managed launch's refresh. Fetch them together.
 */
export async function fetchCacheClones(
	specs: readonly CacheCloneSpec[],
	fetchOne: (spec: CacheCloneSpec) => Promise<void> = (spec) => runAsync("git", ["fetch", ...fetchRefArgs(spec.ref)], spec.directory),
): Promise<void> {
	// Every fetch must finish before a failure is reported: the caller releases the cache lock and
	// exits on the error, and an abandoned `git fetch` would keep writing to that same cache.
	const results = await Promise.allSettled(specs.map((spec) => fetchOne(spec)))
	const failure = results.find((result) => result.status === "rejected")
	if (failure !== undefined && failure.status === "rejected") throw failure.reason
}

function ensureCloneExists(url: string, directory: string): void {
	mkdirSync(dirname(directory), { recursive: true })
	if (!existsSync(join(directory, ".git"))) {
		// --recurse-submodules bootstraps the submodules; the post-reset sync below is the
		// single place that points them at the requested ref, on this and every later run.
		run("git", ["clone", "--recurse-submodules", "--shallow-submodules", url, directory], dirname(directory))
	}
	const actualUrl = runCaptured("git", ["config", "--get", "remote.origin.url"], directory)
	if (actualUrl !== url) throw new Error(`cache origin mismatch at ${directory}: expected ${url}, found ${actualUrl}`)
}

export function ensureCacheClone(url: string, directory: string, ref: string, skipFetch: boolean, checkout = true): { readonly directory: string; readonly commit: string } {
	ensureCloneExists(url, directory)
	if (!skipFetch) {
		run("git", ["fetch", ...fetchRefArgs(ref)], directory)
	}
	if (!checkout) return { directory, commit: runCaptured("git", ["rev-parse", `${ref}^{commit}`], directory) }
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

// One `git log` answers both the commit and its date; every extra git process is ~11ms
// on the refresh path that each managed launch pays.
export function parseCommitLog(output: string): { readonly commit: string; readonly committedAt: string } {
	const [commit = "", committedAt = ""] = output.split("\n")
	return { commit: commit.trim(), committedAt: committedAt.trim() }
}

function readCommitInfo(directory: string, ref: string): CommitInfo {
	const { commit, committedAt } = parseCommitLog(runCaptured("git", ["log", "-1", "--format=%H%n%cI", `${ref}^{commit}`], directory))
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

interface SenpiArtifactCache {
	readonly commit: string
	readonly packageRoot: string
	readonly tarballName: string
}

function senpiArtifactCachePath(cacheDir: string, commit: string): string {
	return join(cacheDir, "artifacts", "senpi", commit, "manifest.json")
}

function readSenpiArtifactCache(cacheDir: string, commit: string): string | undefined {
	const manifestPath = senpiArtifactCachePath(cacheDir, commit)
	if (!existsSync(manifestPath)) return undefined
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<SenpiArtifactCache>
		if (manifest.commit !== commit || typeof manifest.packageRoot !== "string" || !existsSync(manifest.packageRoot)) return undefined
		return manifest.packageRoot
	} catch {
		return undefined
	}
}

function writeSenpiArtifactCache(cacheDir: string, artifact: SenpiArtifactCache): void {
	const manifestPath = senpiArtifactCachePath(cacheDir, artifact.commit)
	mkdirSync(dirname(manifestPath), { recursive: true })
	writeFileSync(manifestPath, `${JSON.stringify(artifact, undefined, "\t")}\n`)
}

export function resolveCachedSenpiPackage(cacheDir: string, commit: string): string | undefined {
	return readSenpiArtifactCache(cacheDir, commit)
}

async function buildSenpiPackage(senpiDir: string, cacheDir: string, commit: string): Promise<string> {
	const cached = readSenpiArtifactCache(cacheDir, commit)
	if (cached !== undefined) {
		console.error(`[omob] reusing senpi artifact ${commit}`)
		return cached
	}
	// The clone is reused and `git clean -ffd` keeps ignored dirs, so the previous build's publish
	// staging would shadow the workspace links this build's bundler resolves.
	const discarded = resetSenpiWorkspaceInstalls(senpiDir)
	if (discarded.length > 0) console.error(`[omob] discarded senpi publish staging: ${discarded.join(", ")}`)
	run("bun", ["install"], senpiDir)
	materializeNestedLockDeps(senpiDir)
	run("bun", ["run", "build:bun"], senpiDir)
	// Stage the bundled workspaces exactly like the release pipeline, then pack.
	run("node", [join("scripts", "prepare-senpi-bundled-workspaces.mjs")], senpiDir)
	const tarballDir = join(cacheDir, "tarballs")
	const tarballName = packSoleSenpiTarball(tarballDir, () =>
		run("bun", ["pm", "pack", "--destination", tarballDir], join(senpiDir, "packages", "coding-agent")),
	)
	const installRoot = join(cacheDir, "artifacts", "senpi", commit, "install")
	const packageRoot = await installSenpiTarball(resolve(tarballDir, tarballName), installRoot)
	writeSenpiArtifactCache(cacheDir, { commit, packageRoot, tarballName })
	return packageRoot
}

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

function swapSenpi(omoDir: string, builtSenpiRoot: string): void {
	const target = join(omoDir, "node_modules", "@code-yeongyu", "senpi")
	if (existsSync(target)) rmSync(target, { recursive: true, force: true })
	mkdirSync(dirname(target), { recursive: true })
	cpSync(builtSenpiRoot, target, { recursive: true })
	// Re-apply the launcher's claude-code version floor patch on the swapped engine.
	run("bun", [join("packages", "omo-native", "bin", "senpi-patch.mjs")], omoDir, { ...process.env, OMO_SENPI_PATCH_ROOT: target })
}

function installBinary(binaryPath: string, installDir: string, name: string, info: OmoBuildInfo): string {
	mkdirSync(installDir, { recursive: true })
	const destination = join(installDir, name)
	const temporary = `${destination}.tmp-${process.pid}`
	rmSync(temporary, { force: true })
	cpSync(binaryPath, temporary)
	chmodSync(temporary, 0o755)
	renameSync(temporary, destination)
	// Only after the executable is published, so the marker can never describe a build that
	// did not land; it is bound to this file's identity and re-verified on every read.
	writeProvenanceMarker(destination, versionLines(info).join("\n"))
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
	const omoUrl = "https://github.com/code-yeongyu/oh-my-openagent.git"
	console.error(`[omob] checking ${options.omoRef} + ${options.senpiRef}`)
	const senpiSpec: CacheCloneSpec = { url: senpiUrl, directory: join(options.cacheDir, "senpi"), ref: options.senpiRef }
	const omoSpec: CacheCloneSpec = { url: omoUrl, directory: join(options.cacheDir, "omo"), ref: options.omoRef }
	ensureCloneExists(senpiSpec.url, senpiSpec.directory)
	ensureCloneExists(omoSpec.url, omoSpec.directory)
	if (!options.skipFetch) await fetchCacheClones([senpiSpec, omoSpec])

	const senpiInfo = readCommitInfo(senpiSpec.directory, options.senpiRef)
	const omoInfo = readCommitInfo(omoSpec.directory, options.omoRef)
	const buildInfo: OmoBuildInfo = {
		command: options.name,
		omo: omoInfo,
		engine: { commit: senpiInfo.commit, committedAt: senpiInfo.committedAt, branch: senpiInfo.branch },
	}

	const installDir = options.launcher ? join(options.cacheDir, "bin") : options.installDir
	// The filename needs a Windows executable suffix; the command/provenance name does not.
	const installedName = options.target.startsWith("windows-") && !/\.exe$/i.test(options.name) ? `${options.name}.exe` : options.name
	if (options.ifChanged && !options.skipInstall && isCurrentOmobBuild(join(installDir, installedName), buildInfo, options.target)) {
		console.error(`[omob] current: omo ${omoInfo.commit} + senpi ${senpiInfo.commit}; no build needed`)
		if (options.launcher) installOmobLauncher(options)
		return 0
	}
	console.error(`[omob] building: omo ${omoInfo.commit} + senpi ${senpiInfo.commit}`)
	ensureCacheClone(senpiUrl, senpiSpec.directory, options.senpiRef, true)
	ensureCacheClone(omoUrl, omoSpec.directory, options.omoRef, true)
	const builtSenpiRoot = await buildSenpiPackage(senpiSpec.directory, options.cacheDir, senpiInfo.commit)
	// The omo prepare chain materializes gitignored plugin/skills from the shared-skills
	// upstream submodules; a caller's OMO_SKIP_MATERIALIZE=1 would skip that and break the
	// build, so the dev-binary install always runs the full materialization.
	const installEnv: NodeJS.ProcessEnv = { ...process.env }
	delete installEnv.OMO_SKIP_MATERIALIZE
	// `bun install` triggers the root prepare, which otherwise builds the whole product - the
	// OpenCode plugin bundle, the Codex Light plugin and its components, the CLI, the TUI,
	// schemas and declarations - none of which the compiled binary embeds. build-omo-native
	// builds the plugin payload it does embed, so the binary only needs the materialized
	// frontend from that chain.
	run("bun", ["install"], omoSpec.directory, { ...installEnv, OMO_BUILD_PROFILE: "omo-native" })
	swapSenpi(omoSpec.directory, builtSenpiRoot)

	// Imported here, not at module scope: the fast path returns above, and this module graph
	// (zod plus the sidecar fixture) is parsed on every managed launch otherwise.
	const { RELEASE_BINARY_TARGETS } = await import("./build-omo-binary")
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
		omoSpec.directory,
		installEnv,
	)
	const binaryPath = join(outDir, target.binaryName)
	if (!existsSync(binaryPath)) throw new Error(`build-omo-binary produced no binary at ${binaryPath}`)
	const result = { binaryPath, size: statSync(binaryPath).size }

	if (!options.skipInstall) {
		const installed = installBinary(result.binaryPath, installDir, installedName, buildInfo)
		if (options.launcher) console.error(`[omob] installed launcher ${installOmobLauncher(options)}`)
		console.log(`installed ${installed} (${result.size} bytes)`)
	}
	// Pruning is only safe once the new binary is in place: a --skip-install run would
	// otherwise delete the runtime a still-installed (possibly running) omob depends on.
	if (!options.skipInstall) pruneOmobRuntimes({ runtimeRoot: join(homedir(), ".omo", "binary-runtime"), keep: options.keep, currentVersion: omoAiVersion })
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
