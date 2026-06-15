import { existsSync } from "node:fs"

const DEFAULT_ZSH_PATHS = ["/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"]
const DEFAULT_BASH_PATHS = ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"]

function findShellPath(
	defaultPaths: string[],
	customPath?: string,
): string | null {
	if (customPath && existsSync(customPath)) {
		return customPath
	}
	for (const path of defaultPaths) {
		if (existsSync(path)) {
			return path
		}
	}
	return null
}

export function findZshPath(customZshPath?: string): string | null {
	return findShellPath(DEFAULT_ZSH_PATHS, customZshPath)
}

export function findBashPath(): string | null {
	return findShellPath(DEFAULT_BASH_PATHS)
}
