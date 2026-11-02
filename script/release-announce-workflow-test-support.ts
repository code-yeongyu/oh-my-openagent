// Evaluate the expression subset used by these repository-owned workflows.
export function evaluateExpression(expression: string, context: Readonly<Record<string, unknown>>, statuses: readonly string[] = ["success"], runCancelled = statuses.includes("cancelled")): unknown {
  const code = expression.trim().replace(/^\$\{\{\s*|\s*\}\}$/g, "")
    .replace(/\b(?:inputs|needs|steps|github|secrets)(?:\.[\w-]+)+/g, (path) =>
      `context${path.split(".").map((key) => `[${JSON.stringify(key)}]`).join("")}`)
  const result: unknown = new Function("context", "always", "success", "failure", "cancelled", `return (${code})`)(
    context, () => true, () => statuses.every((status) => status === "success"),
    () => statuses.includes("failure"), () => runCancelled,
  )
  return result
}
