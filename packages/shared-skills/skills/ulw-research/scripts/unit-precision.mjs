// Precision is stored independently from display strings; generated fields are rederived on replay.
import { sigFigsOf, toDecimal } from "./rational.mjs"
import { refuse } from "./unit-errors.mjs"

export const toBig = (r) => ({ num: BigInt(r.num), den: BigInt(r.den) })
export const toText = (r) => ({ num: String(r.num), den: String(r.den) })
export const placesOf = (decimal) => (String(decimal).split(".")[1] ?? "").length
export function terminates(r) {
	let den = r.den
	for (const prime of [2n, 5n]) while (den % prime === 0n) den /= prime
	return den === 1n
}
export function precisionOf(row) {
	if (row.precision !== null && row.precision !== undefined) {
		const p = row.precision
		if (!p || typeof p !== "object" || Object.keys(p).sort().join(",") !== "places,sigfigs" || !Number.isSafeInteger(p.places) || p.places < 0 || !Number.isSafeInteger(p.sigfigs) || p.sigfigs < 1) refuse("invalid stored precision", undefined, "precision_field", "{ places: nonnegative integer, sigfigs: positive integer }")
		return p
	}
	return { places: placesOf(row.value), sigfigs: sigFigsOf(row.value) }
}
export function resultPrecision(rows, literals, exact, mode) {
	const inputs = [...rows.map(precisionOf), ...literals.map((value) => precisionOf({ value }))]
	const places = Math.min(...inputs.map((p) => p.places))
	const sigfigs = Math.min(...inputs.map((p) => p.sigfigs))
	if (mode === "places") return { places, sigfigs: sigFigsOf(roundPlaces(exact, places)) }
	const rendered = toDecimal(exact, sigfigs)
	return { places: placesOf(rendered), sigfigs }
}
export function roundPlaces(r, places) {
	const digits = ((r.num < 0n ? -r.num : r.num) * 10n ** BigInt(places) * 2n + r.den) / (r.den * 2n)
	const text = digits.toString().padStart(places + 1, "0")
	return (r.num < 0n && digits !== 0n ? "-" : "") + (places ? `${text.slice(0, -places)}.${text.slice(-places)}` : text)
}
export function renderValue(exact, precision, mode) {
	const plain = terminates(exact) ? toDecimal(exact) : null
	const n = precision[mode]
	if (plain !== null && (mode === "places" ? placesOf(plain) <= n : sigFigsOf(plain) < n)) return plain
	return mode === "places" ? roundPlaces(exact, n) : toDecimal(exact, n)
}
export function display(value, unit) {
	const [whole, fraction] = value.split(".")
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`)
	return unit === null ? grouped : unit === "%" ? `${grouped}%` : `${grouped} ${unit}`
}
