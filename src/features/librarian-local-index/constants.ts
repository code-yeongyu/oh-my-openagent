export const LIBRARIAN_LOCAL_INDEX_DESCRIPTION = `Local library index for the librarian agent. Provides fast, offline access to documentation with tag-based querying and YAML frontmatter support.

Actions:
- search: Text search across all indexed documentation
- query-tags: Find documents by tags (supports AND/OR operators)
- add-doc: Add new documentation with YAML frontmatter
- pull-docs: Pull documentation from web sources and save as local markdown
- get-docs: Retrieve all documentation for a specific library
- build-index: Rebuild the search and tag index
- create-script: Create a standalone script for tag queries

The local index avoids web searches and provides semantic tagging for better machine readability.`