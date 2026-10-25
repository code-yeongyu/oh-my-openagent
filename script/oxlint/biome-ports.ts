// Biome rules that oxlint 1.89.0 has no rule for, ported so replacing Biome loses no check:
// style/noEnum, suspicious/noImplicitAnyLet and correctness/noStringCaseMismatch. Each flags the same
// lines as Biome 2.5.14 on its corpus in script/oxlint/parity (checked by script/oxlint/biome-parity.test.ts).
type Node = { readonly type: string; readonly [key: string]: unknown };
type Token = { readonly type: string; readonly value: string };
type RuleContext = {
  readonly filename?: string;
  readonly sourceCode: {
    getTokensBetween(left: Node, right: Node): readonly Token[];
    getTokenBefore(node: Node | Token): Token | null;
    getAncestors(node: Node): readonly Node[];
  };
  readonly report: (problem: { readonly node: Node; readonly message: string }) => void;
};
type Case = "upper" | "lower";

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string";
const child = (node: Node, key: string): Node | undefined => {
  const value = node[key];
  return isNode(value) ? value : undefined;
};
const nodes = (value: unknown): readonly Node[] => (Array.isArray(value) ? value.filter(isNode) : []);

// The source text of a static value, as Biome's `as_static_value().text()` gives it: a string's
// characters between the quotes (escapes still written out), a template with no expressions, and the
// written form of `null`, `undefined`, a boolean, a number or a bigint.
const constantText = (node: Node | undefined): string | undefined => {
  if (node?.type === "Identifier") return node["name"] === "undefined" ? "undefined" : undefined;
  if (node?.type === "Literal") {
    const raw = node["raw"];
    if (typeof raw !== "string" || node["regex"] !== undefined) return undefined;
    return typeof node["value"] === "string" ? raw.slice(1, -1) : raw;
  }
  if (node?.type !== "TemplateLiteral" || nodes(node["expressions"]).length > 0) return undefined;
  const raw = Reflect.get(Object(nodes(node["quasis"])[0]?.["value"]), "raw");
  return typeof raw === "string" ? raw : undefined;
};

// `s.toUpperCase()`, `s?.toUpperCase()` and `s["toUpperCase"]()` change case; anything else does not.
const caseOf = (node: Node | undefined): Case | undefined => {
  const call = node?.type === "ChainExpression" ? child(node, "expression") : node;
  // Biome counts only a call with no arguments.
  const callee = call?.type === "CallExpression" && nodes(call["arguments"]).length === 0 ? child(call, "callee") : undefined;
  if (callee?.type !== "MemberExpression") return undefined;
  const property = child(callee, "property");
  const name = callee["computed"] === true ? constantText(property) : property?.type === "Identifier" ? property["name"] : undefined;
  return name === "toUpperCase" ? "upper" : name === "toLowerCase" ? "lower" : undefined;
};

// The case of each character, read the way Biome's CharCaseIterator reads the source text. An escape is
// skipped, not decoded, with its exact quirks: `\xHH` skips two characters, `\u{...}` up to the brace,
// `\uHHHH` five (one more than the escape), and any other escape (`\n`, `\\`) the next character too.
// Unicode's Uppercase and Lowercase properties match Rust's char::is_uppercase / is_lowercase.
function* charCases(text: string): Generator<Case> {
  const chars = [...text];
  let index = 0;
  while (index < chars.length) {
    const char = chars[index++] ?? "";
    if (char !== "\\") {
      if (/\p{Uppercase}/u.test(char)) yield "upper";
      else if (/\p{Lowercase}/u.test(char)) yield "lower";
      continue;
    }
    if (index >= chars.length) return;
    const escape = chars[index++];
    if (escape === "x") index += 2;
    else if (escape === "u") {
      if (index >= chars.length) return;
      if (chars[index++] === "{") {
        while (true) {
          if (index >= chars.length) return;
          if (chars[index++] === "}") break;
        }
      } else index += 4;
    } else index += 1;
  }
}

const mismatches = (text: string | undefined, expected: Case): boolean =>
  text !== undefined && [...charCases(text)].some((found) => found !== expected);

const caseMessage = (expected: Case): string =>
  `This compares a ${expected}-cased string with a literal that is not ${expected}case, so it never matches (Biome noStringCaseMismatch).`;

// oxlint's AST drops parentheses and Biome skips a parenthesized operand, so the tokens around a node
// tell. Comments are not tokens, so a ( inside a comment never counts.
const isPunctuator = (token: Token | null, value: string): boolean => token?.type === "Punctuator" && token.value === value;
const operandsParenthesized = (context: RuleContext, left: Node, right: Node): boolean =>
  context.sourceCode.getTokensBetween(left, right).some((token) => isPunctuator(token, "(") || isPunctuator(token, ")"));
const wrappedTimes = (context: RuleContext, node: Node, times: number): boolean => {
  let token = context.sourceCode.getTokenBefore(node);
  for (let wraps = 0; wraps < times; wraps += 1) {
    if (token === null || !isPunctuator(token, "(")) return false;
    token = context.sourceCode.getTokenBefore(token);
  }
  return true;
};

const noEnum = {
  create: (context: RuleContext) => ({
    TSEnumDeclaration: (node: Node) => {
      // Biome reports only enums that emit code: a const enum, a declare enum and an enum inside a
      // declare block (declare global, declare module) are erased.
      const ambient = context.sourceCode.getAncestors(node).some((ancestor) => ancestor["declare"] === true);
      if (node["const"] === true || node["declare"] === true || ambient) return;
      context.report({
        node,
        message: "Enums are not allowed: use a union of string literals or an `as const` object (Biome noEnum).",
      });
    },
  }),
};

const noImplicitAnyLet = {
  create: (context: RuleContext) => {
    // A for-in or for-of loop variable is assigned by the loop, so Biome does not report it.
    const loopVariables = new WeakSet<Node>();
    const markLoopVariable = (node: Node): void => {
      const left = child(node, "left");
      if (left !== undefined) loopVariables.add(left);
    };
    return {
      ForInStatement: markLoopVariable,
      ForOfStatement: markLoopVariable,
      VariableDeclaration: (node: Node) => {
        // JavaScript has no type annotations, so Biome checks TypeScript files only.
        if (!/\.[cm]?tsx?$/.test(context.filename ?? "")) return;
        if ((node["kind"] !== "let" && node["kind"] !== "var") || loopVariables.has(node)) return;
        for (const declarator of nodes(node["declarations"])) {
          const id = child(declarator, "id");
          if (child(declarator, "init") === undefined && id?.type === "Identifier" && child(id, "typeAnnotation") === undefined)
            context.report({
              node: declarator,
              message: `This ${String(node["kind"])} has no type and no initial value, so it is implicitly any: give it a type (Biome noImplicitAnyLet).`,
            });
        }
      },
    };
  },
};

const noStringCaseMismatch = {
  create: (context: RuleContext) => ({
    // Biome checks equality only (== and ===), with the call on either side.
    BinaryExpression: (node: Node) => {
      if (node["operator"] !== "===" && node["operator"] !== "==") return;
      const left = child(node, "left");
      const right = child(node, "right");
      if (left === undefined || right === undefined || operandsParenthesized(context, left, right)) return;
      for (const [call, other] of [
        [left, right],
        [right, left],
      ] as const) {
        const expected = caseOf(call);
        if (expected !== undefined && mismatches(constantText(other), expected)) context.report({ node, message: caseMessage(expected) });
      }
    },
    SwitchStatement: (node: Node) => {
      const discriminant = child(node, "discriminant");
      // `switch (x)` always has one ( before the discriminant; a second one means it is parenthesized.
      if (discriminant === undefined || wrappedTimes(context, discriminant, 2)) return;
      const expected = caseOf(discriminant);
      if (expected === undefined) return;
      for (const switchCase of nodes(node["cases"])) {
        const test = child(switchCase, "test");
        if (test === undefined || wrappedTimes(context, test, 1)) continue;
        if (mismatches(constantText(test), expected)) context.report({ node: test, message: caseMessage(expected) });
      }
    },
  }),
};

export default {
  meta: { name: "omo" },
  rules: { "no-enum": noEnum, "no-implicit-any-let": noImplicitAnyLet, "no-string-case-mismatch": noStringCaseMismatch },
};
