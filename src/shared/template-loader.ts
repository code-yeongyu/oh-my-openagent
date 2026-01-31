/**
 * Template Loader
 *
 * Loads external reference files for complex templates.
 * Supports variable substitution and caching.
 */

import { join } from "path"

/**
 * Template variables for substitution
 */
export type TemplateVariables = Record<string, string>

/**
 * Template Loader interface
 */
export interface TemplateLoader {
  /** Load template from references directory */
  load(filename: string): Promise<string | null>
  /** Load template with variable substitution */
  loadWithVariables(filename: string, variables: TemplateVariables): Promise<string | null>
  /** Load with inline fallback if file not found */
  loadWithFallback(filename: string, fallback: string): Promise<string>
  /** Get references path for a skill */
  getReferencesPath(skillName: string): string
  /** Clear template cache */
  clearCache(): void
  /** Set mock template for testing */
  setMockTemplate(filename: string, content: string): void
}

/**
 * Substitute variables in template content
 */
function substituteVariables(content: string, variables: TemplateVariables): string {
  let result = content
  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g")
    result = result.replace(pattern, value)
  }
  return result
}

/**
 * Template Loader implementation
 */
class TemplateLoaderImpl implements TemplateLoader {
  private cache = new Map<string, string>()
  private mockTemplates = new Map<string, string>()

  async load(filename: string): Promise<string | null> {
    // Check cache first
    if (this.cache.has(filename)) {
      return this.cache.get(filename)!
    }

    // Check mock templates (for testing)
    if (this.mockTemplates.has(filename)) {
      const content = this.mockTemplates.get(filename)!
      this.cache.set(filename, content)
      return content
    }

    // In real implementation, would read from filesystem
    // For now, return null to trigger fallback
    return null
  }

  async loadWithVariables(
    filename: string,
    variables: TemplateVariables
  ): Promise<string | null> {
    const content = await this.load(filename)
    if (content === null) {
      return null
    }
    return substituteVariables(content, variables)
  }

  async loadWithFallback(filename: string, fallback: string): Promise<string> {
    const content = await this.load(filename)
    return content ?? fallback
  }

  getReferencesPath(skillName: string): string {
    return join("src", "features", "builtin-skills", skillName, "references")
  }

  clearCache(): void {
    this.cache.clear()
  }

  setMockTemplate(filename: string, content: string): void {
    this.mockTemplates.set(filename, content)
    // Don't clear cache - let cache persist for testing caching behavior
  }
}

/**
 * Create a new Template Loader instance
 */
export function createTemplateLoader(): TemplateLoader {
  return new TemplateLoaderImpl()
}
