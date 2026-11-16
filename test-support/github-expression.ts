// Evaluates the GitHub Actions expression subset our workflows use, so workflow-structure tests can check what
// GitHub would compute for a given event. String literals are left untouched; everything else becomes JavaScript.
// One known difference: == and != compare strings case-sensitively here, while GitHub ignores case, so tests must
// not rely on case-folding.
function toJavaScript(expression: string): string {
  return expression
    .split(/('(?:[^']|'')*')/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/([!=])=/g, "$1==")
            .replace(/\.labels\.\*\.name/g, ".labels?.map((label) => label.name)")
            .replace(/needs\.([\w-]+)\./g, 'needs["$1"].')
            .replace(/(?<=[\w\]])\.(?=[A-Za-z_])/g, "?."),
    )
    .join("")
}

export interface ExpressionContext {
  readonly github: unknown
  readonly needs?: unknown
  readonly matrix?: unknown
  readonly steps?: unknown
}

const functions = {
  always: () => true,
  cancelled: () => false,
  contains: (haystack: unknown, needle: unknown) =>
    Array.isArray(haystack) || typeof haystack === "string" ? haystack.includes(String(needle)) : false,
  startsWith: (value: unknown, prefix: unknown) => String(value ?? "").startsWith(String(prefix)),
  fromJSON: (value: unknown) => JSON.parse(String(value)),
  format: (template: unknown, ...values: unknown[]) =>
    String(template).replace(/\{(\d+)\}/g, (_match, index: string) => String(values[Number(index)] ?? "")),
}

export function evaluate(expression: unknown, context: ExpressionContext): unknown {
  const text = String(expression).trim()
  const body = /^\$\{\{\s*([\s\S]+?)\s*\}\}$/.exec(text)?.[1] ?? text
  const names = ["github", "needs", "matrix", "steps", "inputs", ...Object.keys(functions)]
  const run = new Function(...names, `return (${toJavaScript(body)})`)
  return run(
    context.github,
    context.needs ?? {},
    context.matrix ?? {},
    context.steps ?? {},
    {},
    ...Object.values(functions),
  )
}

/** Renders a string that embeds `${{ ... }}` expressions, as GitHub does for concurrency group names. */
export function interpolate(template: unknown, context: ExpressionContext): string {
  return String(template).replace(/\$\{\{\s*([\s\S]+?)\s*\}\}/g, (_match, body: string) =>
    String(evaluate(body, context) ?? ""),
  )
}
