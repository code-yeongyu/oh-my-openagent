// script/omob-desktop-engine.ts
// Builds the Rust desktop engine a compiled omob binary embeds. build-omo-binary.ts stages
// `target/<rust-triple>/release/senpi-desktop-engine[.exe]` from the omo cache clone and fails
// when a declared-available target has none, so the dev build has to produce it the way the
// release workflows do (publish-platform.yml, desktop-engine.yml) - and skip cargo entirely
// when nothing the engine is built from changed since the last build.

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { desktopEngineRustTarget, loadDesktopEngineTargets } from "./release-desktop-engine-target"

export const DESKTOP_ENGINE_SOURCE_PATHS = ["crates", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml"] as const

const FIXTURE = join("script", "release-desktop-engine-fixture.json")

export function desktopEngineCargoArgs(rustTarget: string): string[] {
	return ["build", "--release", "-p", "senpi-desktop-engine", "--locked", "--target", rustTarget]
}

// One cargo call per package, as the release workflows build them: a shared call would unify
// dependency features across both packages (resolver 2) and build an engine release never ships.
interface CargoCall {
	readonly args: readonly string[]
	readonly rustflags?: string
}

/** Per-package RUSTFLAGS the release workflows build with (publish-platform.yml); every other package gets none. */
const RELEASE_RUSTFLAGS: Readonly<Record<string, string>> = { "omo-git-job-helper": "-C target-feature=+crt-static" }

function desktopEngineCargoCalls(rustTarget: string, helperPackages: readonly string[]): CargoCall[] {
	return [
		{ args: desktopEngineCargoArgs(rustTarget) },
		...helperPackages.map((name) => ({ args: ["build", "--release", "-p", name, "--locked", "--target", rustTarget], rustflags: RELEASE_RUSTFLAGS[name] })),
	]
}

function describeCall(call: CargoCall): string {
	return call.rustflags === undefined ? call.args.join(" ") : `RUSTFLAGS=${call.rustflags} ${call.args.join(" ")}`
}

/**
 * Identifies the engine inputs of the checked-out commit. The cache clone is reset to its ref
 * before every build, so the committed tree ids are exact and cost one git process.
 */
export function desktopEngineFingerprint(repoRoot: string, rustTarget: string, helperPackages: readonly string[] = []): string {
	const result = spawnSync("git", ["ls-tree", "HEAD", "--", ...DESKTOP_ENGINE_SOURCE_PATHS], { cwd: repoRoot, encoding: "utf8" })
	if (result.error !== undefined) throw result.error
	if (result.status !== 0) throw new Error(`git ls-tree failed in ${repoRoot}: ${result.stderr.trim()}`)
	if (result.stdout.trim() === "") throw new Error(`no desktop engine sources (${DESKTOP_ENGINE_SOURCE_PATHS.join(", ")}) at HEAD in ${repoRoot}`)
	const calls = desktopEngineCargoCalls(rustTarget, helperPackages).map(describeCall).join("\n")
	return createHash("sha256").update(calls).update("\n").update(result.stdout).digest("hex")
}

interface DesktopEngineStamp {
	readonly fingerprint: string
	readonly size: number
	readonly mtimeMs: number
}

function binaryIdentity(binary: string): { readonly size: number; readonly mtimeMs: number } | undefined {
	try {
		const stats = statSync(binary)
		return stats.isFile() ? { size: stats.size, mtimeMs: stats.mtimeMs } : undefined
	} catch {
		return undefined
	}
}

function stampMatches(stampPath: string, binary: string, fingerprint: string): boolean {
	const identity = binaryIdentity(binary)
	if (identity === undefined || !existsSync(stampPath)) return false
	try {
		const stamp = JSON.parse(readFileSync(stampPath, "utf8")) as Partial<DesktopEngineStamp>
		return stamp.fingerprint === fingerprint && stamp.size === identity.size && stamp.mtimeMs === identity.mtimeMs
	} catch {
		return false
	}
}

export type DesktopEngineOutcome = "skipped" | "reused" | "built"

/**
 * Makes sure the omo checkout at `repoRoot` holds the desktop engine build-omo-binary stages for
 * `target`. Availability comes from that checkout's own fixture, so the step matches what its
 * build-omo-binary will demand; a checkout that predates the engine needs nothing.
 */
export function ensureDesktopEngine(
	repoRoot: string,
	target: string,
	env: NodeJS.ProcessEnv = process.env,
	log: (line: string) => void = (line) => console.error(line),
): DesktopEngineOutcome {
	const fixturePath = join(repoRoot, FIXTURE)
	if (!existsSync(fixturePath)) return "skipped"
	const entry = loadDesktopEngineTargets(JSON.parse(readFileSync(fixturePath, "utf8"))).find((candidate) => candidate.target === target)
	if (entry === undefined) throw new Error(`unknown desktop engine target: ${target}`)
	if (entry.source === null || entry.host === null) {
		log(`[omob] ${target} ships no desktop engine; skipping cargo`)
		return "skipped"
	}
	const rustTarget = desktopEngineRustTarget(entry.host)
	const binary = join(repoRoot, entry.source)
	// A checkout that carries a helper crate also stages that helper from the same target directory as the engine: the
	// engine trust helper on Darwin and Windows hosts (omo#10762), the git job helper on Windows hosts (omo#10391).
	const windows = entry.host.startsWith("win32-")
	const exe = windows ? ".exe" : ""
	const helpers = [
		{ packageName: "omo-engine-trust-helper", label: "engine trust helper", ships: windows || entry.host.startsWith("darwin-") },
		{ packageName: "omo-git-job-helper", label: "git job helper", ships: windows },
	]
		.filter((helper) => helper.ships && existsSync(join(repoRoot, "crates", helper.packageName)))
		.map((helper) => ({ ...helper, path: join(dirname(binary), `${helper.packageName}${exe}`) }))
	const helperPackages = helpers.map((helper) => helper.packageName)
	const stampPath = `${binary}.omob-build.json`
	const fingerprint = desktopEngineFingerprint(repoRoot, rustTarget, helperPackages)
	if (stampMatches(stampPath, binary, fingerprint) && helpers.every((helper) => binaryIdentity(helper.path) !== undefined)) {
		log(`[omob] reusing desktop engine ${entry.source}`)
		return "reused"
	}
	rmSync(stampPath, { force: true })
	const calls = desktopEngineCargoCalls(rustTarget, helperPackages)
	for (const call of calls) {
		const args = [...call.args]
		log(`[omob] building desktop engine: cargo ${describeCall(call)}`)
		// build-omo-binary stages from <repoRoot>/target; a caller's CARGO_TARGET_DIR would build elsewhere.
		const callEnv = { ...env, CARGO_TARGET_DIR: join(repoRoot, "target"), ...(call.rustflags === undefined ? {} : { RUSTFLAGS: call.rustflags }) }
		const result = spawnSync("cargo", args, { cwd: repoRoot, stdio: "inherit", env: callEnv })
		if (result.error !== undefined) {
			if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`omob needs a Rust toolchain to build the desktop engine for ${target}: cargo is not on PATH (install Rust from https://rustup.rs)`)
			}
			throw result.error
		}
		if (result.status !== 0) {
			throw new Error(`cargo ${args.join(" ")} failed with exit code ${result.status ?? 1} (a missing Rust target installs with: rustup target add ${rustTarget})`)
		}
	}
	const identity = binaryIdentity(binary)
	if (identity === undefined) throw new Error(`cargo ${desktopEngineCargoArgs(rustTarget).join(" ")} produced no desktop engine at ${binary}`)
	for (const helper of helpers) {
		if (binaryIdentity(helper.path) === undefined) {
			throw new Error(`cargo build --release -p ${helper.packageName} --locked --target ${rustTarget} produced no ${helper.label} at ${helper.path}`)
		}
	}
	const stamp: DesktopEngineStamp = { fingerprint, ...identity }
	writeFileSync(stampPath, `${JSON.stringify(stamp)}\n`)
	return "built"
}
