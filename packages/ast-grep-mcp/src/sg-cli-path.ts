import { createRequire } from "node:module"
import { homedir as defaultHomedir } from "node:os"
import { dirname, join } from "node:path"
import { existsSync, statSync } from "node:fs"

export const SG_PATH_ENV_KEY = "OMO_AST_GREP_SG_PATH"

const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat"] as const

export interface FindSgCliPathOptions {
	readonly env?: Record<string, string | undefined>
	readonly platform?: NodeJS.Platform
	readonly arch?: string
	readonly homedir?: () => string
	readonly resolveModulePath?: (specifier: string) => string
}

export function isValidBinary(filePath: string): boolean {
	try {
		const stats = statSync(filePath)
		if (!stats.isFile()) {
			return false
		}

		const size = stats.size
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

function findValidExecutable(filePath: string, platform: NodeJS.Platform = process.platform): string | null {
	for (const candidate of executableCandidates(filePath, platform)) {
		if (existsSync(candidate) && isValidBinary(candidate)) {
			return candidate
		}
	}
	return null
}

function getPlatformPackageName(platform: NodeJS.Platform, arch: string): string | null {
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

function isModuleResolutionFailure(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.includes("Cannot find module") || error.message.includes("Cannot find package"))
	)
}

function defaultResolveModulePath(specifier: string): string {
	const require = createRequire(import.meta.url)
	return require.resolve(specifier)
}

function nonEmptyValue(value: string | undefined): string | undefined {
	if (value === undefined) return undefined
	const trimmed = value.trim()
	return trimmed.length === 0 ? undefined : trimmed
}

function findEnvOverrideSgPath(
	env: Record<string, string | undefined>,
	platform: NodeJS.Platform,
): string | null {
	const overridePath = nonEmptyValue(env[SG_PATH_ENV_KEY])
	if (overridePath === undefined) return null
	return findValidExecutable(overridePath, platform)
}

function findRuntimeDirSgPath(
	env: Record<string, string | undefined>,
	platform: NodeJS.Platform,
	arch: string,
	homedir: () => string,
): string | null {
	const codexHome = nonEmptyValue(env["CODEX_HOME"]) ?? join(homedir(), ".codex")
	const binaryName = platform === "win32" ? "sg.exe" : "sg"
	const runtimePath = join(codexHome, "runtime", "ast-grep", `${platform}-${arch}`, binaryName)
	return findValidExecutable(runtimePath, platform)
}

export function findSgCliPathSync(options: FindSgCliPathOptions = {}): string | null {
	const env = options.env ?? process.env
	const platform = options.platform ?? process.platform
	const arch = options.arch ?? process.arch
	const homedir = options.homedir ?? defaultHomedir
	const resolveModulePath = options.resolveModulePath ?? defaultResolveModulePath

	const envOverridePath = findEnvOverrideSgPath(env, platform)
	if (envOverridePath) {
		return envOverridePath
	}

	const runtimeDirPath = findRuntimeDirSgPath(env, platform, arch, homedir)
	if (runtimeDirPath) {
		return runtimeDirPath
	}

	const binaryName = "sg"

	try {
		const cliPackageJsonPath = resolveModulePath("@ast-grep/cli/package.json")
		const cliDirectory = dirname(cliPackageJsonPath)
		const sgPath = join(cliDirectory, binaryName)
		const validSgPath = findValidExecutable(sgPath, platform)

		if (validSgPath) {
			return validSgPath
		}
	} catch (error) {
		if (!isModuleResolutionFailure(error)) {
			throw error
		}
	}

	const platformPackage = getPlatformPackageName(platform, arch)
	if (platformPackage) {
		try {
			const packageJsonPath = resolveModulePath(`${platformPackage}/package.json`)
			const packageDirectory = dirname(packageJsonPath)
			const astGrepBinaryName = "ast-grep"
			const binaryPath = join(packageDirectory, astGrepBinaryName)
			const validBinaryPath = findValidExecutable(binaryPath, platform)

			if (validBinaryPath) {
				return validBinaryPath
			}
		} catch (error) {
			if (!isModuleResolutionFailure(error)) {
				throw error
			}
		}
	}

	if (platform === "darwin") {
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
