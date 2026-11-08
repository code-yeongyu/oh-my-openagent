import { DESKTOP_ENGINE_RELEASE_HOSTS, desktopEngineReleaseAssetName } from "./release-assets";

/** One grammar for upstream release checksums and the launcher's as-shipped engine checksums. */
export function parseDesktopEngineChecksums(text: string):
	| { readonly checksums: ReadonlyMap<string, string>; readonly error: null }
	| { readonly checksums: null; readonly error: string } {
	const checksums = new Map<string, string>();
	for (const line of text.trimEnd().split(/\r?\n/)) {
		const match = /^([a-fA-F0-9]{64})  ([A-Za-z0-9.-]+)$/.exec(line);
		const name = match?.[2];
		const digest = match?.[1];
		if (name === undefined || digest === undefined
			|| !DESKTOP_ENGINE_RELEASE_HOSTS.some((host) => desktopEngineReleaseAssetName(host) === name)) {
			return { checksums: null, error: "Invalid desktop engine checksum entry or asset name" };
		}
		if (checksums.has(name)) return { checksums: null, error: `Duplicate SHA-256 checksum for ${name}` };
		checksums.set(name, digest);
	}
	return { checksums, error: null };
}
