import { z } from "zod"

const GIT_ENV_ASSIGNMENT_PATTERN =
	/^(?:[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_-]*)(?: [A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_-]*)*$/

export const GIT_ENV_PREFIX_VALIDATION_MESSAGE =
	'git_env_prefix must be empty or use shell-safe env assignments like "GIT_MASTER=1"'

export function isValidGitEnvPrefix(value: string): boolean {
	if (value === "") {
		return true
	}

	return GIT_ENV_ASSIGNMENT_PATTERN.test(value)
}

export function assertValidGitEnvPrefix(value: string): string {
	if (!isValidGitEnvPrefix(value)) {
		throw new Error(GIT_ENV_PREFIX_VALIDATION_MESSAGE)
	}

	return value
}

export const GitEnvPrefixSchema = z
	.string()
	.refine(isValidGitEnvPrefix, { message: GIT_ENV_PREFIX_VALIDATION_MESSAGE })
	.default("GIT_MASTER=1")
