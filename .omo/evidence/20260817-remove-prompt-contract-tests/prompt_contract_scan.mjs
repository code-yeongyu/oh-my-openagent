import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { createDerivedScanner } from "./prompt_contract_derived.mjs"
import { createNodeAssertContext, createNodeAssertShape } from "./prompt_contract_node_assert.mjs"
import { createAstHelpers } from "./prompt_contract_values.mjs"

const MATCHERS = new Set([
  "toContain", "toMatch", "toBe", "toEqual", "toStrictEqual", "toStartWith", "toEndWith",
  "toBeGreaterThan", "toBeGreaterThanOrEqual", "toMatchInlineSnapshot", "toMatchSnapshot",
])
const INSTRUCTION_NAME = /prompt|directive|instructions?|skill(?:content|text)?|markdown|template|systemmessage|agenttext|body/i
const PROSE = /(?:^|\n)\s*#{1,6}\s|\*\*[^*]+\*\*|\b(?:must|should|never|always|do not|use the|operating in|workflow|instructions?|prompt|directive|skill|AGENTS\.md|markdown|browser automation|commit the|task category|lead-only|member-safe)\b/i

export class TypeScriptParseError extends Error {}

export function createFileScanner(ts, root) {
  const helpers = createAstHelpers(ts)
  const {
    bindingFor, collectBindings, normalized, propertyName, resolveNode,
    scriptKind, sourceText, unwrap, valuesFrom,
  } = helpers

  function containsInstructionSource(source, node, bindings, loopBindings) {
    const resolved = resolveNode(node, bindings, loopBindings)
    const text = sourceText(source, resolved)
    if (INSTRUCTION_NAME.test(text)) return true
    if (ts.isCallExpression(resolved)) {
      const callText = sourceText(source, resolved)
      if (/readFile|Bun\.file/.test(callText) && /SKILL\.md|AGENTS\.md|prompt|directive|rules?\.md/i.test(callText)) {
        return true
      }
    }
    return false
  }

  function isCandidateValue(value, context) {
    const text = normalized(value.replace(/^\/(.*)\/[a-z]*$/i, "$1"))
    return Boolean(text && text.length >= 3 && (context || PROSE.test(text) || /^#{1,6}\s/.test(text)))
  }

  function fingerprint(item) {
    const material = [item.path, item.kind, item.matcher, normalized(item.actual), normalized(item.expected)].join("\0")
    return crypto.createHash("sha256").update(material).digest("hex")
  }

  return function scanFile(relative) {
    const absolute = path.join(root, relative)
    const text = fs.readFileSync(absolute, "utf8")
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, scriptKind(relative))
    const parseDiagnostics = source.parseDiagnostics ?? []
    if (parseDiagnostics.length) {
      const diagnostic = parseDiagnostics[0]
      const at = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
      throw new TypeScriptParseError(
        `${relative}:${at.line + 1}:${at.character + 1}: TypeScript parse error ${diagnostic.messageText}`,
      )
    }
    const bindings = collectBindings(source)
    const candidates = []
    const loopBindings = new Map()
    const nodeAssertShape = createNodeAssertShape(ts, source, helpers)
    const containsNodeAssertContext = createNodeAssertContext(ts, source, helpers, bindings, loopBindings)

    function add(node, kind, matcher, actualNode, expectedValue, context, expectedNode = node) {
      if (!isCandidateValue(expectedValue, context)) return
      const at = source.getLineAndCharacterOfPosition(expectedNode.getStart(source))
      const item = {
        path: relative,
        line: at.line + 1,
        column: at.character + 1,
        kind,
        matcher,
        actual: sourceText(source, actualNode),
        expected: normalized(expectedValue).slice(0, 500),
      }
      item.fingerprint = fingerprint(item)
      candidates.push(item)
    }

    const scanDerived = createDerivedScanner(
      ts,
      helpers,
      source,
      bindings,
      loopBindings,
      add,
      (node) => containsInstructionSource(source, node, bindings, loopBindings),
    )

    function findIncludes(node, assertionNode, matcher, inheritedContext, contextFor, seenBindings = new Set()) {
      node = unwrap(node)
      if (!node) return
      if (ts.isIdentifier(node)) {
        const binding = bindingFor(node, bindings)
        if (!binding || seenBindings.has(node.text)) return
        const nextSeen = new Set(seenBindings)
        nextSeen.add(node.text)
        findIncludes(binding, assertionNode, matcher, inheritedContext, contextFor, nextSeen)
        return
      }
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "includes"
      ) {
        const haystack = node.expression.expression
        const context = inheritedContext || contextFor(haystack)
        for (const found of valuesFrom(node.arguments[0], bindings, loopBindings)) {
          add(assertionNode, "includes-boolean", `includes:${matcher}`, haystack, found.value, context, found.node)
        }
      }
      ts.forEachChild(node, (child) => findIncludes(child, assertionNode, matcher, inheritedContext, contextFor, seenBindings))
    }

    function findOrderHelpers(node, assertionNode, matcher, seenBindings = new Set()) {
      node = unwrap(node)
      if (!node) return
      if (ts.isIdentifier(node)) {
        const binding = bindingFor(node, bindings)
        if (!binding || seenBindings.has(node.text)) return
        const nextSeen = new Set(seenBindings)
        nextSeen.add(node.text)
        findOrderHelpers(binding, assertionNode, matcher, nextSeen)
        return
      }
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text : propertyName(node.expression.name)
        if (/orderedIndexes|orderedIndices|assertInOrder|expectInOrder/i.test(name) && node.arguments.length >= 2) {
          const context = containsInstructionSource(source, node.arguments[0], bindings, loopBindings)
          for (const found of valuesFrom(node.arguments[1], bindings, loopBindings)) {
            add(assertionNode, "order-helper", name, node.arguments[0], found.value, context, found.node)
          }
        }
      }
      ts.forEachChild(node, (child) => findOrderHelpers(child, assertionNode, matcher, seenBindings))
    }

    function expectShape(call) {
      if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return null
      const matcher = call.expression.name.text
      if (!MATCHERS.has(matcher)) return null
      let chain = call.expression.expression
      let negated = false
      if (ts.isPropertyAccessExpression(chain) && chain.name.text === "not") {
        negated = true
        chain = chain.expression
      }
      if (!ts.isCallExpression(chain) || !ts.isIdentifier(chain.expression) || chain.expression.text !== "expect") return null
      return { matcher: `${negated ? "not." : ""}${matcher}`, actual: chain.arguments[0], expected: call.arguments[0] }
    }

    function visit(node) {
      if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
        const declaration = node.initializer.declarations[0]
        if (declaration && ts.isIdentifier(declaration.name)) {
          loopBindings.set(declaration.name.text, node.expression)
          visit(node.statement)
          loopBindings.delete(declaration.name.text)
          return
        }
      }
      if (ts.isCallExpression(node)) {
        const shape = expectShape(node) ?? nodeAssertShape(node)
        if (shape) {
          const shallowContext = containsInstructionSource(source, shape.actual, bindings, loopBindings)
          const nodeContext = shape.nodeAssert && (
            containsNodeAssertContext(shape.actual) || containsNodeAssertContext(shape.expected)
          )
          const context = shape.nodeAssert ? nodeContext : shallowContext
          if (shape.nodeAssert && !context) {
            ts.forEachChild(node, visit)
            return
          }
          if (shape.matcher.endsWith("toMatchInlineSnapshot") || shape.matcher.endsWith("toMatchSnapshot")) {
            add(node, "snapshot", shape.matcher, shape.actual, "<snapshot pins instruction output>", true, node)
          } else if (shape.expected) {
            const expectedValues = valuesFrom(shape.expected, bindings, loopBindings)
            for (const found of expectedValues) {
              add(node, "matcher", shape.matcher, shape.actual, found.value, context, found.node)
            }
            if (
              expectedValues.length === 0
              && /(?:^|\.)(?:toBe|toEqual|toStrictEqual|equal|strictEqual|deepEqual|deepStrictEqual|notEqual|notStrictEqual|deepNotEqual|deepNotStrictEqual)$/.test(shape.matcher)
              && context
              && (shape.nodeAssert || containsInstructionSource(source, shape.expected, bindings, loopBindings))
            ) {
              add(node, "shipped-copy-equality", shape.matcher, shape.actual,
                `<expression:${sourceText(source, shape.expected)}>`, true, shape.expected)
            }
          }
          if (shape.nodeAssert && shape.method === "ok" && context) {
            add(node, "truthy-assertion", shape.matcher, shape.actual, "<truthy instruction assertion>", true, node)
          }
          const contextFor = shape.nodeAssert
            ? containsNodeAssertContext
            : (candidate) => containsInstructionSource(source, candidate, bindings, loopBindings)
          findIncludes(shape.actual, node, shape.matcher, context, contextFor)
          findOrderHelpers(shape.actual, node, shape.matcher)
          scanDerived(node, shape)
        }
      }
      if (
        ts.isPropertyAssignment(node)
        && propertyName(node.name) === "prompt"
        && /category-resolver(?:-[^/]*)?\.(?:test|spec|fixture)\./i.test(relative)
      ) {
        for (const found of valuesFrom(node.initializer, bindings, loopBindings)) {
          add(node, "direct-category-prompt", "prompt-property", node.parent, found.value, true, found.node)
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(source)
    const unique = new Map()
    for (const item of candidates) unique.set(`${item.fingerprint}:${item.line}:${item.column}`, item)
    return [...unique.values()].sort(
      (left, right) => left.line - right.line || left.column - right.column || left.fingerprint.localeCompare(right.fingerprint),
    )
  }
}
