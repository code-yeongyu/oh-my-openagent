// rational.mjs - exact rational arithmetic over BigInt numerator/denominator pairs.
//
// A rational is { num: bigint, den: bigint }, reduced, with den > 0. Numerals enter as decimal
// strings and never pass through Number(), so no value is ever rounded by floating point.
// Plain Node ESM, no imports.

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/

const abs = (n) => (n < 0n ? -n : n)

function gcd(a, b) {
	let x = abs(a)
	let y = abs(b)
	while (y !== 0n) [x, y] = [y, x % y]
	return x
}

function make(num, den) {
	if (den === 0n) throw new RangeError("rational: zero denominator")
	const sign = den < 0n ? -1n : 1n
	const g = gcd(num, den) || 1n
	return Object.freeze({ num: (sign * num) / g, den: (sign * den) / g })
}

/** Accepts a rational, a bigint, a safe integer, or a decimal string. */
function coerce(value) {
	if (typeof value === "bigint") return make(value, 1n)
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) throw new TypeError(`rational: ${value} is not a safe integer; pass a decimal string`)
		return make(BigInt(value), 1n)
	}
	if (typeof value === "string") return fromDecimal(value)
	if (value && typeof value.num === "bigint" && typeof value.den === "bigint") return make(value.num, value.den)
	throw new TypeError("rational: expected a rational, bigint, integer, or decimal string")
}

/** "12.50" -> 25/2. Accepts an optional sign, digits, and an optional fraction; nothing else. */
export function fromDecimal(str) {
	const match = DECIMAL.exec(String(str).trim())
	if (!match) throw new SyntaxError(`rational: "${str}" is not a plain decimal`)
	const [, sign, whole, frac = ""] = match
	const num = BigInt(whole + frac) * (sign === "-" ? -1n : 1n)
	return make(num, 10n ** BigInt(frac.length))
}

export function add(a, b) {
	const x = coerce(a)
	const y = coerce(b)
	return make(x.num * y.den + y.num * x.den, x.den * y.den)
}

export function sub(a, b) {
	const x = coerce(a)
	const y = coerce(b)
	return make(x.num * y.den - y.num * x.den, x.den * y.den)
}

export function mul(a, b) {
	const x = coerce(a)
	const y = coerce(b)
	return make(x.num * y.num, x.den * y.den)
}

export function div(a, b) {
	const x = coerce(a)
	const y = coerce(b)
	if (y.num === 0n) throw new RangeError("rational: division by zero")
	return make(x.num * y.den, x.den * y.num)
}

export function eq(a, b) {
	const x = coerce(a)
	const y = coerce(b)
	return x.num === y.num && x.den === y.den
}

/** Digits of a non-negative integer scaled by 10^-scale, as a decimal string. */
function placeDecimal(digits, scale) {
	if (scale <= 0) return digits + "0".repeat(-scale)
	const padded = digits.padStart(scale + 1, "0")
	return `${padded.slice(0, padded.length - scale)}.${padded.slice(padded.length - scale)}`
}

/** Exact decimal; throws RangeError when the expansion does not terminate. */
function exactDecimal(r) {
	let den = r.den
	let twos = 0
	let fives = 0
	while (den % 2n === 0n) [den, twos] = [den / 2n, twos + 1]
	while (den % 5n === 0n) [den, fives] = [den / 5n, fives + 1]
	if (den !== 1n) throw new RangeError(`rational: ${r.num}/${r.den} has no finite decimal; pass sigFigs`)
	const scale = Math.max(twos, fives)
	const digits = (abs(r.num) * 10n ** BigInt(scale)) / r.den
	return (r.num < 0n ? "-" : "") + placeDecimal(digits.toString(), scale)
}

/** Number of decimal digits in the integer part of |num/den| (0 when below 1). */
function integerDigits(num, den) {
	const whole = num / den
	if (whole > 0n) return whole.toString().length
	let exp = 0
	let scaled = num
	while (scaled < den) [scaled, exp] = [scaled * 10n, exp - 1]
	return exp + 1
}

/**
 * Decimal string. Without sigFigs the value must terminate and is rendered exactly. With sigFigs it
 * is rounded half away from zero to that many significant figures; integers are never written
 * with an exponent, so 319999 at 2 figures renders "320000".
 */
export function toDecimal(value, sigFigs) {
	const r = coerce(value)
	if (sigFigs === undefined) return exactDecimal(r)
	if (!Number.isInteger(sigFigs) || sigFigs < 1) throw new RangeError("rational: sigFigs must be a positive integer")
	if (r.num === 0n) return sigFigs > 1 ? `0.${"0".repeat(sigFigs - 1)}` : "0"
	const num = abs(r.num)
	const scale = sigFigs - integerDigits(num, r.den)
	const numer = scale >= 0 ? num * 10n ** BigInt(scale) : num
	const denom = scale >= 0 ? r.den : r.den * 10n ** BigInt(-scale)
	let digits = numer / denom
	let places = scale
	if ((numer % denom) * 2n >= denom) digits += 1n
	if (digits.toString().length > sigFigs) [digits, places] = [digits / 10n, places - 1]
	return (r.num < 0n ? "-" : "") + placeDecimal(digits.toString(), places)
}

/**
 * Significant figures of a decimal string. With a decimal point: digits from the first nonzero
 * digit to the end, trailing zeros included ("3.2" -> 2, "0.050" -> 2). Without one: every digit
 * after leading zeros counts ("320" -> 3, "100" -> 3, "20" -> 2).
 */
export function sigFigsOf(decimalStr) {
	const match = DECIMAL.exec(String(decimalStr).trim())
	if (!match) throw new SyntaxError(`rational: "${decimalStr}" is not a plain decimal`)
	const [, , whole, frac] = match
	const digits = (whole + (frac ?? "")).replace(/^0+/, "")
	return Math.max(digits.length, 1)
}
