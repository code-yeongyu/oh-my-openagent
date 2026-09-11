import { existsSync } from "node:fs"
import { join } from "node:path"

// Windows ships bsdtar at System32\tar.exe since build 17134, and that is the only tar here that
// reads a zip. A bare `tar` resolves through PATH instead, so a shell that puts Git for Windows'
// usr/bin first hands us GNU tar, which cannot open a zip at all and rejects a drive-letter archive
// path as a remote host: `Cannot connect to C: resolve failed`.
export function windowsSystemTarPath(env: NodeJS.ProcessEnv = process.env): string | null {
	if (process.platform !== "win32") {
		return null
	}

	const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows"
	const systemTar = join(systemRoot, "System32", "tar.exe")

	return existsSync(systemTar) ? systemTar : null
}

export function zipTarCommand(env: NodeJS.ProcessEnv = process.env): string {
	return windowsSystemTarPath(env) ?? "tar"
}
