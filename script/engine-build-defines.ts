// script/engine-build-defines.ts
// Compile-time `--define` argv for senpi's engineBuildIdentity (SENPI_BUILD_EPOCH / SENPI_BUILD_SHA7).
// A missing stamp omits the defines; the binary then runs scheme `nodef` and never initiates a handoff.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
	resolveEngineBuildStamp,
	type EngineBuildStamp,
	type OmoBuildInfo,
} from "../packages/omo-native/build-info"

/** bun `--define` pairs matching senpi `scripts/build-binaries.sh`. Empty when scheme is `nodef`. */
export function engineBuildDefineArgs(stamp: EngineBuildStamp): readonly string[] {
	switch (stamp.scheme) {
		case "epoch":
			return [
				"--define",
				`SENPI_BUILD_EPOCH=${stamp.epoch}`,
				"--define",
				`SENPI_BUILD_SHA7=${JSON.stringify(stamp.sha7)}`,
			]
		case "nodef":
			return []
		default: {
			const exhaustive: never = stamp.scheme
			throw new Error(`unexpected scheme: ${String(exhaustive)}`)
		}
	}
}

export function compileDefinesForOmoBinary(input: {
	readonly buildInfo?: OmoBuildInfo
	readonly senpiPackage?: unknown
}): readonly string[] {
	return engineBuildDefineArgs(resolveEngineBuildStamp(input))
}

/** Stamp for this compile: buildInfo wins; otherwise the pinned senpi package.json. */
export function omoBinaryEngineStamp(
	buildInfo: OmoBuildInfo | undefined,
	packageDir: string,
): EngineBuildStamp {
	return resolveEngineBuildStamp({
		buildInfo,
		senpiPackage: buildInfo === undefined ? readSenpiPackageJson(packageDir) : undefined,
	})
}

export function releaseEngineBuildStamp(stamp: EngineBuildStamp): EngineBuildStamp | undefined {
	return stamp.scheme === "epoch" && stamp.source === "senpi-package" ? stamp : undefined
}

/** Reads the pinned engine package.json; undefined when the file is absent. */
export function readSenpiPackageJson(packageDir: string): unknown {
	const packagePath = join(packageDir, "package.json")
	if (!existsSync(packagePath)) return undefined
	return JSON.parse(readFileSync(packagePath, "utf8"))
}
