// The one list of frontmatter keys a memory note may carry under system/, reference/ and people/. The writers
// stamp the harness-owned keys from these constants and the pre-commit hook's allowlist is generated from the
// same list, so a key a writer adds can never be refused by the hook of the same release (#12221).
export const PROVENANCE_FRONTMATTER_KEY = "provenance"
export const EXPIRES_FRONTMATTER_KEY = "expires"

export const MEMORY_FRONTMATTER_KEYS: readonly string[] = [
  "description",
  "read_only",
  "limit",
  "kind",
  "aliases",
  PROVENANCE_FRONTMATTER_KEY,
  EXPIRES_FRONTMATTER_KEY,
]
