import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { versionLines, type OmoBuildInfo } from "../packages/omo-native/build-info"
import type { OmobOptions } from "./build-omob"

export function isCurrentOmobBuild(binary: string, info: OmoBuildInfo, target: string): boolean {
	const host = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
	if (target !== host || !existsSync(binary)) return false
	// Read provenance from the executable, not a sidecar that can outlive a failed install.
	const result = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 30_000 })
	return result.status === 0 && result.stdout.trim() === versionLines(info).join("\n")
}

export function installOmobLauncher(options: OmobOptions): string {
	if (process.platform === "win32") throw new Error("the omob auto-update launcher requires a POSIX shell")
	const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`
	const binDir = join(options.cacheDir, "bin")
	const args = [join(options.cacheDir, "omo", "script", "build-omob.ts"), "--if-changed", "--binary-only", "--cache-dir", options.cacheDir, "--install-dir", binDir, "--name", options.name, "--target", options.target, "--keep", String(options.keep)]
	const destination = join(options.installDir, options.name)
	const temporary = `${destination}.tmp-${process.pid}`
	mkdirSync(options.installDir, { recursive: true })
	writeFileSync(temporary, `#!/bin/sh\n# Refresh must succeed before the engine can claim to be current.\nbun ${args.map(quote).join(" ")} >&2\nstatus=$?\n[ "$status" -eq 0 ] || exit "$status"\nexec ${quote(join(binDir, options.name))} "$@"\n`, { mode: 0o755 })
	renameSync(temporary, destination)
	return destination
}
