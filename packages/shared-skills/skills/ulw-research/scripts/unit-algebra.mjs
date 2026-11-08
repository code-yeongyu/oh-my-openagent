// Canonical factor algebra. Exponents are bigint; aliases enter only through normalizeInput.
import { fromDecimal, mul, sigFigsOf, toDecimal } from "./rational.mjs"
import { dimensionOf, normalizeUnit } from "./units.mjs"
import { refuse } from "./unit-errors.mjs"
export { refuse, RuleError } from "./unit-errors.mjs"

const SCALED = new Set(["bp", "basispoint", "basispoints"])
export const isPercentish = (unit) => unit === "%" || unit === "%p"
const scaled = (text) => SCALED.has(text.replace(/\s+/g, "").toLowerCase())

function atomOf(text) {
	if (text === "1") return null
	const atom = scaled(text) ? "%p" : normalizeUnit(text) ?? text
	if (dimensionOf(atom) === "scale") refuse(`"${text}" is a scale word (${atom}), not a unit`, undefined, "scale_atom", "a counted unit with scale in the numeral")
	return atom
}

const combine = (a, b, sign) => {
	for (const [atom, power] of b) a.set(atom, (a.get(atom) ?? 0n) + sign * power)
	return a
}

/** Iterative unit parser: factor maps plus the input's decimal scaling exponent. */
function parse(raw) {
	if (raw === null) return { factors: new Map(), shift: 0n }
	if (typeof raw !== "string" || !raw.trim()) refuse("unit must be text or explicit null", undefined, "unit_text", "canonical unit text or null")
	const tokens = raw.match(/[*/()^]|[^*/()^]+/g).map((x) => x.trim()).filter(Boolean)
	const frames = [{ factors: new Map(), shift: 0n, sign: 1n, need: true }]
	let affine = false
	const apply = (value, i) => {
		if (tokens[i] === "^") {
			const power = tokens[i + 1]
			if (!/^[+-]?\d+$/.test(power ?? "")) refuse(`unit "${raw}" has a bad exponent`, undefined, "exponent", "an integer exponent")
			const n = BigInt(power)
			value = { factors: new Map([...value.factors].map(([a, p]) => [a, p * n])), shift: value.shift * n }
			i += 2
		}
		const frame = frames.at(-1)
		combine(frame.factors, value.factors, frame.sign)
		frame.shift += frame.sign * value.shift
		frame.need = false
		return i
	}
	for (let i = 0; i < tokens.length;) {
		const frame = frames.at(-1)
		const token = tokens[i]
		if (frame.need) {
			if (token === "(") {
				frames.push({ factors: new Map(), shift: 0n, sign: 1n, need: true })
				i++
			} else {
				if (/^[*/()^]$/.test(token)) refuse(`unexpected "${token}" in unit "${raw}"`)
				const atom = atomOf(token)
				affine ||= dimensionOf(atom) === "temperature"
				i = apply({ factors: new Map(atom === null ? [] : [[atom, 1n]]), shift: scaled(token) ? -2n : 0n }, i + 1)
			}
		} else if (token === ")" && frames.length > 1) {
			const value = frames.pop()
			i = apply(value, i + 1)
		} else if (token === "*" || token === "/") {
			frame.sign = token === "*" ? 1n : -1n
			frame.need = true
			i++
		} else refuse(`unexpected "${token}" in unit "${raw}"`)
	}
	if (frames.length !== 1 || frames[0].need) refuse(`unit "${raw}" ends early or is missing a closing parenthesis`)
	// Refuse affine composites before cancellation loses the atom that made them unsafe.
	if (affine && (tokens.length !== 1 || frames[0].shift !== 0n)) refuse("affine (temperature) units cannot occur in composites", undefined, "affine_units", "a non-affine composite or bare temperature for convert")
	return frames[0]
}

function format(factors) {
	const side = (sign) => [...factors].filter(([, p]) => sign * p > 0n).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
		.map(([a, p]) => { const n = sign * p; return n === 1n ? a : `${a}^${n}` })
	const top = side(1n)
	const bottom = side(-1n)
	if (!top.length && !bottom.length) return null
	return `${top.join("*") || "1"}${bottom.length ? `/${bottom.length === 1 ? bottom[0] : `(${bottom.join("*")})`}` : ""}`
}

export const canonicalUnit = (raw) => format(parse(raw).factors)
export function inputScale(raw) {
	const { shift } = parse(raw)
	if (shift === 0n) return null
	if (shift > 10000n || shift < -10000n) refuse("scaled alias exponent exceeds exact input capacity", undefined, "scale_range", "an absolute decimal scale exponent <= 10000")
	return shift > 0n ? `1${"0".repeat(Number(shift))}` : `0.${"0".repeat(Number(-shift - 1n))}1`
}

export function normalizeInput(unit, value) {
	const canonical = canonicalUnit(unit)
	const factor = inputScale(unit)
	return { unit: canonical, value: factor ? toDecimal(mul(fromDecimal(value), fromDecimal(factor)), sigFigsOf(value)) : value }
}

export const unitTimes = (a, b) => format(combine(parse(a).factors, parse(b).factors, 1n))
export const unitOver = (a, b) => format(combine(parse(a).factors, parse(b).factors, -1n))
export const isAffine = (unit) => typeof unit === "string" && dimensionOf(unit) === "temperature"
export function isCurrencyRate(unit) {
	const currencies = [...parse(unit).factors].filter(([a, n]) => n !== 0n && dimensionOf(a)?.startsWith("currency:"))
	return currencies.some(([, n]) => n > 0n) && currencies.some(([, n]) => n < 0n)
}
