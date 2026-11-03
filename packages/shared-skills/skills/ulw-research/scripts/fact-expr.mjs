// fact-expr.mjs - the expression language of `fact derive --op expr` (references/unit-rules.md, expr row).
// Leaves are fact ids and decimal literals; nodes are + - * / and pct(x), the explicit dimensionless-to-% node.
// evaluate() is exact rational arithmetic. Under * and / a child whose inferred unit is % or %p enters as its
// fraction (20% as 0.2): that unit comes from the registry's inference over the operand rows, never from the row's
// own declared unit.

import { add, div, fromDecimal, mul, sub } from "./rational.mjs"
import { isPercentish, refuse } from "./unit-algebra.mjs"

const TOKEN = /\s*(?:(F\d+)|(\d+(?:\.\d+)?)|(pct)\b|([-+*/()]))/y
const HUNDRED = fromDecimal("100")

function tokenize(formula) {
	const text = String(formula ?? "")
	const tokens = []
	TOKEN.lastIndex = 0
	while (/\S/.test(text.slice(TOKEN.lastIndex))) {
		const at = TOKEN.lastIndex
		const match = TOKEN.exec(text)
		if (!match) refuse(`unsupported expression text at ${at}: "${text.slice(at).trim().slice(0, 16)}"`)
		tokens.push(match[1] ? { id: match[1] } : match[2] ? { literal: match[2] } : match[3] ? { fn: "pct" } : { op: match[4] })
	}
	if (tokens.length === 0) refuse("expr needs an expression")
	return tokens
}

/** Shunting-yard parser: parentheses and AST depth do not consume the JS call stack. */
export function parseExpr(formula) {
	if (typeof formula !== "string") refuse("expr needs an expression")
	const tokens = tokenize(formula)
	const values = []
	const ops = []
	const precedence = (op) => op === "*" || op === "/" ? 2 : 1
	const reduce = () => {
		const op = ops.pop()
		if (op === "pct") values.push({ fn: op, arg: values.pop() })
		else { const right = values.pop(); values.push({ op, left: values.pop(), right }) }
	}
	let need = true
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (need) {
			if (token.id || token.literal) { values.push(token); need = false }
			else if (token.fn) {
				if (tokens[i + 1]?.op !== "(") refuse("pct needs a parenthesized argument")
				ops.push("pct")
			} else if (token.op === "(") ops.push("(")
			else refuse(`unexpected "${token.op}" in the expression`)
		} else if (token.op === ")") {
			while (ops.length && ops.at(-1) !== "(") reduce()
			if (ops.pop() !== "(") refuse("unexpected closing parenthesis")
			if (ops.at(-1) === "pct") reduce()
		} else if (["+", "-", "*", "/"].includes(token.op)) {
			while (ops.length && ops.at(-1) !== "(" && precedence(ops.at(-1)) >= precedence(token.op)) reduce()
			ops.push(token.op)
			need = true
		} else refuse("unexpected text after the expression")
	}
	if (need) refuse("the expression ends early")
	if (ops.includes("(")) refuse("the expression is missing a closing parenthesis")
	while (ops.length) reduce()
	return values[0]
}

const childrenOf = (node) => (node.op ? [node.left, node.right] : node.fn ? [node.arg] : [])

export function leaves(node, found = { ids: [], literals: [] }) {
	const ids = new Set(found.ids)
	const stack = [node]
	while (stack.length) {
		const current = stack.pop()
		if (current.id) ids.add(current.id)
		if (current.literal) found.literals.push(current.literal)
		stack.push(...childrenOf(current).reverse())
	}
	found.ids = [...ids]
	return found
}

export function postorder(node) {
	const stack = [node]
	const order = []
	while (stack.length) { const current = stack.pop(); order.push(current); stack.push(...childrenOf(current)) }
	return order.reverse()
}

/** Exact value of the tree; `units` maps each node to its inferred canonical unit (inferExpr in unit-rules.mjs). */
export function evaluate(node, values, units) {
	const results = new Map()
	for (const current of postorder(node)) {
		let value
		if (current.id) value = values.get(current.id)
		else if (current.literal) value = fromDecimal(current.literal)
		else if (current.fn === "pct") value = mul(results.get(current.arg), HUNDRED)
		else {
			const operand = (child) => {
				const v = results.get(child)
				return (current.op === "*" || current.op === "/") && isPercentish(units.get(child)) ? div(v, HUNDRED) : v
			}
			const left = operand(current.left)
			const right = operand(current.right)
			if (current.op === "/" && right.num === 0n) refuse("the expression divides by zero", undefined, "divides_by_zero", "a nonzero denominator")
			value = { "+": add, "-": sub, "*": mul, "/": div }[current.op](left, right)
		}
		results.set(current, value)
	}
	return results.get(node)
}
