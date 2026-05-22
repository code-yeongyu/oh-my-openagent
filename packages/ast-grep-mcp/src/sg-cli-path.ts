import { createRequire } from "module"
import { dirname, join } from "path"
import { existsSync, statSync } from "fs"

type Platform = "darwin" | "linux" | "win32" | "unsupported"

const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat"] as const

export function isValidBinary(filePath: string): boolean {
	try {
		const size = statSync(filePath).size
		const lowerPath = filePath.toLowerCase()
		if (lowerPath.endsWith(".cmd") || lowerPath.endsWith(".bat")) {
			return size > 0
		}
		return size > 10000
	} catch {
		return false
	}
}

export function executableCandidates(filePath: string, platform: NodeJS.Platform = process.platform): string[] {
	if (platform !== "win32") return [filePath]

	const candidates = [filePath]
	const lowerPath = filePath.toLowerCase()
	if (WINDOWS_EXECUTABLE_EXTENSIONS.some((extension) => lowerPath.endsWith(extension))) {
		return candidates
	}
	for (const extension of WINDOWS_EXECUTABLE_EXTENSIONS) {
		candidates.push(`${filePath}${extension}`)
	}
	return candidates
}

function findValidExecutable(filePath: string): string | null {
	for (const candidate of executableCandidates(filePath)) {
		if (existsSync(candidate) && isValidBinary(candidate)) {
			return candidate
		}
	}
	return null
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
	const binaryName = "sg"

	try {
		const require = createRequire(import.meta.url)
		const cliPackageJsonPath = require.resolve("@ast-grep/cli/package.json")
		const cliDirectory = dirname(cliPackageJsonPath)
		const sgPath = join(cliDirectory, binaryName)
		const validSgPath = findValidExecutable(sgPath)

		if (validSgPath) {
			return validSgPath
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
			const astGrepBinaryName = "ast-grep"
			const binaryPath = join(packageDirectory, astGrepBinaryName)
			const validBinaryPath = findValidExecutable(binaryPath)

			if (validBinaryPath) {
				return validBinaryPath
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
