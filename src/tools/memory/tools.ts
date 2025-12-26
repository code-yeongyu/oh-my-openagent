import { tool } from "@opencode-ai/plugin/tool"
import { resolveMemoryPath, validateFileName, ensureDirectoryExists } from "./utils"
import { DEFAULT_MEMORY_PATH } from "./constants"
import { MemoryToolResult } from "./types"
import { unlink } from "node:fs/promises"

export const memory_write = tool({
  description: "Write content to a memory file. Automatically adds .md extension and supports subdirectories.",
  args: {
    fileName: tool.schema.string().describe("The name of the memory file (e.g., 'decisions/ADR-001')"),
    content: tool.schema.string().describe("The content to write to the file"),
    basePath: tool.schema.string().optional().default(DEFAULT_MEMORY_PATH).describe("Base path for memory files"),
  },
  execute: async (args): Promise<string> => {
    try {
      if (!validateFileName(args.fileName, args.basePath)) {
        const result: MemoryToolResult = { success: false, error: "Invalid file name or path traversal detected" }
        return JSON.stringify(result, null, 2)
      }

      const filePath = resolveMemoryPath(args.fileName, args.basePath)
      await ensureDirectoryExists(filePath)
      
      await Bun.write(filePath, args.content)
      
      const result: MemoryToolResult = { success: true }
      return JSON.stringify(result, null, 2)
    } catch (e) {
      const result: MemoryToolResult = { success: false, error: e instanceof Error ? e.message : String(e) }
      return JSON.stringify(result, null, 2)
    }
  },
})

export const memory_read = tool({
  description: "Read content from a memory file.",
  args: {
    fileName: tool.schema.string().describe("The name of the memory file to read"),
    basePath: tool.schema.string().optional().default(DEFAULT_MEMORY_PATH).describe("Base path for memory files"),
  },
  execute: async (args): Promise<string> => {
    try {
      if (!validateFileName(args.fileName, args.basePath)) {
        const result: MemoryToolResult = { success: false, error: "Invalid file name or path traversal detected" }
        return JSON.stringify(result, null, 2)
      }

      const filePath = resolveMemoryPath(args.fileName, args.basePath)
      const file = Bun.file(filePath)
      
      if (!(await file.exists())) {
        const result: MemoryToolResult = { success: false, error: "File not found" }
        return JSON.stringify(result, null, 2)
      }
      
      const content = await file.text()
      const result: MemoryToolResult = { success: true, content }
      return JSON.stringify(result, null, 2)
    } catch (e) {
      const result: MemoryToolResult = { success: false, error: e instanceof Error ? e.message : String(e) }
      return JSON.stringify(result, null, 2)
    }
  },
})

export const memory_list = tool({
  description: "List all memory files in the memory directory.",
  args: {
    basePath: tool.schema.string().optional().default(DEFAULT_MEMORY_PATH).describe("Base path for memory files"),
  },
  execute: async (args): Promise<string> => {
    try {
      const glob = new Bun.Glob("**/*.md")
      const files: string[] = []
      
      for await (const file of glob.scan({ cwd: args.basePath })) {
        files.push(file)
      }
      
      const result: MemoryToolResult = { success: true, files }
      return JSON.stringify(result, null, 2)
    } catch (e) {
      const result: MemoryToolResult = { success: false, error: e instanceof Error ? e.message : String(e) }
      return JSON.stringify(result, null, 2)
    }
  },
})

export const memory_edit = tool({
  description: "Edit content in a memory file via regex or literal replacement.",
  args: {
    fileName: tool.schema.string().describe("The name of the memory file to edit"),
    needle: tool.schema.string().describe("The string or regex pattern to find"),
    replacement: tool.schema.string().describe("The replacement string"),
    mode: tool.schema.enum(["literal", "regex"]).describe("Replacement mode: 'literal' or 'regex'"),
    basePath: tool.schema.string().optional().default(DEFAULT_MEMORY_PATH).describe("Base path for memory files"),
  },
  execute: async (args): Promise<string> => {
    try {
      if (!validateFileName(args.fileName, args.basePath)) {
        const result: MemoryToolResult = { success: false, error: "Invalid file name or path traversal detected" }
        return JSON.stringify(result, null, 2)
      }

      const filePath = resolveMemoryPath(args.fileName, args.basePath)
      const file = Bun.file(filePath)
      
      if (!(await file.exists())) {
        const result: MemoryToolResult = { success: false, error: "File not found" }
        return JSON.stringify(result, null, 2)
      }
      
      const content = await file.text()
      let newContent: string
      
      if (args.mode === "regex") {
        let regex: RegExp
        try {
          regex = new RegExp(args.needle, "g")
        } catch (e) {
          const result: MemoryToolResult = { 
            success: false, 
            error: `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}` 
          }
          return JSON.stringify(result, null, 2)
        }
        newContent = content.replace(regex, args.replacement)
      } else {
        newContent = content.split(args.needle).join(args.replacement)
      }
      
      if (content === newContent) {
        const result: MemoryToolResult = { success: false, error: "No changes made (needle not found)" }
        return JSON.stringify(result, null, 2)
      }
      
      await Bun.write(filePath, newContent)
      const result: MemoryToolResult = { success: true }
      return JSON.stringify(result, null, 2)
    } catch (e) {
      const result: MemoryToolResult = { success: false, error: e instanceof Error ? e.message : String(e) }
      return JSON.stringify(result, null, 2)
    }
  },
})

export const memory_delete = tool({
  description: "Delete a memory file.",
  args: {
    fileName: tool.schema.string().describe("The name of the memory file to delete"),
    basePath: tool.schema.string().optional().default(DEFAULT_MEMORY_PATH).describe("Base path for memory files"),
  },
  execute: async (args): Promise<string> => {
    try {
      if (!validateFileName(args.fileName, args.basePath)) {
        const result: MemoryToolResult = { success: false, error: "Invalid file name or path traversal detected" }
        return JSON.stringify(result, null, 2)
      }

      const filePath = resolveMemoryPath(args.fileName, args.basePath)
      const file = Bun.file(filePath)
      
      if (!(await file.exists())) {
        const result: MemoryToolResult = { success: false, error: "File not found" }
        return JSON.stringify(result, null, 2)
      }
      
      await unlink(filePath)
      const result: MemoryToolResult = { success: true }
      return JSON.stringify(result, null, 2)
    } catch (e) {
      const result: MemoryToolResult = { success: false, error: e instanceof Error ? e.message : String(e) }
      return JSON.stringify(result, null, 2)
    }
  },
})

export const memoryTools = {
  memory_write,
  memory_read,
  memory_list,
  memory_edit,
  memory_delete,
}
