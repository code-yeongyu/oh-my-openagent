// script/omob-keychain-helper.ts
// Builds the keychain helper a compiled darwin omob binary embeds. build-omo-binary.ts fails a
// darwin target without packages/omo-native/bin/darwin/omo-keychain, which the release lane fills
// with the signed helper; a dev build compiles an unsigned one in the cache clone instead. That copy
// fails the helper's requirement check, so the runtime never uses it.

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

const BUILD_SCRIPT = join("packages", "omo-native", "keychain-helper", "build.ts")
const HELPER_SOURCE = join("packages", "omo-native", "bin", "darwin", "omo-keychain")

export type KeychainHelperOutcome = "skipped" | "built"

export function keychainHelperBuildArgs(repoRoot: string): string[] {
	return [join(repoRoot, BUILD_SCRIPT), "--out", join(repoRoot, HELPER_SOURCE)]
}

export function ensureKeychainHelper(
	repoRoot: string,
	target: string,
	run: (command: string, args: readonly string[], cwd: string) => number = (command, args, cwd) => {
		const result = spawnSync(command, args, { cwd, stdio: "inherit" })
		if (result.error !== undefined) throw result.error
		return result.status ?? 1
	},
	log: (line: string) => void = (line) => console.error(line),
): KeychainHelperOutcome {
	if (!target.startsWith("darwin-") || !existsSync(join(repoRoot, BUILD_SCRIPT))) return "skipped"
	log(`[omob] building the unsigned keychain helper ${HELPER_SOURCE}`)
	const status = run("bun", keychainHelperBuildArgs(repoRoot), repoRoot)
	if (status !== 0) throw new Error(`keychain helper build failed with exit code ${status} (it needs clang from the Xcode command line tools)`)
	return "built"
}
