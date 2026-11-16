// The pair-test matcher of script/rpc-relay-parity.ts: whether a curated pair-test file uses an RPC method as a record
// type in code (namesRecordType). It walks the oxc AST; the namesRecordType doc comment states the rule.
import { parseSync } from "oxc-parser"

type AstNode = { readonly type: string; readonly [key: string]: unknown }

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"

const WRAPPERS: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
])

/** `node` with type assertions and parentheses removed (`("m" as const)` is the literal `"m"`). */
const unwrap = (node: unknown): unknown => (isNode(node) && WRAPPERS.has(node.type) ? unwrap(node["expression"]) : node)

/** The string `value` as a literal: a quoted string or a template literal with no substitutions (`` `m` ``). */
const isLiteral = (node: unknown, value: string): boolean => {
  const bare = unwrap(node)
  if (!isNode(bare)) return false
  if (bare.type === "Literal") return bare["value"] === value
  const [quasi] = Array.isArray(bare["quasis"]) ? bare["quasis"] : []
  const cooked = isNode(quasi) ? Reflect.get(Object(quasi["value"]), "cooked") : undefined
  return (
    bare.type === "TemplateLiteral" &&
    Array.isArray(bare["expressions"]) &&
    bare["expressions"].length === 0 &&
    cooked === value
  )
}

/** `x.type`, `x["type"]` or their optional-chain forms (not `x.$type`, not `x.typeName`). */
const isTypeMember = (value: unknown): boolean => {
  const node = unwrap(value)
  if (isNode(node) && node.type === "ChainExpression") return isTypeMember(node["expression"])
  return (
    isNode(node) &&
    node.type === "MemberExpression" &&
    (node["computed"] === true
      ? isLiteral(node["property"], "type")
      : isNode(node["property"]) && node["property"]["name"] === "type")
  )
}

/** The identifier a `type` member is read from: `e` for `e.type`, `e?.type` or `(e as Frame).type`. */
const memberObjectName = (value: unknown): unknown => {
  const node = unwrap(value)
  if (isNode(node) && node.type === "ChainExpression") return memberObjectName(node["expression"])
  const object = isNode(node) && node.type === "MemberExpression" ? unwrap(node["object"]) : undefined
  return isNode(object) && object.type === "Identifier" ? object["name"] : undefined
}

/**
 * The name a destructured parameter binds the `type` field to: `t` for `({ type: t })`, `({ "type": t })` or
 * `({ ["type"]: t })`, `type` for `({ type })`.
 */
const boundTypeName = (param: unknown): unknown => {
  const props =
    isNode(param) && param.type === "ObjectPattern" && Array.isArray(param["properties"]) ? param["properties"] : []
  const field = props.find(
    (p) =>
      isNode(p) &&
      p.type === "Property" &&
      isNode(p["key"]) &&
      (p["computed"] === true
        ? isLiteral(p["key"], "type")
        : p["key"]["name"] === "type" || p["key"]["value"] === "type"),
  )
  const value = isNode(field) ? field["value"] : undefined
  return isNode(value) && value.type === "Identifier" ? value["name"] : undefined
}

/**
 * `list.map((e) => e.type)` (also `list?.map(...)`): the `type` field of the callback's own first parameter, read as
 * `e.type` or bound by destructuring (`({ type }) => type`, `({ type: t }) => t`), from an expression body or a block
 * that only returns it (an arrow or a function expression). `list.map((e) => other.type)` and a computed
 * `list[map](...)` do not count.
 */
const isTypeProjection = (value: unknown): boolean => {
  const bare = unwrap(value)
  const node = isNode(bare) && bare.type === "ChainExpression" ? bare["expression"] : bare
  if (!isNode(node) || node.type !== "CallExpression" || !isNode(node["callee"])) return false
  const callee = node["callee"]
  const [fn] = Array.isArray(node["arguments"]) ? node["arguments"] : []
  if (callee.type !== "MemberExpression" || callee["computed"] === true || !isNode(callee["property"])) return false
  if (callee["property"]["name"] !== "map") return false
  if (!isNode(fn) || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return false
  const [param] = Array.isArray(fn["params"]) ? fn["params"] : []
  const bound = boundTypeName(param)
  const ownType = (expr: unknown): boolean => {
    if (isNode(param) && param.type === "Identifier")
      return isTypeMember(expr) && memberObjectName(expr) === param["name"]
    const name = unwrap(expr)
    return bound !== undefined && isNode(name) && name.type === "Identifier" && name["name"] === bound
  }
  const body = fn["body"]
  if (ownType(body)) return true
  const statements = isNode(body) && Array.isArray(body["body"]) ? body["body"] : []
  const [only] = statements
  return statements.length === 1 && isNode(only) && only.type === "ReturnStatement" && ownType(only["argument"])
}

const EXPECT_MATCHERS: ReadonlySet<string> = new Set(["toBe", "toEqual", "toStrictEqual"])
const ASSERT_METHODS: ReadonlySet<string> = new Set(["equal", "strictEqual"])

/**
 * `expect(<type member>).toBe("m")` (or toEqual/toStrictEqual), `expect(<list>.map((e) => e.type)).toEqual(["m"])`
 * (or toStrictEqual; never toBe, which cannot pass on a fresh array), or `assert.equal(<type member>, "m")` (or
 * strictEqual, either argument order).
 */
function assertsRecordType(node: AstNode, method: string): boolean {
  const callee = node["callee"]
  const args = Array.isArray(node["arguments"]) ? node["arguments"] : []
  if (!isNode(callee) || callee.type !== "MemberExpression" || !isNode(callee["property"])) return false
  const name = String(callee["property"]["name"])
  const subject = callee["object"]
  if (isNode(subject) && subject.type === "Identifier" && subject["name"] === "assert" && ASSERT_METHODS.has(name)) {
    const [a, b] = args
    return (isTypeMember(a) && isLiteral(b, method)) || (isTypeMember(b) && isLiteral(a, method))
  }
  if (!EXPECT_MATCHERS.has(name) || !isNode(subject) || subject.type !== "CallExpression") return false
  const expectCallee = subject["callee"]
  if (!isNode(expectCallee) || expectCallee["name"] !== "expect" || !Array.isArray(subject["arguments"])) return false
  const [actual] = subject["arguments"]
  const [expected] = args
  if (isTypeMember(actual)) return isLiteral(expected, method)
  const items = isNode(expected) && expected.type === "ArrayExpression" ? expected["elements"] : undefined
  return (
    name !== "toBe" && isTypeProjection(actual) && Array.isArray(items) && items.some((item) => isLiteral(item, method))
  )
}

/** A record built with `method` as its type: an object property `type: "m"` (also `"type": "m"`, `["type"]: "m"`). */
function buildsRecord(node: AstNode, method: string): boolean {
  if (node.type !== "Property") return false
  const key = node["key"]
  // A computed key `{ [type]: "m" }` names whatever the variable holds, not the `type` field.
  const named =
    isNode(key) &&
    (node["computed"] === true ? isLiteral(key, "type") : key["name"] === "type" || key["value"] === "type")
  return named && isLiteral(node["value"], method)
}

/** A type test of a `type` field against `method`: "is" (`===`, `==`, a switch case, an assertion), "isNot" (`!==`, `!=`). */
function typeTest(node: AstNode, method: string): "is" | "isNot" | undefined {
  if (node.type === "SwitchStatement" && isTypeMember(node["discriminant"])) {
    const cases = node["cases"]
    return Array.isArray(cases) && cases.some((c) => isNode(c) && isLiteral(c["test"], method)) ? "is" : undefined
  }
  if (node.type === "BinaryExpression") {
    const [left, right] = [node["left"], node["right"]]
    if (!((isTypeMember(left) && isLiteral(right, method)) || (isTypeMember(right) && isLiteral(left, method)))) return
    const op = String(node["operator"])
    return op === "===" || op === "==" ? "is" : op === "!==" || op === "!=" ? "isNot" : undefined
  }
  return node.type === "CallExpression" && assertsRecordType(node, method) ? "is" : undefined
}

const literalIs = (node: unknown, value: unknown): boolean => {
  const bare = unwrap(node)
  return isNode(bare) && bare.type === "Literal" && bare["value"] === value
}

/** `false`, `0`, `-1` or `[]`: what an absence assertion compares its subject with. */
const isAbsentValue = (node: unknown): boolean => {
  const bare = unwrap(node)
  if (literalIs(bare, false) || literalIs(bare, 0)) return true
  if (isNode(bare) && bare.type === "UnaryExpression") return bare["operator"] === "-" && literalIs(bare["argument"], 1)
  return (
    isNode(bare) && bare.type === "ArrayExpression" && Array.isArray(bare["elements"]) && bare["elements"].length === 0
  )
}

const ABSENT_MATCHERS: ReadonlySet<string> = new Set(["toBeFalse", "toBeFalsy", "toBeUndefined", "toBeNull"])
const PRESENT_MATCHERS: ReadonlySet<string> = new Set(["toBeTrue", "toBeTruthy", "toBeDefined"])

/**
 * The subject a call asserts absent, or undefined: `expect(s)` with toBe/toEqual/toStrictEqual(false, 0, -1 or []),
 * toBeFalse, toBeFalsy, toBeUndefined, toBeNull or toHaveLength(0); `.not` with toBe/toEqual/toStrictEqual(true),
 * toBeTrue, toBeTruthy or toBeDefined; `assert.equal(s, false)` or strictEqual, either argument order.
 */
function absentSubject(node: AstNode): unknown {
  const callee = node["callee"]
  if (node.type !== "CallExpression" || !isNode(callee) || callee.type !== "MemberExpression") return undefined
  const name = isNode(callee["property"]) ? String(callee["property"]["name"]) : ""
  const args = Array.isArray(node["arguments"]) ? node["arguments"] : []
  const object = callee["object"]
  if (isNode(object) && object.type === "Identifier" && object["name"] === "assert") {
    const [a, b] = args
    if (!ASSERT_METHODS.has(name)) return undefined
    return literalIs(b, false) ? a : literalIs(a, false) ? b : undefined
  }
  const inner = isNode(object) && object.type === "MemberExpression" ? object : undefined
  const not = inner !== undefined && isNode(inner["property"]) && inner["property"]["name"] === "not"
  const call = not && inner !== undefined ? inner["object"] : object
  if (!isNode(call) || call.type !== "CallExpression" || !isNode(call["callee"])) return undefined
  if (call["callee"]["name"] !== "expect" || !Array.isArray(call["arguments"])) return undefined
  const [arg] = args
  const asserted = not
    ? PRESENT_MATCHERS.has(name) || (EXPECT_MATCHERS.has(name) && literalIs(arg, true))
    : ABSENT_MATCHERS.has(name) ||
      (name === "toHaveLength" && literalIs(arg, 0)) ||
      (EXPECT_MATCHERS.has(name) && isAbsentValue(arg))
  return asserted ? call["arguments"][0] : undefined
}

/** Whether a statement only throws: `throw ...` or a block holding just that. */
const onlyThrows = (node: unknown): boolean =>
  isNode(node) &&
  (node.type === "ThrowStatement" ||
    (node.type === "BlockStatement" &&
      Array.isArray(node["body"]) &&
      node["body"].length === 1 &&
      onlyThrows(node["body"][0])))

const children = (node: AstNode): unknown[] =>
  Object.entries(node).flatMap(([key, child]) => (key !== "type" && typeof child === "object" ? [child] : []))

/** Names the file asserts absent (`expect(has).toBe(false)`): their initializers are negated (see counts). */
function absentNames(value: unknown, names: Set<string>): Set<string> {
  if (Array.isArray(value)) for (const item of value) absentNames(item, names)
  if (!isNode(value)) return names
  const subject = unwrap(absentSubject(value))
  if (isNode(subject) && subject.type === "Identifier") names.add(String(subject["name"]))
  for (const child of children(value)) absentNames(child, names)
  return names
}

/** Whether `value` builds a `method` record, or makes a positive type test of it under the `negated` parity. */
function counts(value: unknown, method: string, negated: boolean, absent: ReadonlySet<string>): boolean {
  const walk = (child: unknown, flip = false): boolean => counts(child, method, flip !== negated, absent)
  if (Array.isArray(value)) return value.some((item) => walk(item))
  if (!isNode(value)) return false
  if (buildsRecord(value, method)) return true
  const test = typeTest(value, method)
  if (test !== undefined && (test === "is") !== negated) return true
  if (value.type === "UnaryExpression" && value["operator"] === "!") return walk(value["argument"], true)
  if (value.type === "IfStatement" && onlyThrows(value["consequent"]))
    return walk(value["test"], true) || walk(value["consequent"]) || walk(value["alternate"])
  const subject = absentSubject(value)
  const others = (Array.isArray(value["arguments"]) ? value["arguments"] : []).filter((arg) => arg !== subject)
  if (subject !== undefined) return walk(subject, true) || walk(others)
  const id = value.type === "VariableDeclarator" && isNode(value["id"]) ? value["id"]["name"] : undefined
  if (typeof id === "string" && absent.has(id)) return walk(value["init"], true)
  return children(value).some((child) => walk(child))
}

/**
 * Whether `source` (parsed as TypeScript) uses `method` as a record type in code. The rule: the file BUILDS a record of
 * that type, or makes a POSITIVE claim that a record is of that type.
 * - Building: an object whose `type` property is the method (`{ type: "m" }`, `{ "type": "m" }`, `{ ["type"]: "m" }`).
 *   A built record counts wherever it sits, negated or not.
 * - Claiming: a type test of a record's `type` field: an equality (`x.type === "m"`, `==`), a `case "m":` of a switch
 *   on it, or an assertion that it is the method (`expect(x.type).toBe("m")` or toEqual/toStrictEqual,
 *   `assert.equal(x.type, "m")` or strictEqual in either order, `expect(list.map((e) => e.type)).toEqual(["m"])`).
 *   An inequality (`!==`, `!=`) is the negated test. A test counts when the number of negations around it is even.
 *   Each of these negates: `!`; the test of an `if` whose branch only throws (a guard asserts the opposite of its
 *   test); a subject asserted absent (see absentSubject); and the initializer of a variable asserted absent (see
 *   absentNames).
 * Forms: a `type` field is `x.type`, `x["type"]` or an optional chain; a mapped list is `list.map(cb)` or
 * `list?.map(cb)` whose callback returns its own parameter's `type` field (`(e) => e.type`, `({ type }) => type`, or a
 * block that only returns it); a literal is a quoted string or a template literal without substitutions. Literals,
 * fields and switch discriminants may sit under parentheses, `as`, `satisfies`, a non-null `!` or `<T>`.
 * Nothing else counts: a computed key from a variable (`{ [type]: "m" }`), other fields (`$type`), comments, strings,
 * regex literals, type declarations, and a source that does not parse.
 */
export function namesRecordType(source: string, method: string): boolean {
  const parsed = parseSync("pair-test.ts", source)
  return parsed.errors.length === 0 && counts(parsed.program, method, false, absentNames(parsed.program, new Set()))
}
