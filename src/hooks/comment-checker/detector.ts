import type { CommentInfo, CommentType } from "./types"
import { getLanguageByExtension, QUERY_TEMPLATES, DOCSTRING_QUERIES } from "./constants"
import * as fs from "fs"

// =============================================================================
// Debug logging
// =============================================================================

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = "/tmp/comment-checker-debug.log"

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] [comment-checker:detector] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
    fs.appendFileSync(DEBUG_FILE, msg)
  }
}

// =============================================================================
// Parser caching for performance
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parserClass: any = null
let parserInitialized = false
const languageCache = new Map<string, unknown>()

async function getParser() {
  if (!parserClass) {
    debugLog("importing web-tree-sitter (first time)...")
    parserClass = (await import("web-tree-sitter")).default
  }
  
  if (!parserInitialized) {
    debugLog("initializing Parser (first time)...")
    const treeSitterWasmPath = require.resolve("web-tree-sitter/tree-sitter.wasm")
    debugLog("wasm path:", treeSitterWasmPath)
    await parserClass.init({
      locateFile: () => treeSitterWasmPath,
    })
    parserInitialized = true
    debugLog("Parser initialized")
  }
  
  return new parserClass()
}

async function getLanguage(langName: string) {
  if (languageCache.has(langName)) {
    debugLog("using cached language:", langName)
    return languageCache.get(langName)
  }
  
  debugLog("loading language wasm:", langName)
  
  let wasmPath: string
  try {
    const wasmModule = await import(`tree-sitter-wasms/out/tree-sitter-${langName}.wasm`)
    wasmPath = wasmModule.default
  } catch {
    const languageMap: Record<string, string> = {
      golang: "go",
      csharp: "c_sharp",
      cpp: "cpp",
    }
    const mappedLang = languageMap[langName] || langName
    try {
      const wasmModule = await import(`tree-sitter-wasms/out/tree-sitter-${mappedLang}.wasm`)
      wasmPath = wasmModule.default
    } catch (err) {
      debugLog("failed to load language wasm:", langName, err)
      return null
    }
  }
  
  if (!parserClass) {
    await getParser() // ensure parserClass is initialized
  }
  
  const language = await parserClass!.Language.load(wasmPath)
  languageCache.set(langName, language)
  debugLog("language loaded and cached:", langName)
  
  return language
}

// =============================================================================
// Public API
// =============================================================================

export function isSupportedFile(filePath: string): boolean {
  return getLanguageByExtension(filePath) !== null
}

function determineCommentType(text: string, nodeType: string): CommentType {
  const stripped = text.trim()

  if (nodeType === "line_comment") {
    return "line"
  }
  if (nodeType === "block_comment" || nodeType === "multiline_comment") {
    return "block"
  }

  if (stripped.startsWith('"""') || stripped.startsWith("'''")) {
    return "docstring"
  }

  if (stripped.startsWith("//") || stripped.startsWith("#")) {
    return "line"
  }

  if (stripped.startsWith("/*") || stripped.startsWith("<!--") || stripped.startsWith("--")) {
    return "block"
  }

  return "line"
}

export async function detectComments(
  filePath: string,
  content: string,
  includeDocstrings = true
): Promise<CommentInfo[]> {
  debugLog("detectComments called:", { filePath, contentLength: content.length })
  
  const langName = getLanguageByExtension(filePath)
  if (!langName) {
    debugLog("unsupported language for:", filePath)
    return []
  }

  const queryPattern = QUERY_TEMPLATES[langName]
  if (!queryPattern) {
    debugLog("no query pattern for:", langName)
    return []
  }

  try {
    const parser = await getParser()
    const language = await getLanguage(langName)
    
    if (!language) {
      debugLog("language not available:", langName)
      return []
    }

    parser.setLanguage(language)
    const tree = parser.parse(content)
    const comments: CommentInfo[] = []

    const query = (language as { query: (pattern: string) => { matches: (node: unknown) => Array<{ captures: Array<{ node: { text: string; type: string; startPosition: { row: number } } }> }> } }).query(queryPattern)
    const matches = query.matches(tree.rootNode)

    for (const match of matches) {
      for (const capture of match.captures) {
        const node = capture.node
        const text = node.text
        const lineNumber = node.startPosition.row + 1

        const commentType = determineCommentType(text, node.type)
        const isDocstring = commentType === "docstring"

        if (isDocstring && !includeDocstrings) {
          continue
        }

        comments.push({
          text,
          lineNumber,
          filePath,
          commentType,
          isDocstring,
        })
      }
    }

    if (includeDocstrings) {
      const docQuery = DOCSTRING_QUERIES[langName]
      if (docQuery) {
        try {
          const docQueryObj = (language as { query: (pattern: string) => { matches: (node: unknown) => Array<{ captures: Array<{ node: { text: string; startPosition: { row: number } } }> }> } }).query(docQuery)
          const docMatches = docQueryObj.matches(tree.rootNode)

          for (const match of docMatches) {
            for (const capture of match.captures) {
              const node = capture.node
              const text = node.text
              const lineNumber = node.startPosition.row + 1

              const alreadyAdded = comments.some(
                (c) => c.lineNumber === lineNumber && c.text === text
              )
              if (!alreadyAdded) {
                comments.push({
                  text,
                  lineNumber,
                  filePath,
                  commentType: "docstring",
                  isDocstring: true,
                })
              }
            }
          }
        } catch {}
      }
    }

    comments.sort((a, b) => a.lineNumber - b.lineNumber)

    debugLog("detected comments:", comments.length)
    return comments
  } catch (err) {
    debugLog("detectComments failed:", err)
    return []
  }
}
