/**
 * AST Test Matcher - 基于 AST 的测试覆盖匹配
 *
 * 使用 AST 解析测试文件，检测测试是否 import 目标模块并调用目标函数。
 */

export interface AstMatchResult {
  hasImport: boolean
  hasFunctionCall: boolean
  importedModules: string[]
  calledFunctions: string[]
}

export interface AstTestMatcherConfig {
  supportedExtensions: string[]
}

const DEFAULT_CONFIG: AstTestMatcherConfig = {
  supportedExtensions: [".ts", ".tsx", ".js", ".jsx"],
}

/**
 * Parses a test file and extracts import and function call information.
 * Uses regex-based parsing for simplicity (full AST would require external deps).
 */
export function parseTestFile(
  content: string,
  _config: AstTestMatcherConfig = DEFAULT_CONFIG
): AstMatchResult {
  const importedModules: string[] = []
  const calledFunctions: string[] = []

  // Match ES6 imports: import { foo } from './module'
  const importRegex = /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = importRegex.exec(content)) !== null) {
    importedModules.push(match[1])
  }

  // Match require statements: require('./module')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = requireRegex.exec(content)) !== null) {
    importedModules.push(match[1])
  }

  // Match function calls: functionName(
  const functionCallRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g
  const excludedKeywords = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "function",
    "import",
    "require",
    "describe",
    "it",
    "test",
    "expect",
    "beforeEach",
    "afterEach",
    "beforeAll",
    "afterAll",
  ])

  while ((match = functionCallRegex.exec(content)) !== null) {
    const funcName = match[1]
    if (!excludedKeywords.has(funcName) && !calledFunctions.includes(funcName)) {
      calledFunctions.push(funcName)
    }
  }

  return {
    hasImport: importedModules.length > 0,
    hasFunctionCall: calledFunctions.length > 0,
    importedModules,
    calledFunctions,
  }
}

/**
 * Checks if a test file imports a specific target module.
 */
export function hasTargetImport(content: string, targetModule: string): boolean {
  const result = parseTestFile(content)
  return result.importedModules.some(
    (mod) => mod === targetModule || mod.endsWith(`/${targetModule}`) || mod.includes(targetModule)
  )
}

/**
 * Checks if a test file calls a specific target function.
 */
export function hasTargetFunctionCall(content: string, targetFunction: string): boolean {
  const result = parseTestFile(content)
  return result.calledFunctions.includes(targetFunction)
}

/**
 * Checks if the file extension is supported.
 */
export function isSupportedExtension(
  filePath: string,
  config: AstTestMatcherConfig = DEFAULT_CONFIG
): boolean {
  return config.supportedExtensions.some((ext) => filePath.endsWith(ext))
}

/**
 * Creates an AST test matcher with the given configuration.
 */
export function createAstTestMatcher(config: Partial<AstTestMatcherConfig> = {}) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }

  return {
    parse: (content: string) => parseTestFile(content, mergedConfig),
    hasTargetImport: (content: string, target: string) => hasTargetImport(content, target),
    hasTargetFunctionCall: (content: string, target: string) =>
      hasTargetFunctionCall(content, target),
    isSupportedExtension: (filePath: string) => isSupportedExtension(filePath, mergedConfig),
  }
}
