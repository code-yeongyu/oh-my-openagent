/*
Test-only OpenCode parser oracle; no filesystem or Effect entrypoints.
Source: https://github.com/anomalyco/opencode/blob/32f278b48f1a495611165d8a9f1ace0b512933e2/packages/opencode/src/patch/index.ts#L19-L240
Types and pure parser functions copied unchanged; runtime imports omitted.

MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

export type Hunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; move_path?: string; chunks: UpdateFileChunk[] }

export interface UpdateFileChunk {
  old_lines: string[]
  new_lines: string[]
  change_context?: string
  is_end_of_file?: boolean
}

// Parser implementation
function parsePatchHeader(
  lines: string[],
  startIdx: number,
): { filePath: string; movePath?: string; nextIdx: number } | null {
  const line = lines[startIdx]

  if (line.startsWith("*** Add File:")) {
    const filePath = line.slice("*** Add File:".length).trim()
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null
  }

  if (line.startsWith("*** Delete File:")) {
    const filePath = line.slice("*** Delete File:".length).trim()
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null
  }

  if (line.startsWith("*** Update File:")) {
    const filePath = line.slice("*** Update File:".length).trim()
    let movePath: string | undefined
    let nextIdx = startIdx + 1

    // Check for move directive
    if (nextIdx < lines.length && lines[nextIdx].startsWith("*** Move to:")) {
      movePath = lines[nextIdx].slice("*** Move to:".length).trim()
      nextIdx++
    }

    return filePath ? { filePath, movePath, nextIdx } : null
  }

  return null
}

function parseUpdateFileChunks(lines: string[], startIdx: number): { chunks: UpdateFileChunk[]; nextIdx: number } {
  const chunks: UpdateFileChunk[] = []
  let i = startIdx

  while (i < lines.length && !lines[i].startsWith("***")) {
    if (lines[i].startsWith("@@")) {
      // Parse context line
      const contextLine = lines[i].substring(2).trim()
      i++

      const oldLines: string[] = []
      const newLines: string[] = []
      let isEndOfFile = false

      // Parse change lines
      while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("***")) {
        const changeLine = lines[i]

        if (changeLine === "*** End of File") {
          isEndOfFile = true
          i++
          break
        }

        if (changeLine.startsWith(" ")) {
          // Keep line - appears in both old and new
          const content = changeLine.substring(1)
          oldLines.push(content)
          newLines.push(content)
        } else if (changeLine.startsWith("-")) {
          // Remove line - only in old
          oldLines.push(changeLine.substring(1))
        } else if (changeLine.startsWith("+")) {
          // Add line - only in new
          newLines.push(changeLine.substring(1))
        }

        i++
      }

      chunks.push({
        old_lines: oldLines,
        new_lines: newLines,
        change_context: contextLine || undefined,
        is_end_of_file: isEndOfFile || undefined,
      })
    } else {
      i++
    }
  }

  return { chunks, nextIdx: i }
}

function parseAddFileContent(lines: string[], startIdx: number): { content: string; nextIdx: number } {
  let content = ""
  let i = startIdx

  while (i < lines.length && !lines[i].startsWith("***")) {
    if (lines[i].startsWith("+")) {
      content += lines[i].substring(1) + "\n"
    }
    i++
  }

  // Remove trailing newline
  if (content.endsWith("\n")) {
    content = content.slice(0, -1)
  }

  return { content, nextIdx: i }
}

function stripHeredoc(input: string): string {
  // Match heredoc patterns like: cat <<'EOF'\n...\nEOF or <<EOF\n...\nEOF
  const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/)
  if (heredocMatch) {
    return heredocMatch[2]
  }
  return input
}

export function parsePatch(patchText: string): { hunks: Hunk[] } {
  const cleaned = stripHeredoc(patchText.trim())
  const lines = cleaned.split("\n")
  const hunks: Hunk[] = []
  let i = 0

  // Look for Begin/End patch markers
  const beginMarker = "*** Begin Patch"
  const endMarker = "*** End Patch"

  const beginIdx = lines.findIndex((line) => line.trim() === beginMarker)
  const endIdx = lines.findIndex((line) => line.trim() === endMarker)

  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    throw new Error("Invalid patch format: missing Begin/End markers")
  }

  // Parse content between markers
  i = beginIdx + 1

  while (i < endIdx) {
    const header = parsePatchHeader(lines, i)
    if (!header) {
      i++
      continue
    }

    if (lines[i].startsWith("*** Add File:")) {
      const { content, nextIdx } = parseAddFileContent(lines, header.nextIdx)
      hunks.push({
        type: "add",
        path: header.filePath,
        contents: content,
      })
      i = nextIdx
    } else if (lines[i].startsWith("*** Delete File:")) {
      hunks.push({
        type: "delete",
        path: header.filePath,
      })
      i = header.nextIdx
    } else if (lines[i].startsWith("*** Update File:")) {
      const { chunks, nextIdx } = parseUpdateFileChunks(lines, header.nextIdx)
      hunks.push({
        type: "update",
        path: header.filePath,
        move_path: header.movePath,
        chunks,
      })
      i = nextIdx
    } else {
      i++
    }
  }

  return { hunks }
}
