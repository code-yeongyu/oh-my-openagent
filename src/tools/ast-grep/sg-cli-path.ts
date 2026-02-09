import { createRequire } from "module"
import { dirname, join } from "path"
import { existsSync, statSync } from "fs"

import { getCachedBinaryPath } from "./downloader"

type Platform = "darwin" | "linux" | "win32" | "unsupported"

function isValidBinary(filePath: string): boolean {
	try {
		return statSync(filePath).size > 10000
	} catch {
		return false
	}
}

function getPlatformPackageName(): string | null {
	const platform = process.platform as Platform
	const arch = process.arch

	const platformMap: Record<string, string> = {
		"darwin-arm64": "@ast-grep/cli-darwin-arm64",
		"darwin-x64": "@ast-grep/cli-darwin-x64",
		"linux-arm64": "@ast-grep/cli-linux-arm64-gnu",
		"linux-x64": "@ast-grep/cli-linux-x64-gnu",
		"win32-x64": "@ast-grep/cli-win32-x64-msvc",
		"win32-arm64": "@ast-grep/cli-win32-arm64-msvc",
		"win32-ia32": "@ast-grep/cli-win32-ia32-msvc",
	}

	return platformMap[`${platform}-${arch}`] ?? null
}

export function findSgCliPathSync(): string | null {
	const binaryName = process.platform === "win32" ? "sg.exe" : "sg"

	const cachedPath = getCachedBinaryPath()
	if (cachedPath && isValidBinary(cachedPath)) {
		return cachedPath
	}

	try {
		const require = createRequire(import.meta.url)
		const cliPackageJsonPath = require.resolve("@ast-grep/cli/package.json")
		const cliDirectory = dirname(cliPackageJsonPath)
		const sgPath = join(cliDirectory, binaryName)

		if (existsSync(sgPath) && isValidBinary(sgPath)) {
			return sgPath
		}
	} catch {
		// @ast-grep/cli not installed
	}

	const platformPackage = getPlatformPackageName()
	if (platformPackage) {
		try {
			const require = createRequire(import.meta.url)
			const packageJsonPath = require.resolve(`${platformPackage}/package.json`)
			const packageDirectory = dirname(packageJsonPath)
			const astGrepBinaryName = process.platform === "win32" ? "ast-grep.exe" : "ast-grep"
			const binaryPath = join(packageDirectory, astGrepBinaryName)

			if (existsSync(binaryPath) && isValidBinary(binaryPath)) {
				return binaryPath
			}
		} catch {
			// Platform-specific package not installed
		}
	}

	if (process.platform === "darwin") {
		const homebrewPaths = ["/opt/homebrew/bin/sg", "/usr/local/bin/sg"]
		for (const path of homebrewPaths) {
			if (existsSync(path) && isValidBinary(path)) {
				return path
			}
		}
	}

	return null
}

let resolvedCliPath: string | null = null

export function getSgCliPath(): string | null {
	if (resolvedCliPath !== null) {
		return resolvedCliPath
	}

	const syncPath = findSgCliPathSync()
	if (syncPath) {
		resolvedCliPath = syncPath
		return syncPath
	}

	return null
}

export function setSgCliPath(path: string): void {
	resolvedCliPath = path
}
