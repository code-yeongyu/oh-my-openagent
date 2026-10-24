// Structural rules used by the operation table, shared by schema and recomputation.
import { leaves, parseExpr } from "./fact-expr.mjs"
import { isRational } from "./fact-ledger-kinds.mjs"
import { canonicalUnit, RuleError } from "./unit-algebra.mjs"
import { nonEmpty, object } from "./unit-metadata.mjs"
import { show } from "./unit-pairs.mjs"

export const COMMON = ["operands null", "operands empty", "wrong arity", "missing operand id", "invalid rational", "no operation", "repeated operand", "self reference",
	"kind operation", "audit fields", "precision field", "compatibility field", "metadata fields", "noncanonical operand"]
export const shapes = (...own) => Object.freeze([...COMMON, ...own])
export const needsContext = (row) => object(row.context) ? null : `${row.operation} rows carry a context object, got ${show(row.context)}`
export const noContext = (row) => row.context === null ? null : `${row.operation} rows carry no context, got ${show(row.context)}`
export const repeatedOperand = (ids) => new Set(ids).size !== ids.length ? `operand ${ids.find((id, i) => ids.indexOf(id) !== i)} is repeated: the operands of one row are distinct facts` : null

export function sumShape(row) {
	const missing = needsContext(row)
	if (missing) return missing
	const c = row.context
	if (Object.keys(c).sort().join(",") !== "disjoint,reference" || typeof c.disjoint !== "boolean" || !(c.reference === null || nonEmpty(c.reference) || object(c.reference))) return "sum context needs exactly boolean disjoint and null, text, or map reference"
	if (object(c.reference) && (Object.keys(c.reference).sort().join(",") !== [...row.operands].sort().join(",") || !Object.values(c.reference).every(nonEmpty))) return "reference map must name exactly the supplied operands"
	return null
}

export function convertShape(row) {
	const target = object(row.context) ? row.context.target : undefined
	if (!nonEmpty(target)) return needsContext(row) ?? "a convert row carries its target in context.target"
	if (Object.keys(row.context).join(",") !== "target") return "convert context has exactly target"
	try {
		const canonical = canonicalUnit(target)
		return canonical === target ? null : `context.target ${show(target)} is not canonical unit text (canonical: ${show(canonical)})`
	} catch (error) {
		if (error instanceof RuleError) return `context.target ${show(target)} is not unit text: ${error.detail}`
		throw error
	}
}

export function exprShape(row) {
	try {
		const ids = leaves(parseExpr(row.formula)).ids
		if (ids.length !== row.operands.length || ids.some((id) => !row.operands.includes(id))) return `formula ids ${ids.join(", ")} do not match operands ${row.operands.join(", ")}`
		return null
	} catch (error) {
		if (error instanceof RuleError) return error.detail
		throw error
	}
}

export function rowShape(row, rules) {
	if (!object(row)) return "the row is not an object"
	if (!Object.hasOwn(rules, row.operation)) return `operation ${show(row.operation)} is not one of ${Object.keys(rules).join(", ")}`
	const rule = rules[row.operation]
	const { operands, exact } = row
	if (!Array.isArray(operands) || !operands.length || !operands.every(nonEmpty)) return `operands must be a non-empty array of fact ids, got ${show(operands)}`
	const repeated = repeatedOperand(operands)
	if (repeated) return repeated
	if (operands.includes(row.fact_id)) return `${row.fact_id} cites itself as an operand`
	if (!rule.arity(operands.length)) return `${row.operation} takes ${rule.arityText}, got ${operands.length}`
	if (!isRational(exact)) return `exact must be { num, den } reduced integer strings, got ${show(exact)}`
	if (row.kind !== rule.kind) return `kind ${row.kind} must be ${rule.kind} for ${row.operation}`
	const own = rule.shape(row)
	if (own) return own
	if (!nonEmpty(row.formula) || !Array.isArray(row.derived_from) || row.derived_from.length !== operands.length) return "formula and derived_from are required audit fields"
	return null
}
