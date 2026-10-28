import type { ConfigModelsReport, ModelDeclaration, ModelMapEntry } from "./types"

function settingSuffix(entry: { readonly reasoning?: string; readonly variant?: string; readonly reasoningEffort?: string }): string {
  const settings = Object.entries(entry).filter(([key]) => ["reasoning", "variant", "reasoningEffort"].includes(key))
  return settings.length === 0 ? "" : ` (${settings.map(([key, value]) => `${key}=${value}`).join(", ")})`
}

function modelText(entry: ModelMapEntry): string {
  return typeof entry === "string" ? entry : `${entry.model}${settingSuffix(entry)}`
}

function declarationLines(declaration: ModelDeclaration): readonly string[] {
  const lines = [`  ${declaration.key}`]
  if (declaration.category !== undefined) lines.push(`    category -> ${declaration.category}`)
  if (declaration.model !== undefined) lines.push(`    model -> ${declaration.model}`)
  if (declaration.models !== undefined) {
    if (declaration.models.length === 0) lines.push("    models = []")
    declaration.models.forEach((entry, index) => lines.push(`    models[${index}] -> ${modelText(entry)}`))
  }
  if (typeof declaration.fallback_models === "string") {
    lines.push(`    fallback_models -> ${declaration.fallback_models}`)
  } else if (declaration.fallback_models !== undefined) {
    const entries = declaration.fallback_models
    if (entries.length === 0) lines.push("    fallback_models = []")
    entries.forEach((entry, index) => lines.push(`    fallback_models[${index}] -> ${modelText(entry)}`))
  }
  for (const field of ["reasoning", "variant", "reasoningEffort", "disable"] as const) {
    if (declaration[field] !== undefined) lines.push(`    ${field} = ${declaration[field]}`)
  }
  return lines
}

export function formatConfigModels(report: ConfigModelsReport): string {
  const lines = [
    "OpenCode model configuration map",
    "Direct agent/category declarations in config precedence order (later views override earlier fields).",
    "Catalog names remain declarations; runtime selection and availability are not evaluated.",
    `Directory: ${report.directory}`,
    `Active profile: ${report.profile ?? "(none)"}`,
    `Configuration: ${report.valid ? "valid" : "invalid"}`,
    "",
    "Sources (loading status; merged diagnostics follow):",
    ...report.sources.map((source) => `  [${source.scope}/${source.status}] ${source.path}`),
    "",
    "Declarations:",
  ]
  for (const [index, view] of report.views.entries()) {
    lines.push(`[${index + 1}] ${view.scope}: ${view.path} | section: ${view.keyPrefix || "<root>"}`)
    lines.push(...(view.declarations.length > 0 ? view.declarations.flatMap(declarationLines) : ["  (no model declarations in this section)"]))
  }
  if (report.views.every((view) => view.declarations.length === 0)) {
    lines.push("No agent or category model declarations found. Configure agents/categories in .omo/omo.jsonc or its [opencode] block.")
  }
  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:")
    for (const diagnostic of report.diagnostics) {
      const keys = diagnostic.issuePaths.length === 0 ? "" : ` | keys: ${diagnostic.issuePaths.join(", ")}`
      lines.push(`  ${diagnostic.severity}: ${diagnostic.kind}: ${diagnostic.path ?? "merged configuration"}${keys}: ${diagnostic.message}`)
    }
  }
  return lines.map((line) => line.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (character) => {
    const quoted = JSON.stringify(character).slice(1, -1)
    return quoted === character ? `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}` : quoted
  })).join("\n")
}
