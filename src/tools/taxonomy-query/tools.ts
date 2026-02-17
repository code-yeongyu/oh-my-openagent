import type { TaxonomyStore } from "../../agents/coeus/taxonomy/storage"
import type { TaxonomyEntry } from "../../agents/coeus/taxonomy/schema"
import type { TaxonomySearchInput } from "./types"

export function createTaxonomySearchTool(store: TaxonomyStore) {
  return {
    execute: (input: TaxonomySearchInput): string => {
      const { category, include_related = false } = input

      const entry = store.search(category)

      if (!entry) {
        return `Category "${category}" not found in taxonomy.`
      }

      let output = formatEntry(entry)

      if (include_related && entry.related.length > 0) {
        const relatedEntries = store.searchRelated(category)
        if (relatedEntries.length > 0) {
          output += "\n\nRelated Categories:\n"
          for (const relatedEntry of relatedEntries) {
            output += `\n${formatEntry(relatedEntry)}`
          }
        }
      }

      return output
    },
  }
}

function formatEntry(entry: TaxonomyEntry): string {
  let output = `Category: ${entry.category}\n`

  if (entry.complexity) {
    output += `Complexity: ${entry.complexity}\n`
  }

  output += "\nSolutions:\n"
  for (const solution of entry.solutions) {
    output += `  - ${solution.name}: ${solution.description}\n`
    if (solution.sources.length > 0) {
      output += `    Sources:\n`
      for (const source of solution.sources) {
        output += `      - ${source.ref}`
        if (source.url) {
          output += ` (${source.url})`
        }
        output += `\n`
      }
    }
  }

  return output
}
