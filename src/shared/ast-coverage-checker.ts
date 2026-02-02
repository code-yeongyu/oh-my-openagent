/**
 * AST Coverage Checker
 *
 * Verifies if test files reference exported functions/symbols from source files.
 * Uses regex-based parsing to extract exports and check coverage.
 */

export interface CoverageReport {
	covered: string[]
	uncovered: string[]
	coveragePercent: number
}

/**
 * Extracts all exported symbols from source content using regex patterns.
 * Handles: export function, export const, export class, export interface, export type, export { }
 */
export function extractExports(sourceContent: string): string[] {
	const exports: string[] = []

	// Match: export function NAME (including async)
	const funcMatches = sourceContent.matchAll(
		/export\s+(?:async\s+)?function\s+(\w+)/g
	)
	for (const match of funcMatches) {
		exports.push(match[1])
	}

	// Match: export const NAME
	const constMatches = sourceContent.matchAll(/export\s+const\s+(\w+)/g)
	for (const match of constMatches) {
		exports.push(match[1])
	}

	// Match: export class NAME
	const classMatches = sourceContent.matchAll(/export\s+class\s+(\w+)/g)
	for (const match of classMatches) {
		exports.push(match[1])
	}

	// Match: export interface NAME
	const interfaceMatches = sourceContent.matchAll(
		/export\s+interface\s+(\w+)/g
	)
	for (const match of interfaceMatches) {
		exports.push(match[1])
	}

	// Match: export type NAME
	const typeMatches = sourceContent.matchAll(/export\s+type\s+(\w+)/g)
	for (const match of typeMatches) {
		exports.push(match[1])
	}

	// Match: export { X, Y, Z } or export { X as Y }
	const namedMatches = sourceContent.matchAll(/export\s+\{\s*([^}]+)\s*\}/g)
	for (const match of namedMatches) {
		const names = match[1]
			.split(",")
			.map((n) => n.trim().split(/\s+as\s+/)[0].trim())
		exports.push(...names.filter((n) => n.length > 0))
	}

	// Deduplicate exports
	return [...new Set(exports)]
}

/**
 * Checks if a symbol is referenced in test content using word boundary matching.
 */
function isReferenced(testContent: string, symbol: string): boolean {
	const regex = new RegExp(`\\b${symbol}\\b`)
	return regex.test(testContent)
}

/**
 * Checks AST coverage by comparing exported symbols against test file references.
 *
 * @param sourceContent - The source file content to analyze
 * @param testContent - The test file content to check for references
 * @returns CoverageReport with covered/uncovered symbols and coverage percentage
 */
export function checkAstCoverage(
	sourceContent: string,
	testContent: string
): CoverageReport {
	const exportedSymbols = extractExports(sourceContent)
	const covered = exportedSymbols.filter((symbol) =>
		isReferenced(testContent, symbol)
	)
	const uncovered = exportedSymbols.filter(
		(symbol) => !isReferenced(testContent, symbol)
	)
	const coveragePercent =
		exportedSymbols.length > 0
			? (covered.length / exportedSymbols.length) * 100
			: 100

	return { covered, uncovered, coveragePercent }
}
