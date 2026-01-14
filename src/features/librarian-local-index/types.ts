export interface LibrarianLocalIndexArgs {
  action: "search" | "query-tags" | "add-doc" | "pull-docs" | "get-docs" | "build-index" | "create-script"
  query?: string
  tags?: string[]
  operator?: "AND" | "OR"
  library?: string
  content?: string
  frontmatter?: string
  sources?: string[]
  fileName?: string
}