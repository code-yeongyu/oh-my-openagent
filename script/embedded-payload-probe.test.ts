import { afterAll, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TEARDOWN_FAILURE_PREFIX } from "../packages/omo-native/test/teardown.test-support"
import { RUNTIME_MANIFEST_REL_PATH } from "./embedded-payload-naming"
import { reportEmbeddedPayload } from "./embedded-payload-probe"
import { removeTempRoot } from "./remove-temp-root"

const stageRoot = mkdtempSync(join(tmpdir(), "omo-embed-probe-stage-"))
const stageDir = join(stageRoot, "omo-runtime")
mkdirSync(stageDir, { recursive: true })
writeFileSync(join(stageDir, "package.json"), JSON.stringify({ version: "0.0.0-test" }))
writeFileSync(join(stageDir, RUNTIME_MANIFEST_REL_PATH), JSON.stringify({ omoAiVersion: "0.0.0-test", entries: [] }))

afterAll(() => rmSync(stageRoot, { recursive: true, force: true }))

function busyAfterRemoving(seen: string[]): (path: string) => void {
	return (path) => {
		seen.push(path)
		rmSync(path, { recursive: true, force: true })
		throw Object.assign(new Error(`EBUSY: resource busy or locked, rm '${path}'`), { code: "EBUSY" })
	}
}

describe("reportEmbeddedPayload probe-root cleanup (#9045)", () => {
	test("#given win32 and a probe root held busy by another process #when the probe finishes #then the report is returned and the root is left with a warning", () => {
		const probeRoots: string[] = []
		const warn = spyOn(console, "warn").mockImplementation(() => {})
		try {
			const report = reportEmbeddedPayload(stageDir, (root) => removeTempRoot(root, busyAfterRemoving(probeRoots), "win32"))
			expect(report.relPaths).toContain("package.json")
			expect(warn).toHaveBeenCalledTimes(1)
			expect(String(warn.mock.calls[0]?.[0])).toStartWith(TEARDOWN_FAILURE_PREFIX)
		} finally {
			warn.mockRestore()
		}
		expect(probeRoots.length).toBe(1)
		expect(probeRoots.some(existsSync)).toBe(false)
	}, 60_000)

	test("#given POSIX and a busy probe root #when the probe finishes #then the EBUSY surfaces", () => {
		const probeRoots: string[] = []
		expect(() => reportEmbeddedPayload(stageDir, (root) => removeTempRoot(root, busyAfterRemoving(probeRoots), "linux"))).toThrow("EBUSY")
		expect(probeRoots.length).toBe(1)
		expect(probeRoots.some(existsSync)).toBe(false)
	}, 60_000)
})
