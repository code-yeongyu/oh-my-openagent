import { DEFAULT_MAX_MATCHES, DEFAULT_MAX_OUTPUT_BYTES } from "./language-support"
import type { CliMatch, SgResult } from "./types"

export function createSgResultFromStdout(stdout: string): SgResult {
	if (!stdout.trim()) {
		return { matches: [], totalMatches: 0, truncated: false }
	}

	const outputTruncated = stdout.length >= DEFAULT_MAX_OUTPUT_BYTES
	const outputToProcess = outputTruncated ? stdout.substring(0, DEFAULT_MAX_OUTPUT_BYTES) : stdout

	const parsedMatches = parseCliMatches(outputToProcess)
	let matches: CliMatch[] = parsedMatches ?? []
	if (!parsedMatches) {
		if (outputTruncated) {
			const lastValidIndex = outputToProcess.lastIndexOf("}")
			if (lastValidIndex > 0) {
				const bracketIndex = outputToProcess.lastIndexOf("},", lastValidIndex)
				if (bracketIndex > 0) {
					const truncatedJson = outputToProcess.substring(0, bracketIndex + 1) + "]"
					const recoveredMatches = parseCliMatches(truncatedJson)
					if (!recoveredMatches) {
						return {
							matches: [],
							totalMatches: 0,
							truncated: true,
							truncatedReason: "max_output_bytes",
							error: "Output too large and could not be parsed",
						}
					}
					matches = recoveredMatches
				}
			}
		} else {
			return { matches: [], totalMatches: 0, truncated: false }
		}
	}

	const totalMatches = matches.length
	const matchesTruncated = totalMatches > DEFAULT_MAX_MATCHES
	const finalMatches = matchesTruncated ? matches.slice(0, DEFAULT_MAX_MATCHES) : matches

	return {
		matches: finalMatches,
		totalMatches,
		truncated: outputTruncated || matchesTruncated,
		truncatedReason: outputTruncated
			? "max_output_bytes"
			: matchesTruncated
				? "max_matches"
				: undefined,
	}
}

function parseCliMatches(json: string): CliMatch[] | undefined {
	try {
		return JSON.parse(json) as CliMatch[]
	} catch (error) {
		if (error instanceof Error) {
			return undefined
		}
		return undefined
	}
}
