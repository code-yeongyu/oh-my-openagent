import { readFileSync } from "fs"
import { extname, resolve } from "path"
import { pathToFileURL } from "node:url"

import { getLanguageId } from "./config"
import { LSPClientConnection } from "./lsp-client-connection"
import type { Diagnostic } from "./types"

export class LSPClient extends LSPClientConnection {
  private openedFiles = new Set<string>()
  private documentVersions = new Map<string, number>()
  private lastSyncedText = new Map<string, string>()

  async openFile(filePath: string): Promise<void> {
    const absPath = resolve(filePath)

    const uri = pathToFileURL(absPath).href
    const text = readFileSync(absPath, "utf-8")

    if (!this.openedFiles.has(absPath)) {
      const ext = extname(absPath)
      const languageId = getLanguageId(ext)
      const version = 1

      this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version,
          text,
        },
      })

      this.openedFiles.add(absPath)
      this.documentVersions.set(uri, version)
      this.lastSyncedText.set(uri, text)
      await new Promise((r) => setTimeout(r, 1000))
      return
    }

    const prevText = this.lastSyncedText.get(uri)
    if (prevText === text) {
      return
    }

    const nextVersion = (this.documentVersions.get(uri) ?? 1) + 1
    this.documentVersions.set(uri, nextVersion)
    this.lastSyncedText.set(uri, text)

    this.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: nextVersion },
      contentChanges: [{ text }],
    })

    // Some servers update diagnostics only after save
    this.sendNotification("textDocument/didSave", {
      textDocument: { uri },
      text,
    })
  }

  async definition(filePath: string, line: number, character: number): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.sendRequest("textDocument/definition", {
      textDocument: { uri: pathToFileURL(absPath).href },
      position: { line: line - 1, character },
    })
  }

  async references(filePath: string, line: number, character: number, includeDeclaration = true): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.sendRequest("textDocument/references", {
      textDocument: { uri: pathToFileURL(absPath).href },
      position: { line: line - 1, character },
      context: { includeDeclaration },
    })
  }

  async documentSymbols(filePath: string): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.sendRequest("textDocument/documentSymbol", {
      textDocument: { uri: pathToFileURL(absPath).href },
    })
  }

  async workspaceSymbols(query: string): Promise<unknown> {
    return this.sendRequest("workspace/symbol", { query })
  }

  async diagnostics(filePath: string): Promise<{ items: Diagnostic[] }> {
    const absPath = resolve(filePath)
    const uri = pathToFileURL(absPath).href
    await this.openFile(absPath)
    await new Promise((r) => setTimeout(r, 500))

    try {
      const result = await this.sendRequest<{ items?: Diagnostic[] }>("textDocument/diagnostic", {
        textDocument: { uri },
      })
      if (result && typeof result === "object" && "items" in result) {
        return result as { items: Diagnostic[] }
      }
    } catch {}

    return { items: this.diagnosticsStore.get(uri) ?? [] }
  }

  async prepareRename(filePath: string, line: number, character: number): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.sendRequest("textDocument/prepareRename", {
      textDocument: { uri: pathToFileURL(absPath).href },
      position: { line: line - 1, character },
    })
  }

  async rename(filePath: string, line: number, character: number, newName: string): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.sendRequest("textDocument/rename", {
      textDocument: { uri: pathToFileURL(absPath).href },
      position: { line: line - 1, character },
      newName,
    })
  }
}
