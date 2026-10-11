/** Platforms with a desktop backend. Any architecture: the engine locator reports a missing prebuild. */
const SUPPORTED_PLATFORMS: ReadonlySet<string> = new Set(["darwin", "linux", "win32"]);

/**
 * Whether this host may register the `computer` tool. Windows arm64 counts as supported; when no engine
 * prebuild exists for it, the engine locator's `native-unavailable` diagnostic surfaces on first use.
 */
export function isSupportedHost(platform: string = process.platform): boolean {
	return SUPPORTED_PLATFORMS.has(platform);
}

/** The stop chord armed when `computer.stopHotkey` is unset: Ctrl+Opt+Cmd+Esc on macOS. */
export function defaultStopHotkey(platform: string = process.platform): string {
	return platform === "darwin" ? "ctrl+alt+cmd+escape" : "ctrl+alt+shift+escape";
}
