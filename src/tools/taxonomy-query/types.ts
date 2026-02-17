export interface TaxonomySearchInput {
  category: string
  include_related?: boolean
}

export interface TaxonomySearchOutput {
  found: boolean
  entry: TaxonomyEntryResult | null
  related: TaxonomyEntryResult[]
}

export interface TaxonomyEntryResult {
  category: string
  solutions: { name: string; description: string; top_source: string }[]
  complexity?: string
  related: string[]
}
