import { readFileSync, existsSync } from "fs"
import { basename, relative } from "path"
import picomatch from "picomatch"
import { runSg } from "@oh-my-opencode/ast-grep-mcp"
import { getLanguageFromFilePath, DECLARATION_PATTERNS } from "../semantic-memory/memory-manager"
import { getGlobalActivityBus } from "../activity-bus"
import { log } from "../../shared/logger"

export function shrinkClassText(text: string): string {
  const lines = text.split(/\r?\n/)
  if (lines.length <= 3) return text

  const headerLine = lines[0]
  const shrunkLines: string[] = [headerLine]

  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    // Check if it looks like a method or constructor definition
    if (trimmed.includes("(") && (trimmed.endsWith("{") || lines[i+1]?.trim().startsWith("{") || trimmed.includes("=>"))) {
      const braceIdx = line.indexOf("{")
      if (braceIdx !== -1) {
        shrunkLines.push(line.substring(0, braceIdx) + "{ /* ... */ }")
      } else {
        shrunkLines.push(line + " { /* ... */ }")
      }
      
      // Skip the lines of the method body by matching braces
      let methodBraceCount = 1
      let j = i
      if (braceIdx === -1 && lines[i+1]?.trim().startsWith("{")) {
        j++
      }
      while (j < lines.length - 1 && methodBraceCount > 0) {
        j++
        const nextLine = lines[j]
        const nextOpen = (nextLine.match(/\{/g) || []).length
        const nextClose = (nextLine.match(/\}/g) || []).length
        methodBraceCount += nextOpen - nextClose
      }
      i = j // Advance the outer loop index to skip the body
    } else if (trimmed.endsWith(";") || trimmed.includes(":")) {
      // It's likely a top-level property declaration
      shrunkLines.push(line)
    }
  }

  shrunkLines.push(lines[lines.length - 1])
  return shrunkLines.join("\n")
}

export function shrinkNodeText(text: string, lang: string): string {
  const trimmed = text.trim()
  if (["typescript", "tsx", "javascript"].includes(lang)) {
    if (trimmed.startsWith("interface") || trimmed.startsWith("type")) {
      return text // Keep interfaces and types fully as they are structural
    }
    if (trimmed.startsWith("class")) {
      return shrinkClassText(text)
    }
    // For standalone functions:
    const braceIdx = text.indexOf("{")
    if (braceIdx !== -1) {
      return text.substring(0, braceIdx).trim() + " { /* ... */ }"
    }
  } else if (lang === "python") {
    if (trimmed.startsWith("class")) {
      const lines = text.split(/\r?\n/)
      const shrunk: string[] = [lines[0]]
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        const t = line.trim()
        if (t.startsWith("def ")) {
          const colonIdx = line.indexOf(":")
          if (colonIdx !== -1) {
            shrunk.push(line.substring(0, colonIdx + 1) + " ...")
          } else {
            shrunk.push(line + " ...")
          }
        }
      }
      return shrunk.join("\n")
    } else if (trimmed.startsWith("def ")) {
      const colonIdx = text.indexOf(":")
      if (colonIdx !== -1) {
        return text.substring(0, colonIdx + 1) + " ..."
      }
    }
  } else if (lang === "go") {
    if (trimmed.startsWith("type") && (trimmed.includes("struct") || trimmed.includes("interface"))) {
      return text // Structs and interfaces are structural, keep them
    }
    const braceIdx = text.indexOf("{")
    if (braceIdx !== -1) {
      return text.substring(0, braceIdx).trim() + " { /* ... */ }"
    }
  } else if (lang === "rust") {
    if (trimmed.startsWith("struct") || trimmed.startsWith("enum") || trimmed.startsWith("trait")) {
      return text // Keep structs/enums/traits
    }
    if (trimmed.startsWith("impl")) {
      const lines = text.split(/\r?\n/)
      const shrunk: string[] = [lines[0]]
      for (let i = 1; i < lines.length - 1; i++) {
        const line = lines[i]
        const t = line.trim()
        if (t.startsWith("fn ") || t.startsWith("pub fn ")) {
          const braceIdx = line.indexOf("{")
          if (braceIdx !== -1) {
            shrunk.push(line.substring(0, braceIdx).trim() + " { /* ... */ }")
          } else {
            shrunk.push(line + " { /* ... */ }")
          }
        }
      }
      shrunk.push(lines[lines.length - 1])
      return shrunk.join("\n")
    }
    const braceIdx = text.indexOf("{")
    if (braceIdx !== -1) {
      return text.substring(0, braceIdx).trim() + " { /* ... */ }"
    }
  }
  return text
}

export async function extractMagicContextForFiles(
  files: string[],
  options: {
    maxTokens?: number
    excludePaths?: string[]
    workspaceDir: string
  }
): Promise<string> {
  const maxTokens = options.maxTokens ?? 4096
  const maxChars = maxTokens * 4
  const excludePaths = options.excludePaths ?? []
  let accumulatedContext = ""
  let totalChars = 0

  const bus = getGlobalActivityBus()

  // Compile exclusion matchers
  const matchers = excludePaths.map((pattern) => picomatch(pattern, { dot: true, bash: true }))

  for (const file of files) {
    if (totalChars >= maxChars) {
      accumulatedContext += `\n\n[WARNING] Context budget limit of ${maxTokens} tokens reached. Remaining files omitted.\n`
      break
    }

    if (!existsSync(file)) continue

    // Check exclusion paths
    const relativePath = relative(options.workspaceDir, file)
    const isExcluded = matchers.some((matcher) => matcher(relativePath))
    if (isExcluded) {
      log(`[magic-context] Skipping excluded file: ${relativePath}`)
      continue
    }

    const lang = getLanguageFromFilePath(file)
    if (!lang || !DECLARATION_PATTERNS[lang]) {
      // Fallback: if not supported or not matches patterns, we don't extract structural definitions
      continue
    }

    const originalContent = readFileSync(file, "utf-8")
    const originalSize = originalContent.length
    const patterns = DECLARATION_PATTERNS[lang]

    log(`[magic-context] Surgically extracting AST definitions for: ${relativePath} (${lang})`)

    const extractedDefinitions: string[] = []
    const symbolsExtracted: string[] = []

    try {
      // Run ast-grep query patterns sequentially or in parallel
      const results = await Promise.all(
        patterns.map(async (pattern) => {
          try {
            const res = await runSg({
              pattern,
              lang: lang as any,
              paths: [file],
              cwd: options.workspaceDir,
            })
            return res
          } catch {
            return { matches: [], totalMatches: 0, truncated: false }
          }
        })
      )

      for (const res of results) {
        if (!res.matches) continue
        for (const match of res.matches) {
          const shrunk = shrinkNodeText(match.text, lang)
          // Avoid duplicate block strings
          if (!extractedDefinitions.includes(shrunk)) {
            extractedDefinitions.push(shrunk)
            
            // Extract a clean symbol/name if possible
            const firstLine = shrunk.split("\n")[0]
            const nameMatch = firstLine.match(/(?:class|function|interface|type|fn|def|func|struct|impl)\s+([a-zA-Z0-9_$]+)/)
            if (nameMatch && nameMatch[1]) {
              symbolsExtracted.push(nameMatch[1])
            }
          }
        }
      }

      if (extractedDefinitions.length > 0) {
        const fileBlock = `\n### File Signature: [${basename(file)}](file:///${file.replace(/\\/g, "/")})\n\`\`\`${lang}\n${extractedDefinitions.join("\n\n")}\n\`\`\`\n`
        
        if (totalChars + fileBlock.length > maxChars) {
          accumulatedContext += `\n\n[WARNING] Next file exceeds remaining token budget of ${maxTokens} tokens.\n`
          break
        }

        accumulatedContext += fileBlock
        totalChars += fileBlock.length

        // Emit activity bus event
        const extractedSize = fileBlock.length
        const tokensSaved = Math.max(0, Math.floor((originalSize - extractedSize) / 4))

        await bus.emit({
          kind: "context:extracted",
          data: {
            filePath: file,
            symbolsExtracted,
            originalSize,
            extractedSize,
            tokensSaved,
          },
        })
      }
    } catch (err) {
      log(`[magic-context] AST extraction failed for file: ${relativePath}`, err)
    }
  }

  return accumulatedContext
}
