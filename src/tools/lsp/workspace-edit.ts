import { readFileSync, writeFileSync } from "fs"

import { uriToPath } from "./lsp-client-wrapper"
import type { TextEdit, WorkspaceEdit } from "./types"

export interface ApplyResult {
  success: boolean
  filesModified: string[]
  totalEdits: number
  errors: string[]
}

function applyTextEditsToFile(filePath: string, edits: TextEdit[]): { success: boolean; editCount: number; error?: string } {
  try {
    let content = readFileSync(filePath, "utf-8")
    const lines = content.split("\n")

    const sortedEdits = [...edits].sort((a, b) => {
      if (b.range.start.line !== a.range.start.line) {
        return b.range.start.line - a.range.start.line
      }
      return b.range.start.character - a.range.start.character
    })

    for (const edit of sortedEdits) {
      const startLine = edit.range.start.line
      const startChar = edit.range.start.character
      const endLine = edit.range.end.line
      const endChar = edit.range.end.character

      if (startLine === endLine) {
        const line = lines[startLine] || ""
        lines[startLine] = line.substring(0, startChar) + edit.newText + line.substring(endChar)
      } else {
        const firstLine = lines[startLine] || ""
        const lastLine = lines[endLine] || ""
        const newContent = firstLine.substring(0, startChar) + edit.newText + lastLine.substring(endChar)
        lines.splice(startLine, endLine - startLine + 1, ...newContent.split("\n"))
      }
    }

    writeFileSync(filePath, lines.join("\n"), "utf-8")
    return { success: true, editCount: edits.length }
  } catch (err) {
    return { success: false, editCount: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

export function applyWorkspaceEdit(edit: WorkspaceEdit | null): ApplyResult {
  if (!edit) {
    return { success: false, filesModified: [], totalEdits: 0, errors: ["No edit provided"] }
  }

  const result: ApplyResult = { success: true, filesModified: [], totalEdits: 0, errors: [] }

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const filePath = uriToPath(uri)
      const applyResult = applyTextEditsToFile(filePath, edits)

      if (applyResult.success) {
        result.filesModified.push(filePath)
        result.totalEdits += applyResult.editCount
      } else {
        result.success = false
        result.errors.push(`${filePath}: ${applyResult.error}`)
      }
    }
  }

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ("kind" in change) {
        if (change.kind === "create") {
          try {
            const filePath = uriToPath(change.uri)
            writeFileSync(filePath, "", "utf-8")
            result.filesModified.push(filePath)
          } catch (err) {
            result.success = false
            result.errors.push(`Create ${change.uri}: ${err}`)
          }
        } else if (change.kind === "rename") {
          try {
            const oldPath = uriToPath(change.oldUri)
            const newPath = uriToPath(change.newUri)
            const content = readFileSync(oldPath, "utf-8")
            writeFileSync(newPath, content, "utf-8")
            require("fs").unlinkSync(oldPath)
            result.filesModified.push(newPath)
          } catch (err) {
            result.success = false
            result.errors.push(`Rename ${change.oldUri}: ${err}`)
          }
        } else if (change.kind === "delete") {
          try {
            const filePath = uriToPath(change.uri)
            require("fs").unlinkSync(filePath)
            result.filesModified.push(filePath)
          } catch (err) {
            result.success = false
            result.errors.push(`Delete ${change.uri}: ${err}`)
          }
        }
      } else {
        const filePath = uriToPath(change.textDocument.uri)
        const applyResult = applyTextEditsToFile(filePath, change.edits)

        if (applyResult.success) {
          result.filesModified.push(filePath)
          result.totalEdits += applyResult.editCount
        } else {
          result.success = false
          result.errors.push(`${filePath}: ${applyResult.error}`)
        }
      }
    }
  }

  return result
}
