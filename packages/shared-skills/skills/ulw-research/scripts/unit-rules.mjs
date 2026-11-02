// The sole per-operation registry: guards, context, arithmetic, precision, audit and compatibility.
import { evaluate, leaves } from "./fact-expr.mjs"
import { add, div, mul, sub, toDecimal } from "./rational.mjs"
import { canonicalUnit, inputScale, isAffine, isCurrencyRate, isPercentish, refuse, RuleError, unitOver } from "./unit-algebra.mjs"
import { checkMetadata, nonEmpty, object, propagatedMetadata } from "./unit-metadata.mjs"
import { equalUnits, inferExpr, listed, minusUnit, notAffine, show } from "./unit-pairs.mjs"
import { display, terminates, toBig } from "./unit-precision.mjs"
import { convertShape, exprShape, noContext, repeatedOperand, rowShape, shapes, sumShape } from "./unit-rules-shapes.mjs"
import { convertFactor, dimensionOf } from "./units.mjs"
export { canonicalUnit, inferExpr, isAffine, RuleError }

const EXPR_HINT = "currencies never convert by table: add a dated rate row and use --op expr"
const compare = (a, b) => a.num * b.den - b.num * a.den
const SNAPSHOT = ["population", "snapshot_window"]
const ADDITIVE = [...SNAPSHOT, "accounting_basis"]
const pair = (a, b) => (spec) => [spec[a], spec[b]]
const listOf = (spec) => spec.operands
const generated = (exact, formula, factor = null) => ({ exact, formula, factor })
const idsOf = (rows) => rows.map((r) => r.fact_id)
const valuesOf = (rows) => rows.map((r) => toBig(r.exact))
const ordinary = {
	kind: "derived", compatibility: "checked", context: () => null, shape: noContext,
	precision: () => "sigfigs", render: (shown) => shown, metadataResult: propagatedMetadata,
}
const binary = { ...ordinary, arity: (n) => n === 2, arityText: "two operands" }

function sharedReference(rows, reference) {
	if (nonEmpty(reference)) return
	if (object(reference)) {
		const named = rows.map((r) => reference[r.fact_id])
		if (Object.keys(reference).length === rows.length && named.every(nonEmpty) && named.every((v) => v === named[0])) return
		refuse("% operands name different references or missing/extra ids", undefined, "reference", "one denominator for exactly the operands")
	}
	refuse("summing % operands needs one shared reference (denominator): pass reference")
}

/** Registry rows own every operation-specific choice; consumers only dispatch through these rows. */
export const OPERATION_RULES = Object.freeze({
	sum: Object.freeze({
		...ordinary, arity: (n) => n >= 2, arityText: "two or more operands", operandIds: listOf,
		inputFields: ["operands", "disjoint", "reference"],
		context: (s) => ({ disjoint: Object.hasOwn(s, "disjoint") ? s.disjoint : false, reference: Object.hasOwn(s, "reference") ? s.reference : null }),
		metadata: ADDITIVE, precision: () => "places", shape: sumShape,
		resultUnit(rows, units, context) {
			notAffine("sum", rows, units)
			const unit = equalUnits(rows, units)
			if (unit === "%") {
				if (context.disjoint !== true) refuse("summing % operands needs disjoint shares: pass disjoint")
				sharedReference(rows, context.reference)
				if (!nonEmpty(context.rationale)) refuse("summing % operands needs a rationale for the disjoint shares")
				const values = valuesOf(rows)
				if (values.some((r) => r.num < 0n || r.num > 100n * r.den) || compare(values.reduce(add), { num: 100n, den: 1n }) > 0n) refuse("disjoint shares must each be in [0, 100] and total <= 100", undefined, "share_total", "valid disjoint shares totaling at most 100%")
			}
			return unit
		},
		calculate: (rows) => generated(valuesOf(rows).reduce(add), idsOf(rows).join(" + ")),
		malformed: shapes("no context", "% without disjoint", "% without reference", "% without rationale", "unequal units", "affine units", "closed context", "share total"),
	}),
	diff: Object.freeze({
		...binary, operandIds: listOf, metadata: ADDITIVE, precision: () => "places",
		inputFields: ["operands"],
		resultUnit: (rows, units) => minusUnit(units[0], units[1], `diff ${listed(rows, units)}`),
		calculate: (rows) => generated(sub(...valuesOf(rows)), idsOf(rows).join(" - ")),
		malformed: shapes("%p - % pair", "unit - other unit pair", "affine units", "stray context"),
	}),
	growth: Object.freeze({
		...binary, arityText: "two operands (from, to)", operandIds: pair("from", "to"), metadata: ["population", "accounting_basis"],
		inputFields: ["from", "to"],
		resultUnit(rows, units) {
			const [from, to] = rows
			notAffine("growth", rows, units)
			equalUnits(rows, units)
			if (!nonEmpty(from.entity) || from.entity !== to.entity) refuse(`growth needs one declared entity: ${from.entity} vs ${to.entity}`)
			if (!nonEmpty(from.valid_at) || !nonEmpty(to.valid_at) || from.valid_at === to.valid_at) refuse(`growth needs two different valid_at periods: ${from.valid_at} vs ${to.valid_at}`)
			if (toBig(from.exact).num <= 0n) refuse(`growth needs a positive starting value in ${from.fact_id}`)
			return "%"
		},
		calculate(rows) { const [a, b] = valuesOf(rows); const [x, y] = idsOf(rows); return generated(mul(div(sub(b, a), a), 100n), `(${y} - ${x}) / ${x} * 100`) },
		malformed: shapes("affine units", "unequal units", "entity mismatch", "one period", "from <= 0", "stray context"),
	}),
	share: Object.freeze({
		...binary, arityText: "two operands (part, whole)", operandIds: pair("part", "whole"), metadata: SNAPSHOT,
		inputFields: ["part", "whole"],
		resultUnit(rows, units) {
			notAffine("share", rows, units)
			equalUnits(rows, units)
			const [part, whole] = valuesOf(rows)
			if (whole.num <= 0n) refuse(`share needs a positive whole in ${rows[1].fact_id}`)
			if (part.num < 0n || compare(part, whole) > 0n) refuse(`share needs 0 <= part <= whole: ${rows[0].fact_id} is outside [0, ${rows[1].fact_id}]`)
			return "%"
		},
		calculate: (rows) => generated(mul(div(...valuesOf(rows)), 100n), `${idsOf(rows).join(" / ")} * 100`),
		malformed: shapes("affine units", "unequal units", "whole <= 0", "part < 0", "part above whole", "stray context"),
	}),
	ratio: Object.freeze({
		...binary, arityText: "two operands (num, den)", operandIds: pair("num", "den"), metadata: SNAPSHOT,
		inputFields: ["num", "den"],
		resultUnit(rows, units) {
			notAffine("ratio", rows, units)
			if (toBig(rows[1].exact).num === 0n) refuse(`ratio denominator ${rows[1].fact_id} is zero`)
			if (units[0] === units[1]) return null
			if (units.some(isPercentish)) refuse(`a ratio over % or %p needs equal units: ${listed(rows, units)}; use expr`)
			return unitOver(units[0], units[1])
		},
		calculate: (rows) => generated(div(...valuesOf(rows)), idsOf(rows).join(" / ")),
		malformed: shapes("affine units", "divides by zero", "stray context"),
	}),
	convert: Object.freeze({
		...ordinary, kind: "converted", arity: (n) => n === 1, arityText: "one operand", operandIds: listOf, metadata: [],
		inputFields: ["operands", "to"],
		context: (s) => ({ target: canonicalUnit(s.to) }), shape: convertShape,
		defaultUnit: (s) => s.to,
		resultUnit(rows, units, context) {
			if (!nonEmpty(context.target)) refuse("convert needs a target unit")
			const [from] = units
			const target = context.target
			if (from === target) refuse(`${rows[0].fact_id} is already in ${target}`)
			if ([from, target].some((u) => dimensionOf(u)?.startsWith("currency:"))) refuse(`${rows[0].fact_id} in ${show(from)} has no table conversion to ${target} (a currency)`, EXPR_HINT)
			if (!convertFactor(from, target)) refuse(`${rows[0].fact_id} in ${show(from)} has no table conversion to ${target}`)
			return target
		},
		calculate(rows, context) {
			const row = rows[0]
			const f = convertFactor(row.unit, context.target)
			const scale = { num: f.num, den: f.den }
			const text = terminates(scale) ? toDecimal(scale) : `${scale.num}/${scale.den}`
			return generated(add(mul(toBig(row.exact), scale), f.offset ?? 0n), `${row.fact_id} * ${text}${f.offset ? ` + ${f.offset.num}/${f.offset.den}` : ""}`, terminates(scale) ? text : null)
		},
		render: (shown, rows) => `${shown} (${display(rows[0].value, rows[0].unit)})`,
		malformed: shapes("no context", "empty target", "alias target", "currency target", "no factor to target", "closed context"),
	}),
	expr: Object.freeze({
		...ordinary, arity: (n) => n >= 1, arityText: "one or more operands", compatibility: "unchecked",
		expression: true, operandIds: (s, ast) => Object.hasOwn(s, "operands") ? s.operands : leaves(ast).ids,
		inputFields: ["formula", "operands"],
		metadata: [], precision: (ast) => ast?.op === "+" || ast?.op === "-" ? "places" : "sigfigs",
		resultUnit(rows, units, _context, ast) {
			for (const r of rows) if (isCurrencyRate(r.unit) && !nonEmpty(r.valid_at)) refuse(`FX rate ${r.fact_id} needs a dated valid_at; date compatibility remains unchecked`, EXPR_HINT, "undated_rate", "a dated FX rate row")
			const inferred = inferExpr(ast, new Map(rows.map((r, i) => [r.fact_id, units[i]])), new Map(rows.map((r) => [r.fact_id, r]))).unit
			notAffine("expr", rows, units)
			return inferred
		},
		calculate(rows, _context, ast, formula) {
			const { units } = inferExpr(ast, new Map(rows.map((r) => [r.fact_id, r.unit])))
			return generated(evaluate(ast, new Map(rows.map((r) => [r.fact_id, toBig(r.exact)])), units), formula.trim())
		},
		shape: (row) => noContext(row) ?? exprShape(row),
		malformed: shapes("formula id mismatch", "parse error", "divides by zero", "uninferable unit", "affine sum", "stray context", "undated rate"),
	}),
})

export function ruleOf(op) {
	if (!Object.hasOwn(OPERATION_RULES, op)) refuse(`unknown operation ${String(op)}; use one of ${Object.keys(OPERATION_RULES).join(", ")}`, undefined, "operation", Object.keys(OPERATION_RULES))
	return OPERATION_RULES[op]
}
export function operandUnit(row) {
	if (canonicalUnit(row.unit) !== row.unit || inputScale(row.unit)) refuse(`${row.fact_id} unit must be canonical stored text`, undefined, "noncanonical_operand", { unit: canonicalUnit(row.unit) })
	return row.unit
}
export function expectedUnit(op, rows, { ast = null, context = null } = {}) {
	const rule = ruleOf(op)
	const repeated = repeatedOperand(idsOf(rows))
	if (repeated) refuse(repeated, undefined, "repeated_operand", "distinct operand ids")
	if (!rule.arity(rows.length)) refuse(`${op} takes ${rule.arityText}, got ${rows.length}`, undefined, "arity", rule.arityText)
	const units = rows.map(operandUnit)
	checkMetadata(rows, rule.metadata)
	return rule.resultUnit(rows, units, context ?? {}, ast)
}
export function renderPrecision(op, unit, ast = null) {
	return unit === "%p" ? "places" : ruleOf(op).precision(ast)
}
export const unitMismatch = (op, rows, unit, expected) => `unit ${show(unit)} does not follow from ${op} over ${rows.map((r) => `${r.fact_id} ${r.unit ?? "null"}`).join(", ")}: expected unit ${show(expected)}`
export const malformed = (row) => rowShape(row, OPERATION_RULES)
