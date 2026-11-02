import { rmSync } from "node:fs"
import { TEARDOWN_FAILURE_PREFIX } from "../packages/omo-native/test/teardown.test-support"

/**
 * Remove a temp root we created ourselves. On win32 only, EBUSY is reported as a warning and the
 * directory is left for the OS to reclaim, the policy `teardownRoots` in
 * packages/omo-native/test/teardown.test-support.ts applies to the same class of residue.
 *
 * The holder is not ours. Both callers compile an executable into the root and run it, and every
 * child has exited before the removal. On windows-latest the hosted runner's provisioning daemon
 * (`provjobd.exe`) was caught holding the just-run executable open for ~40ms: 3 of 2,050 embed-probe
 * cycles with handle attribution armed (#9045). On a developer machine an antivirus scanner can do
 * the same. No user-space signal can be awaited for either. No retry loop: any other errno, and
 * every error on POSIX, still throws on the first attempt.
 */
export function removeTempRoot(
	root: string,
	remove: (path: string) => void = (path) => rmSync(path, { recursive: true, force: true }),
	platform: NodeJS.Platform = process.platform,
): void {
	try {
		remove(root)
	} catch (error) {
		const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined
		if (platform !== "win32" || code !== "EBUSY") throw error
		console.warn(`${TEARDOWN_FAILURE_PREFIX} leaving ${root} for the OS to reclaim (win32 EBUSY)`)
	}
}
