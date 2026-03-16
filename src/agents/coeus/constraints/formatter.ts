interface TypeEntry {
  name: string
  file: string
}

export interface ExtractedTypes {
  zodSchemas: TypeEntry[]
  zodInferred: TypeEntry[]
  interfaces: TypeEntry[]
  typeAliases: TypeEntry[]
}

export interface PackageDeps {
  name: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

export function formatTypes(types: ExtractedTypes): string {
  const lines: string[] = ["## Existing Types", ""]

  if (types.zodSchemas.length === 0 && types.zodInferred.length === 0 && types.interfaces.length === 0 && types.typeAliases.length === 0) {
    lines.push("No types found.", "")
    return lines.join("\n")
  }

  if (types.zodSchemas.length > 0) {
    lines.push("### Zod Schemas", "")
    for (const s of types.zodSchemas) {
      lines.push(`- \`${s.name}\` (${s.file})`)
    }
    lines.push("")
  }

  if (types.zodInferred.length > 0) {
    lines.push("### Zod Inferred Types", "")
    for (const t of types.zodInferred) {
      lines.push(`- \`${t.name}\` (${t.file})`)
    }
    lines.push("")
  }

  if (types.interfaces.length > 0) {
    lines.push("### Interfaces", "")
    for (const i of types.interfaces) {
      lines.push(`- \`${i.name}\` (${i.file})`)
    }
    lines.push("")
  }

  if (types.typeAliases.length > 0) {
    lines.push("### Type Aliases", "")
    for (const t of types.typeAliases) {
      lines.push(`- \`${t.name}\` (${t.file})`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

export function formatConventions(agentsContent: string): string {
  return `## Project Conventions\n\n${agentsContent}\n`
}

export function formatDependencies(pkg: PackageDeps): string {
  const lines: string[] = ["## Dependencies", ""]

  const depKeys = Object.keys(pkg.dependencies)
  const devKeys = Object.keys(pkg.devDependencies)

  if (depKeys.length === 0 && devKeys.length === 0) {
    lines.push("No dependencies found.", "")
    return lines.join("\n")
  }

  if (depKeys.length > 0) {
    lines.push("### Runtime", "")
    for (const dep of depKeys) {
      lines.push(`- ${dep} (${pkg.dependencies[dep]})`)
    }
    lines.push("")
  }

  if (devKeys.length > 0) {
    lines.push("### Development", "")
    for (const dep of devKeys) {
      lines.push(`- ${dep} (${pkg.devDependencies[dep]})`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
