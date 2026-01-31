/**
 * Command Presets
 *
 * Provides mode-based configuration presets for commands (quick/full/pre-pr)
 */

/**
 * Preset mode enumeration
 */
export enum PresetMode {
  QUICK = "quick",
  FULL = "full",
  PRE_PR = "pre-pr",
}

/**
 * Preset configuration
 */
export interface PresetConfig {
  mode: PresetMode
  runTests: boolean
  runLint: boolean
  runTypecheck: boolean
  runBuild: boolean
  runDeadCodeCheck: boolean
  checkGitStatus: boolean
  timeout: number
}

/**
 * Default preset configurations
 */
const PRESETS: Record<string, PresetConfig> = {
  quick: {
    mode: PresetMode.QUICK,
    runTests: false,
    runLint: true,
    runTypecheck: false,
    runBuild: false,
    runDeadCodeCheck: false,
    checkGitStatus: false,
    timeout: 30000,
  },
  full: {
    mode: PresetMode.FULL,
    runTests: true,
    runLint: true,
    runTypecheck: true,
    runBuild: true,
    runDeadCodeCheck: false,
    checkGitStatus: false,
    timeout: 120000,
  },
  "pre-pr": {
    mode: PresetMode.PRE_PR,
    runTests: true,
    runLint: true,
    runTypecheck: true,
    runBuild: true,
    runDeadCodeCheck: true,
    checkGitStatus: true,
    timeout: 300000,
  },
}

/**
 * Preset Manager interface
 */
export interface PresetManager {
  /** Check if a preset exists */
  hasPreset(name: string): boolean
  /** Get preset configuration */
  getPreset(name: string): PresetConfig
  /** Get preset with custom overrides */
  getPresetWithOverrides(name: string, overrides: Partial<PresetConfig>): PresetConfig
  /** List all available presets */
  listPresets(): string[]
  /** Parse mode from command arguments */
  parseModeFromArgs(args: string[]): string | null
}

/**
 * Preset Manager implementation
 */
class PresetManagerImpl implements PresetManager {
  hasPreset(name: string): boolean {
    return name in PRESETS
  }

  getPreset(name: string): PresetConfig {
    if (!this.hasPreset(name)) {
      const available = this.listPresets().join(", ")
      throw new Error(`Unknown preset mode: "${name}". Available modes: ${available}`)
    }
    return { ...PRESETS[name] }
  }

  getPresetWithOverrides(name: string, overrides: Partial<PresetConfig>): PresetConfig {
    const base = this.getPreset(name)
    return { ...base, ...overrides }
  }

  listPresets(): string[] {
    return Object.keys(PRESETS)
  }

  parseModeFromArgs(args: string[]): string | null {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      
      // Handle --mode=value
      if (arg.startsWith("--mode=")) {
        return arg.slice(7)
      }
      
      // Handle --mode value
      if (arg === "--mode" && i + 1 < args.length) {
        return args[i + 1]
      }
    }
    return null
  }
}

/**
 * Create a new Preset Manager instance
 */
export function createPresetManager(): PresetManager {
  return new PresetManagerImpl()
}
