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
// Parser Manager (LSP-style background initialization)
// =============================================================================

interface ManagedLanguage {
  language: unknown
  initPromise?: Promise<unknown>
  isInitializing: boolean
  lastUsedAt: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parserClass: any = null
let parserInitPromise: Promise<void> | null = null
const languageCache = new Map<string, ManagedLanguage>()

const LANGUAGE_NAME_MAP: Record<string, string> = {
  golang: "go",
  csharp: "c_sharp",
  cpp: "cpp",
}

const COMMON_LANGUAGES = [
  "python",
  "typescript",
  "javascript",
  "tsx",
  "go",
  "rust",
  "java",
]

async function initParserClass(): Promise<void> {
  if (parserClass) return
  
  if (parserInitPromise) {
    await parserInitPromise
    return
  }
  
  parserInitPromise = (async () => {
    debugLog("importing web-tree-sitter...")
    parserClass = (await import("web-tree-sitter")).default
    const treeSitterWasmPath = require.resolve("web-tree-sitter/tree-sitter.wasm")
    debugLog("wasm path:", treeSitterWasmPath)
    await parserClass.init({
      locateFile: () => treeSitterWasmPath,
    })
    debugLog("Parser class initialized")
  })()
  
  await parserInitPromise
}

async function getParser() {
  await initParserClass()
  return new parserClass()
}

async function loadLanguageWasm(langName: string): Promise<unknown | null> {
  const mappedLang = LANGUAGE_NAME_MAP[langName] || langName
  
  try {
    const wasmModule = await import(`tree-sitter-wasms/out/tree-sitter-${langName}.wasm`)
    return wasmModule.default
  } catch {
    if (mappedLang !== langName) {
      try {
        const wasmModule = await import(`tree-sitter-wasms/out/tree-sitter-${mappedLang}.wasm`)
        return wasmModule.default
      } catch {
        return null
      }
    }
    return null
  }
}

async function getLanguage(langName: string): Promise<unknown | null> {
  const cached = languageCache.get(langName)
  
  if (cached) {
    if (cached.initPromise) {
      await cached.initPromise
    }
    cached.lastUsedAt = Date.now()
    debugLog("using cached language:", langName)
    return cached.language
  }
  
  debugLog("loading language wasm:", langName)
  
  const initPromise = (async () => {
    await initParserClass()
    const wasmPath = await loadLanguageWasm(langName)
    if (!wasmPath) {
      debugLog("failed to load language wasm:", langName)
      return null
    }
    return await parserClass!.Language.load(wasmPath)
  })()
  
  languageCache.set(langName, {
    language: null as unknown,
    initPromise,
    isInitializing: true,
    lastUsedAt: Date.now(),
  })
  
  const language = await initPromise
  const managed = languageCache.get(langName)
  if (managed) {
    managed.language = language
    managed.initPromise = undefined
    managed.isInitializing = false
  }
  
  debugLog("language loaded and cached:", langName)
  return language
}

function warmupLanguage(langName: string): void {
  if (languageCache.has(langName)) return
  
  debugLog("warming up language (background):", langName)
  
  const initPromise = (async () => {
    await initParserClass()
    const wasmPath = await loadLanguageWasm(langName)
    if (!wasmPath) return null
    return await parserClass!.Language.load(wasmPath)
  })()
  
  languageCache.set(langName, {
    language: null as unknown,
    initPromise,
    isInitializing: true,
    lastUsedAt: Date.now(),
  })
  
  initPromise.then((language) => {
    const managed = languageCache.get(langName)
    if (managed) {
      managed.language = language
      managed.initPromise = undefined
      managed.isInitializing = false
      debugLog("warmup complete:", langName)
    }
  }).catch((err) => {
    debugLog("warmup failed:", langName, err)
    languageCache.delete(langName)
  })
}

export function warmupCommonLanguages(): void {
  debugLog("starting background warmup for common languages...")
  initParserClass().then(() => {
    for (const lang of COMMON_LANGUAGES) {
      warmupLanguage(lang)
    }
  }).catch((err) => {
    debugLog("warmup initialization failed:", err)
  })
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
