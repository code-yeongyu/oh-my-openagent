import type { ProbeExchange } from "../types"

export type OpenApiExportInput = {
  rows: ReadonlyArray<ProbeExchange>
  anonymizeCredentials: boolean
}

type Operation = {
  operationId: string
  summary: string
  responses: Record<string, { description: string }>
}

type PathItem = { [method: string]: Operation }

export function exportToOpenApiYaml(input: OpenApiExportInput): string {
  const grouped = groupExchanges(input.rows)
  const lines: string[] = ["openapi: 3.0.0", "info:", "  title: probe-lab capture", "  version: 0.5.0", "paths:"]
  for (const [host, paths] of grouped) {
    lines.push(`  # host: ${host}`)
    for (const [path, item] of paths) {
      lines.push(`  ${escapeYamlKey(path)}:`)
      for (const [method, op] of Object.entries(item)) {
        lines.push(`    ${method}:`)
        lines.push(`      operationId: ${op.operationId}`)
        lines.push(`      summary: ${escapeYamlValue(op.summary)}`)
        lines.push(`      responses:`)
        for (const [code, response] of Object.entries(op.responses)) {
          lines.push(`        '${code}':`)
          lines.push(`          description: ${escapeYamlValue(response.description)}`)
        }
      }
    }
  }
  return `${lines.join("\n")}\n`
}

function groupExchanges(rows: ReadonlyArray<ProbeExchange>): Map<string, Map<string, PathItem>> {
  const out = new Map<string, Map<string, PathItem>>()
  for (const row of rows) {
    const parsed = parseUrl(row.url)
    if (!parsed) continue
    const hostMap = ensure(out, parsed.host, () => new Map<string, PathItem>())
    const pathItem = ensure(hostMap, parsed.path, (): PathItem => ({}))
    const method = row.method.toLowerCase()
    let operation = pathItem[method]
    if (!operation) {
      operation = {
        operationId: deriveOperationId(method, parsed.path),
        summary: `${row.method} ${parsed.path}`,
        responses: {},
      }
      pathItem[method] = operation
    }
    const status = row.response_status ?? 0
    operation.responses[String(status)] = { description: `Response ${status}` }
  }
  return out
}

function parseUrl(url: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(url)
    return { host: parsed.host, path: parsed.pathname || "/" }
  } catch {
    return null
  }
}

function deriveOperationId(method: string, path: string): string {
  return `${method}_${path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "root"}`
}

function ensure<K, V>(map: Map<K, V>, key: K, fallback: () => V): V {
  if (!map.has(key)) map.set(key, fallback())
  return map.get(key)!
}

function escapeYamlKey(value: string): string {
  return /[:#&*!|>'"%@`]/.test(value) ? `"${value.replace(/"/g, "\\\"")}"` : value
}

function escapeYamlValue(value: string): string {
  return value.includes(":") || value.includes("#") ? `"${value.replace(/"/g, "\\\"")}"` : value
}
