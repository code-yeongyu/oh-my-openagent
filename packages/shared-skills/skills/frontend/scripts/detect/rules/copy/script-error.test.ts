import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { scriptError } from "./script-error"
import { lintSnapshot } from "../../lint"

test("#given captured errors duplicates and blanks #then only three distinct errors report", () => {
	const check = (scriptErrors: readonly string[]) => scriptError.check({ snapshot: buildSnapshot([], { scriptErrors }), config: {} })
	const hits = check(["", "TypeError: cart is undefined", "TypeError: cart is undefined", "SyntaxError: invalid token", "ReferenceError: missing", "Error: fourth"])
	expect(hits.map((hit) => hit.snippet)).toEqual(["TypeError: cart is undefined", "SyntaxError: invalid token", "ReferenceError: missing"])
	expect(check([])).toHaveLength(0)
})
test("#given recoverable media hydration and ad-tech errors #then lint preserves advisory severities and project overrides", () => {
	const snapshot = buildSnapshot([], { scriptErrors: [
		"Minified React error #418", "AbortError: The play() request was interrupted",
		"adsbygoogle failed", "TypeError: cart missing",
	] })
	expect(lintSnapshot(snapshot, { rules: [scriptError] }).map(hit => hit.severity)).toEqual([
		"advisory", "advisory", "advisory", "error",
	])
	expect(lintSnapshot(snapshot, { rules: [scriptError], config: { rules: { "script-error": "warning" } } }).map(hit => hit.severity))
		.toEqual(["warning", "warning", "warning", "warning"])
})

test("#given recoverable errors before application crashes #then each class retains separate slots", () => {
	const snapshot = buildSnapshot([], { scriptErrors: [
		"Minified React error #418", "Minified React error #419", "Minified React error #422", "Minified React error #423",
		"adsbygoogle 1", "adsbygoogle 2", "adsbygoogle 3", "adsbygoogle 4",
		"Minified React error #4180", "AbortError: fetch aborted", "TypeError: cart missing", "Error: fourth",
	] })
	const hits = scriptError.check({ snapshot, config: {} })
	expect(hits).toHaveLength(9)
	expect(hits.filter((hit) => hit.message === "Uncaught page script error").map((hit) => hit.snippet)).toEqual([
		"Minified React error #4180", "AbortError: fetch aborted", "TypeError: cart missing",
	])
	expect(scriptError.check({ snapshot: buildSnapshot([]), config: {} })).toHaveLength(0)
})

test("#given a renderer that could not install the error probe #then one advisory says errors were not captured", () => {
	const snapshot = buildSnapshot([], { scriptErrorsCaptured: false })
	expect(lintSnapshot(snapshot, { rules: [scriptError] }).map((f) => [f.severity, f.location.kind])).toEqual([["advisory", "page"]])
	expect(lintSnapshot(buildSnapshot([]), { rules: [scriptError] })).toHaveLength(0)
})

test("#given a project override that raises script-error #then the not-captured notice stays advisory and off still drops it", () => {
	const snapshot = buildSnapshot([], { scriptErrorsCaptured: false })
	expect(lintSnapshot(snapshot, { rules: [scriptError], config: { rules: { "script-error": "error" } } }).map((f) => f.severity)).toEqual(["advisory"])
	expect(lintSnapshot(snapshot, { rules: [scriptError], config: { rules: { "script-error": "off" } } })).toHaveLength(0)
})
