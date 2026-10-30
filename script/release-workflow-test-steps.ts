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
  return section.slice(run + "        run: |\n".length)
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n")
}
