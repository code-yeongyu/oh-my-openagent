/** Isolates one machine-consumed workflow section for release integration tests. */
export function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

/** Returns the shell body GitHub Actions executes for a named multiline step. */
export function runBlock(workflow: string, startMarker: string, endMarker: string): string {
  const section = sliceWorkflowSection(workflow, startMarker, endMarker)
  const run = section.indexOf("        run: |\n")
  if (run < 0) throw new Error(`missing run block in ${startMarker}`)
  return section
    .slice(run + "        run: |\n".length)
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n")
}

export type DesktopEngineLeg = {
  readonly host: string
  readonly runner: string
  readonly rust_target: string
  readonly clang_arch?: string
  readonly binary: string
}

/**
 * The desktop-engine matrix legs GitHub Actions expands, for the hosted path (empty `operator_darwin_artifacts`)
 * or the operator path (#13921). The matrix is one `fromJSON(format('[{0}{1}]', <hosted-only darwin legs>, <legs
 * every path runs>))` expression, evaluated here the way Actions does.
 */
export function desktopEngineLegs(workflow: string, operatorDarwinArtifacts = ""): DesktopEngineLeg[] {
  const job = sliceWorkflowSection(workflow, "  desktop-engine:\n", "\n  keychain-helper:\n")
  const match = job.match(
    /^ {8}include: \$\{\{ fromJSON\(format\('\[\{0\}\{1\}\]', inputs\.operator_darwin_artifacts == '' && '(.*?)' \|\| '', '(.*?)'\)\) \}\}$/m,
  )
  if (!match) throw new Error("desktop-engine matrix is not the expected fromJSON(format(...)) expression")
  const darwin = operatorDarwinArtifacts === "" ? (match[1] ?? "") : ""
  return JSON.parse(`[${darwin}${match[2] ?? ""}]`) as DesktopEngineLeg[]
}
