import { describe, expect, test } from "bun:test"
import { checkAstCoverage, extractExports } from "./ast-coverage-checker"

describe("ast-coverage-checker", () => {
	describe("extractExports", () => {
		test("extracts export function declarations", () => {
			//#given source with exported functions
			const source = `
export function add(a: number, b: number) { return a + b; }
export function subtract(a: number, b: number) { return a - b; }
`
			//#when extracting exports
			const exports = extractExports(source)

			//#then both functions are extracted
			expect(exports).toContain("add")
			expect(exports).toContain("subtract")
		})

		test("extracts export const declarations", () => {
			//#given source with exported constants
			const source = `
export const PI = 3.14;
export const E = 2.718;
`
			//#when extracting exports
			const exports = extractExports(source)

			//#then both constants are extracted
			expect(exports).toContain("PI")
			expect(exports).toContain("E")
		})

		test("extracts export class declarations", () => {
			//#given source with exported classes
			const source = `
export class Calculator {
  add(a: number, b: number) { return a + b; }
}
export class StringUtils {}
`
			//#when extracting exports
			const exports = extractExports(source)

			//#then both classes are extracted
			expect(exports).toContain("Calculator")
			expect(exports).toContain("StringUtils")
		})

		test("extracts export interface declarations", () => {
			//#given source with exported interfaces
			const source = `
export interface User {
  name: string;
}
export interface Config {
  debug: boolean;
}
`
			//#when extracting exports
			const exports = extractExports(source)

			//#then both interfaces are extracted
			expect(exports).toContain("User")
			expect(exports).toContain("Config")
		})

		test("extracts export type declarations", () => {
			//#given source with exported types
			const source = `
export type ID = string | number;
export type Callback = () => void;
`
			//#when extracting exports
			const exports = extractExports(source)

			//#then both types are extracted
			expect(exports).toContain("ID")
			expect(exports).toContain("Callback")
		})

		test("extracts named exports from export block", () => {
			//#given source with named export block
			const source = `
const foo = 1;
const bar = 2;
const baz = 3;
export { foo, bar, baz }
`
			//#when extracting exports
			const exports = extractExports(source)

			//#then all named exports are extracted
			expect(exports).toContain("foo")
			expect(exports).toContain("bar")
			expect(exports).toContain("baz")
		})

		test("handles export with 'as' alias", () => {
			//#given source with aliased exports
			const source = `
const internalName = 1;
export { internalName as publicName }
`
			//#when extracting exports
			const exports = extractExports(source)

			//#then original name is extracted (not alias)
			expect(exports).toContain("internalName")
			expect(exports).not.toContain("publicName")
		})

		test("deduplicates exports", () => {
			//#given source with duplicate export declarations
			const source = `
export function helper() {}
export { helper }
`
			//#when extracting exports
			const exports = extractExports(source)

			//#then helper appears only once
			const helperCount = exports.filter((e) => e === "helper").length
			expect(helperCount).toBe(1)
		})

		test("extracts async function exports", () => {
			//#given source with async exported functions
			const source = `
export async function fetchData() {}
`
			//#when extracting exports
			const exports = extractExports(source)

			//#then async function is extracted
			expect(exports).toContain("fetchData")
		})

		test("returns empty array for source with no exports", () => {
			//#given source with no exports
			const source = `
const privateVar = 1;
function privateFunc() {}
`
			//#when extracting exports
			const exports = extractExports(source)

			//#then empty array is returned
			expect(exports).toEqual([])
		})
	})

	describe("checkAstCoverage", () => {
		test("returns full coverage when all exports are referenced", () => {
			//#given source with exports
			const source = `
export function add(a: number, b: number) { return a + b; }
export const PI = 3.14;
`
			//#when test references all exports
			const testContent = `
import { add, PI } from './source';
test('add', () => { expect(add(1, 2)).toBe(3); });
test('PI', () => { expect(PI).toBe(3.14); });
`
			//#then coverage is 100%
			const result = checkAstCoverage(source, testContent)
			expect(result.covered).toContain("add")
			expect(result.covered).toContain("PI")
			expect(result.uncovered).toEqual([])
			expect(result.coveragePercent).toBe(100)
		})

		test("returns partial coverage when some exports are not referenced", () => {
			//#given source with multiple exports
			const source = `
export function add(a: number, b: number) { return a + b; }
export function subtract(a: number, b: number) { return a - b; }
export const PI = 3.14;
`
			//#when test only references 'add'
			const testContent = `
import { add } from './source';
test('add', () => { expect(add(1, 2)).toBe(3); });
`
			//#then coverage shows partial coverage
			const result = checkAstCoverage(source, testContent)
			expect(result.covered).toEqual(["add"])
			expect(result.uncovered).toContain("subtract")
			expect(result.uncovered).toContain("PI")
			expect(result.coveragePercent).toBeCloseTo(33.33, 1)
		})

		test("returns zero coverage when no exports are referenced", () => {
			//#given source with exports
			const source = `
export function add(a: number, b: number) { return a + b; }
export function subtract(a: number, b: number) { return a - b; }
`
			//#when test references none
			const testContent = `
test('dummy', () => { expect(true).toBe(true); });
`
			//#then coverage is 0%
			const result = checkAstCoverage(source, testContent)
			expect(result.covered).toEqual([])
			expect(result.uncovered).toContain("add")
			expect(result.uncovered).toContain("subtract")
			expect(result.coveragePercent).toBe(0)
		})

		test("returns 100% coverage for source with no exports", () => {
			//#given source with no exports
			const source = `
const privateVar = 1;
function privateFunc() {}
`
			//#when checking coverage
			const testContent = `test('anything', () => {});`

			//#then coverage is 100% (nothing to cover)
			const result = checkAstCoverage(source, testContent)
			expect(result.covered).toEqual([])
			expect(result.uncovered).toEqual([])
			expect(result.coveragePercent).toBe(100)
		})

		test("uses word boundary matching to avoid false positives", () => {
			//#given source with short named export
			const source = `
export function add(a: number, b: number) { return a + b; }
`
			//#when test contains 'add' as part of another word
			const testContent = `
// This test uses additional features
test('additional', () => { expect(1).toBe(1); });
`
			//#then 'add' is not matched (word boundary)
			const result = checkAstCoverage(source, testContent)
			expect(result.covered).toEqual([])
			expect(result.uncovered).toContain("add")
			expect(result.coveragePercent).toBe(0)
		})

		test("matches function references in various contexts", () => {
			//#given source with export
			const source = `
export function calculate() {}
`
			//#when test references function in different ways
			const testContent = `
// Direct call
calculate();
// As argument
someFunc(calculate);
// Property access
obj.calculate = calculate;
`
			//#then function is considered covered
			const result = checkAstCoverage(source, testContent)
			expect(result.covered).toContain("calculate")
			expect(result.coveragePercent).toBe(100)
		})
	})
})
