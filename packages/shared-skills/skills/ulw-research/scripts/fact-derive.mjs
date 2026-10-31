// Public append boundary: dispatch through the operation table, verify transitive trust, append only on success.
import { leaves, parseExpr } from "./fact-expr.mjs"
import { readRow } from "./fact-ledger-kinds.mjs"
import { addRow, nextId, validateLedger } from "./fact-ledger.mjs"
import { recompute, verifyGraph } from "./fact-recompute.mjs"
import { canonicalUnit, inputScale, refuse, RuleError } from "./unit-algebra.mjs"
import { refusal } from "./unit-errors.mjs"
import { object, sameDeclared } from "./unit-metadata.mjs"
import { display, renderValue, resultPrecision, toText } from "./unit-precision.mjs"
import { expectedUnit, renderPrecision, ruleOf, unitMismatch } from "./unit-rules.mjs"
export { recompute, display }

/** Arithmetic and generated fields are chosen exclusively by the registry. */
export function compute(op, rows, unit, ast, context, formula = null) {
	const rule = ruleOf(op)
	const out = rule.calculate(rows, context, ast, formula)
	const mode = renderPrecision(op, unit, ast)
	const precision = resultPrecision(rows, ast ? leaves(ast).literals : [], out.exact, mode)
	const value = renderValue(out.exact, precision, mode)
	const render = rule.render(display(value, unit), rows)
	return { exact: toText(out.exact), value, render, raw: render, formula: out.formula, factor: out.factor, precision, compatibility: rule.compatibility, ...rule.metadataResult(rows) }
}

function declaredUnit(spec, rule) {
	const own = Object.hasOwn(spec, "unit")
	if ((!own && !rule.defaultUnit) || (own && spec.unit === undefined)) refuse("declare the result unit: pass unit (null for a dimensionless result)", undefined, "missing_unit", "an explicit unit or null")
	const declared = own ? spec.unit : rule.defaultUnit(spec)
	if (inputScale(declared)) refuse(`${declared} needs rescaling: declare %p and scale the value`)
	return canonicalUnit(declared)
}

/** Refused before any work, under its own code: time is the caller's (spec.now), never the clock. */
const MISSING_NOW = Object.freeze({ error: "missing_now", shape: "missing_now", expected: "an ISO timestamp in spec.now", detail: "derive needs a caller-supplied now timestamp" })

export function derive(ledger, spec) {
	if (object(spec) && typeof spec.now !== "string") return { ...MISSING_NOW }
	try {
		if (!object(spec)) refuse("spec must be an object")
		const errors = validateLedger(ledger)
		if (errors.length) refuse(errors.join("; "), undefined, "ledger_schema", "a ledger conforming to KIND_RULES and canonical storage")
		const rule = ruleOf(spec.op)
		const allowed = ["op", "unit", "rationale", "label", "now", "context", ...rule.inputFields]
		if (Object.keys(spec).some((key) => !allowed.includes(key))) refuse("spec carries fields outside its operation", undefined, "spec_fields", allowed)
		const ast = rule.expression ? parseExpr(spec.formula) : null
		const ids = rule.operandIds(spec, ast)
		if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) refuse(`${spec.op} needs its operand fact ids`, undefined, "operands", "an array of existing fact ids")
		const verified = verifyGraph(ledger, ids, true)
		if (!verified.ok) return { error: "incompatible_operands", ...verified }
		const byId = new Map(ledger.rows.map((r) => [r.fact_id, r]))
		const rows = ids.map((id) => readRow(byId.get(id)))
		const context = rule.context(spec)
		if (Object.hasOwn(spec, "context") && !sameDeclared(spec.context, context)) refuse("supplied context differs from the operation's input fields", undefined, "context", context ?? "explicit null")
		const shape = rule.shape({ operation: spec.op, operands: ids, formula: spec.formula, context })
		if (shape) refuse(shape, undefined, "context_or_formula", "the operation's declared context and matching formula operand set")
		const expected = expectedUnit(spec.op, rows, { ast, context: { ...context, rationale: spec.rationale ?? null } })
		const declared = declaredUnit(spec, rule)
		if (declared !== expected) refuse(unitMismatch(spec.op, rows, declared, expected), undefined, "result_unit", { unit: expected })
		const result = compute(spec.op, rows, expected, ast, context, spec.formula)
		const row = addRow(ledger, {
			kind: rule.kind, unit: expected, quote: "", extracted_by: "fact-derive",
			observed_at: spec.now,
			label: spec.label ?? `${spec.op}-${nextId(ledger, rule.kind).toLowerCase()}`,
			...result, operation: spec.op, operands: ids, derived_from: ids,
			rationale: spec.rationale ?? null, context,
		})
		return { row, compatibility: rule.compatibility }
	} catch (error) {
		if (!(error instanceof RuleError)) throw error
		return { error: "incompatible_operands", ...refusal(error) }
	}
}
