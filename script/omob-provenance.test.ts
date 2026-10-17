import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { versionLines, type OmoBuildInfo } from "../packages/omo-native/build-info"
import { isCurrentOmobBuild } from "./omob-launcher"
import { binaryContentDigest, provenancePath, readProvenanceMarker, writeProvenanceMarker } from "./omob-provenance"
import { hostTargetFor } from "./build-omob"

const info: OmoBuildInfo = {
	command: "omob",
	omo: { commit: "a".repeat(40), committedAt: "2026-09-20T00:00:00Z", branch: "dev" },
	engine: { commit: "b".repeat(40), committedAt: "2026-09-20T00:00:00Z", branch: "main" },
}
const otherInfo: OmoBuildInfo = { ...info, engine: { ...info.engine, commit: "c".repeat(40) } }
const hostTarget = hostTargetFor(process.platform, process.arch)
const expectedVersion = versionLines(info).join("\n")

interface Fixture {
	readonly binary: string
	readonly spawns: () => number
	install: (versionOutput: string) => void
}

/** A POSIX fixture: reporting its own spawn count needs no compiled executable. */
function spawnCountingFixture(root: string): Fixture {
	const binary = join(root, "omob")
	const install = (versionOutput: string): void => {
		writeFileSync(`${binary}.version`, versionOutput)
		writeFileSync(`${binary}.spawns`, "")
		// Removed and rewritten so each install lands on a new inode, which is the property under
		// test. installBinary itself publishes via renameSync; this fixture only reproduces the
		// resulting identity change, not the atomicity.
		const temporary = `${binary}.tmp`
		writeFileSync(temporary, `#!/bin/sh\nprintf x >> "$0.spawns"\ncat "$0.version"\n`, { mode: 0o755 })
		rmSync(binary, { force: true })
		writeFileSync(binary, readFileSync(temporary), { mode: 0o755 })
		rmSync(temporary, { force: true })
	}
	install(expectedVersion)
	return { binary, spawns: () => readFileSync(`${binary}.spawns`, "utf8").length, install }
}

function withFixture(prefix: string, body: (fixture: Fixture) => void): void {
	const root = mkdtempSync(join(tmpdir(), prefix))
	try {
		body(spawnCountingFixture(root))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

describe("omob provenance marker", () => {
	test.skipIf(process.platform === "win32")(
		"#given a marker written for the installed executable #when the refresh checks it #then the answer comes without spawning the executable",
		() => {
			withFixture("omob-prov-hit-", (fixture) => {
				writeProvenanceMarker(fixture.binary, expectedVersion)
				expect(isCurrentOmobBuild(fixture.binary, info, hostTarget)).toBe(true)
				expect(fixture.spawns()).toBe(0)
			})
		},
	)

	test.skipIf(process.platform === "win32")(
		"#given a marker recording a different build #when the refresh checks it #then it reports not-current without spawning",
		() => {
			withFixture("omob-prov-other-", (fixture) => {
				const otherVersion = versionLines(otherInfo).join("\n")
				fixture.install(otherVersion)
				writeProvenanceMarker(fixture.binary, otherVersion)
				expect(isCurrentOmobBuild(fixture.binary, info, hostTarget)).toBe(false)
				expect(fixture.spawns()).toBe(0)
			})
		},
	)

	test.skipIf(process.platform === "win32")(
		"#given no marker #when the refresh checks the executable #then it still answers by spawning it",
		() => {
			withFixture("omob-prov-miss-", (fixture) => {
				expect(isCurrentOmobBuild(fixture.binary, info, hostTarget)).toBe(true)
				expect(fixture.spawns()).toBe(1)
			})
		},
	)

	test.skipIf(process.platform === "win32")(
		"#given a marker that outlived the executable it described #when the refresh checks it #then the marker is rejected and the executable answers",
		() => {
			withFixture("omob-prov-stale-", (fixture) => {
				writeProvenanceMarker(fixture.binary, expectedVersion)
				expect(readProvenanceMarker(fixture.binary)).toBe(expectedVersion)
				// Reinstalling is exactly the failed-install shape this guards: the path survives,
				// the file behind it does not, so the old marker must stop being believed.
				fixture.install(expectedVersion)
				expect(readProvenanceMarker(fixture.binary)).toBeUndefined()
				expect(isCurrentOmobBuild(fixture.binary, info, hostTarget)).toBe(true)
				expect(fixture.spawns()).toBe(1)
			})
		},
	)

	test.skipIf(process.platform === "win32")(
		"#given a marker whose JSON is not an object #when it is read #then it is ignored instead of crashing the launch",
		() => {
			withFixture("omob-prov-shape-", (fixture) => {
				// These shapes reach property access before the type guards, so a throw here does not
				// degrade to a spawn - it takes down every omob launch.
				for (const body of ["null", "123", '"text"', "[]", '{"identity":null,"versionOutput":"x"}', '{"identity":{},"versionOutput":"x"}', '{"identity":{"dev":1,"ino":2,"size":3},"versionOutput":"x"}', '{"identity":{"dev":1,"ino":2,"size":3,"mtimeMs":4}}']) {
					writeFileSync(provenancePath(fixture.binary), body)
					expect(() => readProvenanceMarker(fixture.binary)).not.toThrow()
					expect(readProvenanceMarker(fixture.binary)).toBeUndefined()
					expect(isCurrentOmobBuild(fixture.binary, info, hostTarget)).toBe(true)
				}
			})
		},
	)

	test.skipIf(process.platform === "win32")(
		"#given the executable's bytes change while the recorded stat identity still matches #when provenance is read #then the marker is rejected",
		() => {
			withFixture("omob-prov-inplace-", (fixture) => {
				writeProvenanceMarker(fixture.binary, expectedVersion)
				expect(readProvenanceMarker(fixture.binary)).toBe(expectedVersion)

				// Rewrite the content, then re-stamp the marker's identity to the file's CURRENT stat
				// while keeping the digest of the old bytes. That is the stat-identical overwrite a
				// metadata-only marker cannot see, constructed directly because utimesSync cannot
				// restore sub-millisecond mtime. Only the content digest can reject this.
				const marker = JSON.parse(readFileSync(provenancePath(fixture.binary), "utf8")) as {
					identity: Record<string, number>
					contentSha256: string
					versionOutput: string
				}
				writeFileSync(fixture.binary, `#!/bin/sh\nprintf x >> "$0.spawns"\necho tampered\n`, { mode: 0o755 })
				const current = statSync(fixture.binary)
				const restamped = {
					identity: { dev: current.dev, ino: current.ino, size: current.size, mtimeMs: current.mtimeMs, mode: current.mode },
					contentSha256: marker.contentSha256,
					versionOutput: marker.versionOutput,
				}
				writeFileSync(provenancePath(fixture.binary), `${JSON.stringify(restamped)}\n`)

				expect(binaryContentDigest(fixture.binary)).not.toBe(marker.contentSha256)
				expect(readProvenanceMarker(fixture.binary)).toBeUndefined()
			})
		},
	)

	test.skipIf(process.platform === "win32")(
		"#given the executable's mode changes #when provenance is read #then the marker no longer speaks for it",
		() => {
			withFixture("omob-prov-mode-", (fixture) => {
				writeProvenanceMarker(fixture.binary, expectedVersion)
				expect(readProvenanceMarker(fixture.binary)).toBe(expectedVersion)
				chmodSync(fixture.binary, 0o644)
				expect(readProvenanceMarker(fixture.binary)).toBeUndefined()
			})
		},
	)

	test.skipIf(process.platform === "win32")(
		"#given a corrupt marker #when it is read #then it is ignored instead of throwing",
		() => {
			withFixture("omob-prov-corrupt-", (fixture) => {
				writeFileSync(provenancePath(fixture.binary), "{not json")
				expect(readProvenanceMarker(fixture.binary)).toBeUndefined()
				expect(isCurrentOmobBuild(fixture.binary, info, hostTarget)).toBe(true)
				expect(fixture.spawns()).toBe(1)
			})
		},
	)

	test("#given a missing executable #when provenance is read or written #then there is nothing to trust", () => {
		const root = mkdtempSync(join(tmpdir(), "omob-prov-absent-"))
		try {
			const absent = join(root, "omob")
			writeProvenanceMarker(absent, expectedVersion)
			expect(readProvenanceMarker(absent)).toBeUndefined()
			expect(isCurrentOmobBuild(absent, info, hostTarget)).toBe(false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
