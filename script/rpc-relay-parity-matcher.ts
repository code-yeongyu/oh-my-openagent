// The pair-test matcher of script/rpc-relay-parity.ts: whether a curated pair-test file uses an RPC method as a record
// type in code (namesRecordType). It walks the oxc AST; the namesRecordType doc comment lists every counted and refused
// form.
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

/** The name a destructured parameter binds the `type` field to: `t` for `({ type: t })`, `type` for `({ type })`. */
const boundTypeName = (param: unknown): unknown => {
  const props =
    isNode(param) && param.type === "ObjectPattern" && Array.isArray(param["properties"]) ? param["properties"] : []
  const field = props.find(
    (p) =>
      isNode(p) &&
      p.type === "Property" &&
      isNode(p["key"]) &&
      (p["computed"] === true ? isLiteral(p["key"], "type") : p["key"]["name"] === "type"),
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

/** Whether one AST node uses `method` as a record type (see namesRecordType). */
function usesRecordType(node: AstNode, method: string): boolean {
  if (node.type === "Property") {
    const key = node["key"]
    // A computed key `{ [type]: "m" }` names whatever the variable holds, not the `type` field.
    const named =
      isNode(key) &&
      (node["computed"] === true ? isLiteral(key, "type") : key["name"] === "type" || key["value"] === "type")
    return named && isLiteral(node["value"], method)
  }
  if (node.type === "SwitchStatement" && isTypeMember(node["discriminant"])) {
    const cases = node["cases"]
    return Array.isArray(cases) && cases.some((c) => isNode(c) && isLiteral(c["test"], method))
  }
  // Only equality counts: `x.type !== "m"` (as in `filter((f) => f.type !== "m")`) excludes the method (as `.not.toBe`
  // does).
  if (node.type === "BinaryExpression" && ["===", "=="].includes(String(node["operator"]))) {
    const [left, right] = [node["left"], node["right"]]
    return (isTypeMember(left) && isLiteral(right, method)) || (isTypeMember(right) && isLiteral(left, method))
  }
  if (node.type === "CallExpression") return assertsRecordType(node, method)
  return false
}

const FALSE_MATCHERS: ReadonlySet<string> = new Set(["toBeFalse", "toBeFalsy"])
const TRUE_MATCHERS: ReadonlySet<string> = new Set(["toBeTrue", "toBeTruthy"])

/**
 * An exclusion: the operand of `!` (`!(f.type === "m")`), or an assertion that its subject is false
 * (`expect(...).toBe(false)` or toEqual/toStrictEqual(false), `.toBeFalse()`, `.toBeFalsy()`, `.not.toBe(true)`,
 * `.not.toBeTrue()`, `.not.toBeTruthy()`). Nothing inside one names the method.
 */
function excludes(node: AstNode): boolean {
  if (node.type === "UnaryExpression") return node["operator"] === "!"
  const callee = node["callee"]
  if (node.type !== "CallExpression" || !isNode(callee) || callee.type !== "MemberExpression") return false
  const name = isNode(callee["property"]) ? callee["property"]["name"] : undefined
  const [arg] = Array.isArray(node["arguments"]) ? node["arguments"] : []
  const literal = (value: boolean): boolean => {
    const bare = unwrap(arg)
    return isNode(bare) && bare.type === "Literal" && bare["value"] === value
  }
  const object = callee["object"]
  const property = isNode(object) && object.type === "MemberExpression" ? object["property"] : undefined
  const not = isNode(property) && property["name"] === "not"
  if (typeof name !== "string") return false
  if (not) return TRUE_MATCHERS.has(name) || (EXPECT_MATCHERS.has(name) && literal(true))
  return FALSE_MATCHERS.has(name) || (EXPECT_MATCHERS.has(name) && literal(false))
}

/** Whether `value` holds a node that uses `method` as a record type outside an exclusion (see excludes). */
function someCounted(value: unknown, method: string): boolean {
  if (Array.isArray(value)) return value.some((item) => someCounted(item, method))
  if (!isNode(value) || excludes(value)) return false
  if (usesRecordType(value, method)) return true
  return Object.entries(value).some(
    ([key, child]) => key !== "type" && typeof child === "object" && someCounted(child, method),
  )
}

/**
 * Whether `source` (parsed as TypeScript) uses `method` as a record type in code. These count:
 * - the quoted name as the value of a `type` property in an object (`{ type: "m" }`, also `{ ["type"]: "m" }`);
 * - a `type` member (`x.type`, `x["type"]`, optional chains) compared equal with it (`===`, `==`), or switched on with
 *   a `case "m":`;
 * - an assertion on a `type` member: `expect(x.type).toBe("m")` (or `toEqual`, `toStrictEqual`),
 *   `expect(list.map((e) => e.type)).toEqual(["m"])` (or `toStrictEqual`; also `list?.map`; the callback's own
 *   parameter, `e.type` or destructured `({ type }) => type`, from an expression or single-return block body), or
 *   `assert.equal(x.type, "m")` (or `strictEqual`, either argument order).
 * The literal may be a quoted string or a template literal with no substitutions. A literal, a `type` member and a
 * switch discriminant may each sit in parentheses or under `as`, `satisfies`, a non-null `!` or a `<T>` assertion.
 * These do not count: a computed key (`{ [type]: "m" }`); a negative comparison (`!==`, `!=`, such as the exclusion
 * `filter((f) => f.type !== "m")`); anything inside an exclusion (see excludes), such as
 * `filter((f) => !(f.type === "m"))` or `expect(list.some((e) => e.type === "m")).toBe(false)`; an assertion whose
 * subject is not a bare `expect(...)` or whose object is not `assert`; a mapped list that projects anything but the
 * callback parameter's `type`, a computed `list[map](...)`, or `.toBe([...])` on a mapped list; comments, strings (a
 * test title), regex literals, type declarations, other properties such as `$type`; and a source that does not parse.
 */
export function namesRecordType(source: string, method: string): boolean {
  const parsed = parseSync("pair-test.ts", source)
  return parsed.errors.length === 0 && someCounted(parsed.program, method)
}
