import pc from "picocolors"
import { displayChars } from "./display-chars"
import { writePaddedText } from "./output-renderer"
import { formatToolHeader } from "./tool-input-preview"

export function writeToolHeader(toolName: string, input: Record<string, unknown>): void {
  const header = formatToolHeader(toolName, input)
  const suffix = header.description ? ` ${pc.dim(header.description)}` : ""
  process.stdout.write(`\n  ${pc.cyan(header.icon)} ${pc.bold(header.title)}${suffix}  \n`)
}

export function writeToolOutput(output: string): void {
  if (!output.trim()) return
  process.stdout.write(pc.dim(`  ${displayChars.treeEnd} output  \n`))
  const padded = writePaddedText(output, true)
  process.stdout.write(pc.dim(padded.output + (padded.atLineStart ? "" : "  ")))
  process.stdout.write("\n")
}
