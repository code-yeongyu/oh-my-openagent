/**
 * Context Detector
 *
 * Detects project context (package manager, framework, etc.) for conditional hook execution.
 */

/**
 * Package manager enumeration
 */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun" | "unknown";

/**
 * Framework enumeration
 */
export type Framework = "react" | "nextjs" | "vue" | "angular" | "svelte" | "unknown";

/**
 * Project context information
 */
export interface ProjectContext {
  packageManager: PackageManager
  framework: Framework
  hasTypeScript: boolean
  hasTesting: boolean
}

/**
 * Hook condition for context-aware matching
 */
export interface HookCondition {
  packageManager?: PackageManager
  framework?: Framework
  hasTypeScript?: boolean
  hasTesting?: boolean
}

/**
 * Lock file to package manager mapping
 */
const LOCK_FILE_MAP: Record<string, PackageManager> = {
  "bun.lockb": "bun",
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
}

/**
 * Config file to framework mapping
 */
const FRAMEWORK_CONFIG_MAP: Record<string, Framework> = {
  "next.config.js": "nextjs",
  "next.config.mjs": "nextjs",
  "next.config.ts": "nextjs",
  "vue.config.js": "vue",
  "angular.json": "angular",
  "svelte.config.js": "svelte",
}

/**
 * Dependency to framework mapping
 */
const FRAMEWORK_DEP_MAP: Record<string, Framework> = {
  next: "nextjs",
  react: "react",
  vue: "vue",
  "@angular/core": "angular",
  svelte: "svelte",
}

/**
 * Context Detector interface
 */
export interface ContextDetector {
  /** Detect project context from directory */
  detect(projectPath: string): ProjectContext
  /** Check if context matches condition */
  matchesCondition(context: ProjectContext, condition: HookCondition): boolean
  /** Set mock files for testing */
  setMockFiles(files: string[]): void
  /** Set mock dependencies for testing */
  setMockDependencies(deps: Record<string, string>): void
}

/**
 * Context Detector implementation
 */
class ContextDetectorImpl implements ContextDetector {
  private mockFiles: string[] | null = null
  private mockDependencies: Record<string, string> | null = null

  detect(projectPath: string): ProjectContext {
    const files = this.mockFiles || []
    const deps = this.mockDependencies || {}

    return {
      packageManager: this.detectPackageManager(files),
      framework: this.detectFramework(files, deps),
      hasTypeScript: this.detectTypeScript(files),
      hasTesting: this.detectTesting(files, deps),
    }
  }

  private detectPackageManager(files: string[]): PackageManager {
    for (const [lockFile, pm] of Object.entries(LOCK_FILE_MAP)) {
      if (files.includes(lockFile)) {
        return pm
      }
    }
    return "unknown"
  }

  private detectFramework(files: string[], deps: Record<string, string>): Framework {
    // Check config files first (more specific)
    for (const [configFile, fw] of Object.entries(FRAMEWORK_CONFIG_MAP)) {
      if (files.includes(configFile)) {
        return fw
      }
    }

    // Check dependencies
    for (const [dep, fw] of Object.entries(FRAMEWORK_DEP_MAP)) {
      if (dep in deps) {
        return fw
      }
    }

    return "unknown"
  }

  private detectTypeScript(files: string[]): boolean {
    return files.includes("tsconfig.json")
  }

  private detectTesting(files: string[], deps: Record<string, string>): boolean {
    const testConfigs = ["jest.config.js", "vitest.config.ts", "vitest.config.js"]
    if (testConfigs.some((f) => files.includes(f))) {
      return true
    }

    const testDeps = ["jest", "vitest", "mocha", "@testing-library/react"]
    return testDeps.some((d) => d in deps)
  }

  matchesCondition(context: ProjectContext, condition: HookCondition): boolean {
    // Empty condition always matches
    if (Object.keys(condition).length === 0) {
      return true
    }

    // All specified conditions must match (AND logic)
    if (condition.packageManager !== undefined) {
      if (context.packageManager !== condition.packageManager) {
        return false
      }
    }

    if (condition.framework !== undefined) {
      if (context.framework !== condition.framework) {
        return false
      }
    }

    if (condition.hasTypeScript !== undefined) {
      if (context.hasTypeScript !== condition.hasTypeScript) {
        return false
      }
    }

    if (condition.hasTesting !== undefined) {
      if (context.hasTesting !== condition.hasTesting) {
        return false
      }
    }

    return true
  }

  setMockFiles(files: string[]): void {
    this.mockFiles = files
  }

  setMockDependencies(deps: Record<string, string>): void {
    this.mockDependencies = deps
  }
}

/**
 * Create a new Context Detector instance
 */
export function createContextDetector(): ContextDetector {
  return new ContextDetectorImpl()
}
