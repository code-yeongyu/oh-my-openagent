# Code Index Skill

Semantic code search and AST-based code intelligence. Index your codebase for natural language queries, find similar code patterns, explore symbol relationships, and understand code behavior.

## Commands

### `/code-index search <query>`

Search codebase using natural language or code patterns.

**Arguments:**
- `query` (required): Natural language query or code pattern
- `--semantic`: Use semantic search (default: true)
- `--lang`: Filter by language
- `--path`: Filter by path pattern
- `--limit`: Max results (default: 10)

**Example:**
```
/code-index search "authentication middleware"
/code-index search "error handling in API routes" --lang typescript
/code-index search "functions that parse JSON" --path src/utils/
```

### `/code-index similar <target>`

Find code similar to a given function, class, or file.

**Arguments:**
- `target` (required): File path, or file:line, or symbol name
- `--limit`: Max results (default: 5)

**Example:**
```
/code-index similar src/auth/login.ts:42
/code-index similar UserService.authenticate
/code-index similar src/utils/parser.ts
```

### `/code-index index [paths]`

Index or re-index the codebase for semantic search.

**Arguments:**
- `paths` (optional): Specific paths to index (default: entire project)
- `--lang`: Languages to index
- `--force`: Force re-index even if up-to-date

**Example:**
```
/code-index index
/code-index index src/ --lang typescript,python
/code-index index --force
```

### `/code-index status`

Show indexing status and statistics.

**Example:**
```
/code-index status
```

**Output:**
```
Index Status: Ready
Last Indexed: 2026-01-03 10:30:00
Files: 1,234
Symbols: 8,567
Languages: TypeScript, Python, Rust
Vector DB: Connected (Qdrant)
```

### `/code-index symbols <query>`

Search for symbols (functions, classes, types) by name.

**Arguments:**
- `query` (required): Symbol name pattern
- `--kind`: Filter by kind (function, class, interface, type, etc.)
- `--lang`: Filter by language

**Example:**
```
/code-index symbols "User*"
/code-index symbols "parse" --kind function
/code-index symbols "Service" --kind class --lang typescript
```

### `/code-index references <symbol>`

Find all references to a symbol.

**Arguments:**
- `symbol` (required): Symbol name or file:line location

**Example:**
```
/code-index references UserService
/code-index references src/auth.ts:42
```

### `/code-index dependencies <target>`

Analyze dependencies of a file or module.

**Arguments:**
- `target` (required): File path or module name
- `--depth`: How deep to traverse (default: 1)
- `--direction`: "imports" or "importedBy" (default: both)

**Example:**
```
/code-index dependencies src/api/users.ts
/code-index dependencies src/utils/ --depth 2
/code-index dependencies UserService --direction importedBy
```

### `/code-index explain <target>`

Get AI-powered explanation of code behavior.

**Arguments:**
- `target` (required): File path, file:line, or symbol name

**Example:**
```
/code-index explain src/auth/oauth.ts:100
/code-index explain handleWebhook
/code-index explain src/utils/parser.ts
```

## Integrations

### Sourcerer MCP
Semantic code search and navigation optimized for AI agents.

No configuration required - works out of the box.

### Smart Coding MCP
AST-aware semantic search with local AI models.

Features:
- Tree-sitter parsing for all languages
- Local embedding models
- RAG-based code understanding

### Qdrant (Vector Database)
High-performance vector storage for code embeddings.

**Environment variables:**
- `QDRANT_URL`: Qdrant server URL (default: http://localhost:6333)
- `QDRANT_API_KEY`: API key for Qdrant Cloud (optional)
- `QDRANT_COLLECTION`: Collection name (default: code-index)

**Free tier:** 1GB cluster free forever on Qdrant Cloud

### Chroma (Vector Database)
Local-first vector database for development.

**Environment variables:**
- `CHROMA_URL`: Chroma server URL (optional, uses local by default)
- `CHROMA_COLLECTION`: Collection name (default: code-index)

## Language Support

| Language | AST Parsing | Semantic Search | Symbol Extraction |
|----------|-------------|-----------------|-------------------|
| TypeScript | ✅ | ✅ | ✅ |
| JavaScript | ✅ | ✅ | ✅ |
| Python | ✅ | ✅ | ✅ |
| Rust | ✅ | ✅ | ✅ |
| Go | ✅ | ✅ | ✅ |
| Java | ✅ | ✅ | ✅ |
| Kotlin | ✅ | ✅ | ✅ |
| C# | ✅ | ✅ | ✅ |
| C/C++ | ✅ | ✅ | ✅ |
| Ruby | ✅ | ✅ | ✅ |
| PHP | ✅ | ✅ | ✅ |
| Swift | ✅ | ✅ | ✅ |
| Scala | ✅ | ✅ | ✅ |

## Use Cases

### Code Discovery
- "Find all functions that handle user authentication"
- "Where is payment processing implemented?"
- "Show me error handling patterns in this codebase"

### Code Understanding
- "Explain what this function does"
- "What are the dependencies of this module?"
- "How is this class used throughout the codebase?"

### Refactoring Support
- "Find similar code that could be deduplicated"
- "Show all places that would be affected by changing this interface"
- "Find all usages of deprecated API"

### Onboarding
- "How does the authentication flow work?"
- "What's the architecture of the API layer?"
- "Where should I add a new feature for X?"

## Best Practices

1. **Index first**: Run `/code-index index` after cloning a new repo
2. **Use semantic search**: Natural language queries often work better than regex
3. **Combine with LSP**: Use `/code-index` for discovery, LSP tools for precise navigation
4. **Re-index after major changes**: Run `/code-index index --force` after large refactors
