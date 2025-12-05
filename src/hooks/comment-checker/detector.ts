import type { CommentInfo, CommentType } from "./types"
import { getLanguageByExtension, QUERY_TEMPLATES, DOCSTRING_QUERIES } from "./constants"

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
  const langName = getLanguageByExtension(filePath)
  if (!langName) {
    return []
  }

  const queryPattern = QUERY_TEMPLATES[langName]
  if (!queryPattern) {
    return []
  }

  try {
    const Parser = (await import("web-tree-sitter")).default
    
    const treeSitterWasmPath = require.resolve("web-tree-sitter/tree-sitter.wasm")
    await Parser.init({
      locateFile: () => treeSitterWasmPath,
    })

    const parser = new Parser()

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
      } catch {
        return []
      }
    }

    const language = await Parser.Language.load(wasmPath)
    parser.setLanguage(language)

    const tree = parser.parse(content)
    const comments: CommentInfo[] = []

    const query = language.query(queryPattern)
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
          const docQueryObj = language.query(docQuery)
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

    return comments
  } catch {
    return []
  }
}
