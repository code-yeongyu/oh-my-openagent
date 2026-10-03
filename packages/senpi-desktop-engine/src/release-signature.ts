import { spawnSync } from "node:child_process";

const RELEASE_REQUIREMENT =
	'identifier "ai.sisyphuslabs.senpi-desktop-engine" and anchor apple generic ' +
	'and certificate leaf[subject.OU] = "523JNR86LZ" ' +
	'and certificate 1[field.1.2.840.113635.100.6.2.6] exists ' +
	'and certificate leaf[field.1.2.840.113635.100.6.1.13] exists';

/** Local/ad-hoc builds must never replace the permission-bearing release executable. */
export function isDesktopEngineRelease(path: string): boolean {
	const result = spawnSync("/usr/bin/codesign", ["--verify", "--strict", `-R=${RELEASE_REQUIREMENT}`, path], {
		stdio: "ignore",
		timeout: 5000,
	});
	return result.error === undefined && result.status === 0;
}
