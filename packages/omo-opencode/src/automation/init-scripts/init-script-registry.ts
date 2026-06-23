import type { InitScript, InitScriptRegistry } from "./types"

export class InitScriptValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InitScriptValidationError"
  }
}

export function createInitScriptRegistry(): InitScriptRegistry {
  const scripts = new Map<string, InitScript>()
  return {
    register(script: InitScript): void {
      if (!script.name || typeof script.name !== "string") {
        throw new InitScriptValidationError("InitScript: name required and must be string")
      }
      if (!script.source || typeof script.source !== "string") {
        throw new InitScriptValidationError("InitScript: source required and must be string")
      }
      scripts.set(script.name, script)
    },
    list(): InitScript[] {
      return Array.from(scripts.values())
    },
    has(name: string): boolean {
      return scripts.has(name)
    },
    clear(): void {
      scripts.clear()
    },
  }
}
