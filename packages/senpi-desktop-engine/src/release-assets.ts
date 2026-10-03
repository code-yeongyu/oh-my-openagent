/** Release assets and cache names shared by the publisher and acquisition API. */
export const DESKTOP_ENGINE_CHECKSUMS_ASSET = "senpi-desktop-engine-checksums.txt";
export const DESKTOP_ENGINE_RELEASE_HOSTS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-x64",
	"win32-x64",
] as const;

export function desktopEngineReleaseAssetName(host: string): string | null {
	switch (host) {
		case "darwin-arm64":
		case "darwin-x64":
		case "linux-x64":
			return `senpi-desktop-engine-${host}`;
		case "win32-x64":
			return `senpi-desktop-engine-${host}.exe`;
		default:
			return null;
	}
}
