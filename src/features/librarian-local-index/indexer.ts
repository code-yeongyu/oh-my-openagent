import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises"
import { join, relative, dirname, sep } from "node:path"
import { createHash } from "node:crypto"
import { load as parseYAML, dump as stringifyYAML } from "js-yaml"
import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { getHtmlConverter } from "./html-converter"
import { extractMainContent, extractTagsFromUrl, inferContentType } from "./content-extractor"

export interface DocFrontmatter {
  title: string
  description?: string
  tags: string[]
  library: string
  version?: string
  source?: string
  lastUpdated: string
  contentType: "api" | "guide" | "example" | "reference" | "tutorial"
  difficulty?: "beginner" | "intermediate" | "advanced"
  related?: string[] // Related doc file paths
}

export interface LibraryManifest {
  name: string
  version?: string
  source?: string
  description?: string
  lastUpdated: string
  checksum: string
  tags: string[]
  apiEndpoints: string[]
  concepts: string[]
  docs: string[] // List of doc file paths
}

export interface LibraryEntry {
  manifest: LibraryManifest
  relativePath: string
  contentHash: string
}

export interface TagIndex {
  tag: string
  files: string[] // File paths that have this tag
  libraries: string[] // Library names that have this tag
  count: number
}

export interface SearchIndex {
  tokens: Record<string, string[]> // token -> list of file paths
  libraries: Record<string, LibraryEntry> // library name -> entry
  tags: Record<string, TagIndex> // tag -> index
  lastBuilt: string
}

export interface LibraryIndexOptions {
  libraryPath: string
  maxIndexSize?: number // Maximum size of index in MB
}

export class LibraryIndexer {
  private readonly libraryPath: string
  private readonly indexPath: string
  private readonly searchIndexPath: string
  private readonly docsPath: string
  private readonly patternsPath: string
  private readonly scriptsPath: string
  private readonly maxIndexSize: number

  constructor(options: LibraryIndexOptions) {
    this.libraryPath = options.libraryPath
    this.indexPath = join(this.libraryPath, "index.json")
    this.searchIndexPath = join(this.libraryPath, "search-index.json")
    this.docsPath = join(this.libraryPath, "docs")
    this.patternsPath = join(this.libraryPath, "patterns")
    this.scriptsPath = join(this.libraryPath, "scripts")
    this.maxIndexSize = (options.maxIndexSize ?? 50) * 1024 * 1024 // 50MB default
  }

  /**
   * Build or update the library index
   */
  async buildIndex(): Promise<SearchIndex> {
    log("[LibraryIndexer] Building library index...")
    
    // Ensure directories exist
    await this.ensureDirectories()
    
    const index: SearchIndex = {
      tokens: {},
      libraries: {},
      tags: {},
      lastBuilt: new Date().toISOString()
    }
    
    // Index documentation files
    if (await this.pathExists(this.docsPath)) {
      await this.indexDirectory(this.docsPath, index)
    }
    
    // Index pattern files
    if (await this.pathExists(this.patternsPath)) {
      await this.indexDirectory(this.patternsPath, index)
    }
    
    // Save the index
    await writeFile(this.searchIndexPath, JSON.stringify(index, null, 2))
    
    log(`[LibraryIndexer] Index built with ${Object.keys(index.libraries).length} libraries and ${Object.keys(index.tags).length} tags`)
    return index
  }

  /**
   * Search the local index for a query
   */
  async search(query: string): Promise<{
    results: Array<{
      path: string
      library: string
      relevance: number
      excerpt?: string
      tags?: string[]
    }>
    totalCount: number
  }> {
    const index = await this.loadIndex()
    if (!index) {
      return { results: [], totalCount: 0 }
    }
    
    const queryTokens = this.tokenize(query.toLowerCase())
    const results: Array<{
      path: string
      library: string
      relevance: number
      excerpt?: string
      tags?: string[]
    }> = []
    
    // Score each matching file
    const pathScores = new Map<string, number>()
    const pathTags = new Map<string, string[]>()
    
    for (const token of queryTokens) {
      const matchingPaths = index.tokens[token] || []
      for (const path of matchingPaths) {
        pathScores.set(path, (pathScores.get(path) || 0) + 1)
      }
    }
    
    // Convert scores to results with metadata
    for (const [path, score] of pathScores.entries()) {
      // Find which library this belongs to
      let libraryName = "unknown"
      let tags: string[] = []

      // Normalize path separators for cross-platform compatibility
      const normalizedPath = path.replace(/\\/g, "/")
      for (const [libName, entry] of Object.entries(index.libraries)) {
        const normalizedLibPath = entry.relativePath.replace(/\\/g, "/")
        if (normalizedPath.startsWith(normalizedLibPath)) {
          libraryName = libName
          break
        }
      }
      
      // Extract tags from frontmatter
      for (const tagIndex of Object.values(index.tags)) {
        if (tagIndex.files.includes(path)) {
          tags.push(tagIndex.tag)
        }
      }
      
      results.push({
        path,
        library: libraryName,
        relevance: score / queryTokens.length,
        tags
      })
    }
    
    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance)
    
    return {
      results: results.slice(0, 20), // Top 20 results
      totalCount: results.length
    }
  }

  /**
   * Query by tags - returns all documents with matching tags
   */
  async queryByTags(tags: string[], operator: "AND" | "OR" = "OR"): Promise<{
    results: Array<{
      path: string
      library: string
      frontmatter: DocFrontmatter
      excerpt?: string
    }>
    totalCount: number
  }> {
    const index = await this.loadIndex()
    if (!index) {
      return { results: [], totalCount: 0 }
    }
    
    const matchingFiles = new Set<string>()
    const fileFrontmatter = new Map<string, DocFrontmatter>()
    
    for (const tag of tags) {
      const tagIndex = index.tags[tag]
      if (tagIndex) {
        if (operator === "OR") {
          // Add all files with this tag
          for (const file of tagIndex.files) {
            matchingFiles.add(file)
          }
        } else if (operator === "AND") {
          // For AND, track files that have ALL tags
          if (matchingFiles.size === 0) {
            // First tag - add all its files
            for (const file of tagIndex.files) {
              matchingFiles.add(file)
            }
          } else {
            // Intersect with existing files
            const currentFiles = new Set(tagIndex.files)
            for (const file of matchingFiles) {
              if (!currentFiles.has(file)) {
                matchingFiles.delete(file)
              }
            }
          }
        }
      }
    }
    
    // Load frontmatter for matching files
    const results: Array<{
      path: string
      library: string
      frontmatter: DocFrontmatter
      excerpt?: string
    }> = []
    
    for (const file of matchingFiles) {
      // Normalize file path for cross-platform file system access
      const normalizedFile = file.replace(/\//g, sep)
      const frontmatter = await this.extractFrontmatter(join(this.libraryPath, normalizedFile))
      if (frontmatter) {
        fileFrontmatter.set(file, frontmatter)

        // Find library name (compare with normalized paths)
        let libraryName = "unknown"
        const normalizedFilePath = file.replace(/\\/g, "/")
        for (const [libName, entry] of Object.entries(index.libraries)) {
          const normalizedLibPath = entry.relativePath.replace(/\\/g, "/")
          if (normalizedFilePath.startsWith(normalizedLibPath)) {
            libraryName = libName
            break
          }
        }

        results.push({
          path: file,
          library: libraryName,
          frontmatter
        })
      }
    }
    
    // Sort by relevance (more tags = higher relevance)
    results.sort((a, b) => (b.frontmatter.tags?.length || 0) - (a.frontmatter.tags?.length || 0))
    
    return {
      results: results.slice(0, 50),
      totalCount: results.length
    }
  }

  /**
   * Add a library documentation as markdown with YAML frontmatter
   */
  async addLibraryDoc(
    libraryName: string,
    content: string,
    frontmatter: Partial<DocFrontmatter>,
    fileName?: string
  ): Promise<void> {
    const libraryDir = join(this.docsPath, libraryName)
    await this.ensureDirectory(libraryDir)
    
    // Create full frontmatter
    const fullFrontmatter: DocFrontmatter = {
      title: frontmatter.title || `${libraryName} Documentation`,
      tags: frontmatter.tags || [],
      library: libraryName,
      lastUpdated: new Date().toISOString(),
      contentType: frontmatter.contentType || "reference",
      ...frontmatter
    }
    
    // Generate markdown with YAML frontmatter
    const markdownContent = this.createMarkdownWithFrontmatter(content, fullFrontmatter)
    
    // Save as markdown file
    const docFileName = fileName || `${libraryName}.md`
    const docPath = join(libraryDir, docFileName)
    await writeFile(docPath, markdownContent)
    
    // Update library manifest
    await this.updateLibraryManifest(libraryName, docFileName, fullFrontmatter)
    
    // Rebuild index
    await this.buildIndex()
    
    log(`[LibraryIndexer] Added library doc: ${libraryName}/${docFileName}`)
  }

  /**
   * Pull documentation from web and save as local markdown
   */
  async pullDocumentation(
    libraryName: string,
    sourceUrls: string[],
    options: {
      extractMain?: boolean
    } = {}
  ): Promise<{
    success: string[]
    failed: Array<{ url: string; error: string }>
  }> {
    log(`[LibraryIndexer] Pulling documentation for ${libraryName}...`)

    const libraryDir = join(this.docsPath, libraryName)
    await this.ensureDirectory(libraryDir)

    const results = {
      success: [] as string[],
      failed: [] as Array<{ url: string; error: string }>
    }

    const converter = getHtmlConverter()

    for (const url of sourceUrls) {
      try {
        // Fetch HTML content from URL
        const response = await fetch(url, {
          headers: {
            "User-Agent": "OpenCode-Librarian/1.0 (Documentation Indexer)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const html = await response.text()

        // Extract main content and metadata
        const extracted = extractMainContent(html)

        // Convert HTML to markdown
        const markdown = converter.convert(extracted.content)

        // Generate tags from URL and extracted keywords
        const urlTags = extractTagsFromUrl(url)
        const allTags = [...new Set([
          ...urlTags,
          ...(extracted.keywords || []),
          libraryName.toLowerCase()
        ])]

        // Infer content type
        const contentType = inferContentType(url, markdown)

        // Build frontmatter
        const frontmatter: Partial<DocFrontmatter> = {
          title: extracted.title,
          description: extracted.description,
          source: url,
          tags: allTags,
          contentType,
        }

        // Generate filename and save
        const fileName = this.generateFileNameFromUrl(url)
        await this.addLibraryDoc(libraryName, markdown, frontmatter, fileName)

        results.success.push(url)
        log(`[LibraryIndexer] Successfully pulled: ${url}`)

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        results.failed.push({ url, error: errorMessage })
        log(`[LibraryIndexer] Failed to pull ${url}: ${errorMessage}`)
      }
    }

    log(`[LibraryIndexer] Pull complete: ${results.success.length} success, ${results.failed.length} failed`)
    return results
  }

  /**
   * Get cached documentation for a library
   */
  async getLibraryDocs(libraryName: string): Promise<Array<{
    fileName: string
    frontmatter: DocFrontmatter
    content: string
  }>> {
    const libraryDir = join(this.docsPath, libraryName)
    
    if (!(await this.pathExists(libraryDir))) {
      return []
    }
    
    const docs: Array<{
      fileName: string
      frontmatter: DocFrontmatter
      content: string
    }> = []
    
    const entries = await readdir(libraryDir, { withFileTypes: true })
    
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const filePath = join(libraryDir, entry.name)
        const { frontmatter, content } = await this.parseMarkdownWithFrontmatter(filePath)
        
        if (frontmatter) {
          docs.push({
            fileName: entry.name,
            frontmatter,
            content
          })
        }
      }
    }
    
    return docs
  }

  /**
   * Create a script for querying by tags
   */
  async createTagQueryScript(): Promise<void> {
    const scriptContent = `#!/usr/bin/env node

/**
 * Library Tag Query Script
 * Usage: node query-by-tags.js tag1,tag2 [--and] [--library libname]
 */

const fs = require('fs').promises;
const path = require('path');

async function queryByTags() {
  const args = process.argv.slice(2);
  let tags = [];
  let operator = 'OR';
  let libraryFilter = null;
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--and') {
      operator = 'AND';
    } else if (arg === '--library' && i + 1 < args.length) {
      libraryFilter = args[++i];
    } else if (!arg.startsWith('--')) {
      tags = arg.split(',').map(t => t.trim());
    }
  }
  
  if (tags.length === 0) {
    console.error('Error: Please provide at least one tag');
    process.exit(1);
  }
  
  try {
    // Load search index
    const indexPath = path.join(__dirname, '..', 'search-index.json');
    const indexData = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(indexData);
    
    // Find matching files
    const matchingFiles = new Set();
    
    for (const tag of tags) {
      const tagIndex = index.tags[tag];
      if (tagIndex) {
        if (operator === 'OR') {
          tagIndex.files.forEach(file => matchingFiles.add(file));
        } else {
          if (matchingFiles.size === 0) {
            tagIndex.files.forEach(file => matchingFiles.add(file));
          } else {
            const current = new Set(tagIndex.files);
            for (const file of matchingFiles) {
              if (!current.has(file)) {
                matchingFiles.delete(file);
              }
            }
          }
        }
      }
    }
    
    // Filter by library if specified
    const results = [];
    for (const file of matchingFiles) {
      if (libraryFilter && !file.includes(\`docs/\${libraryFilter}/\`)) {
        continue;
      }
      
      // Load frontmatter
      const filePath = path.join(__dirname, '..', file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const frontmatterMatch = content.match(/^---\\n([\\s\\S]*?)\\n---/);
        if (frontmatterMatch) {
          const yaml = require('yaml');
          const frontmatter = yaml.parse(frontmatterMatch[1]);
          results.push({ file, frontmatter });
        }
      } catch (e) {
        // Skip files that can't be read
      }
    }
    
    // Display results
    console.log(\`Found \${results.length} documents with tags: \${tags.join(', ')} (\${operator})\\n\`);
    
    for (const result of results) {
      console.log(\`📄 \${result.file}\`);
      console.log(\`   Title: \${result.frontmatter.title}\`);
      console.log(\`   Tags: \${result.frontmatter.tags.join(', ')}\`);
      console.log(\`   Type: \${result.frontmatter.contentType}\`);
      if (result.frontmatter.description) {
        console.log(\`   Description: \${result.frontmatter.description}\`);
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('Error querying tags:', error.message);
    process.exit(1);
  }
}

queryByTags();
`
    
    const scriptPath = join(this.scriptsPath, "query-by-tags.js")
    await writeFile(scriptPath, scriptContent)
    
    // Make it executable (on Unix systems)
    // In a real implementation, you'd use chmod +x
    
    log(`[LibraryIndexer] Created tag query script: ${scriptPath}`)
  }

  /**
   * Load the existing search index
   */
  private async loadIndex(): Promise<SearchIndex | null> {
    try {
      if (!(await this.pathExists(this.searchIndexPath))) {
        return null
      }
      
      const content = await readFile(this.searchIndexPath, "utf-8")
      return JSON.parse(content) as SearchIndex
    } catch (error) {
      log("[LibraryIndexer] Error loading index:", error)
      return null
    }
  }

  /**
   * Index a directory recursively
   */
  private async indexDirectory(dirPath: string, index: SearchIndex): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      const relativePath = relative(this.libraryPath, fullPath)
      
      if (entry.isDirectory()) {
        await this.indexDirectory(fullPath, index)
      } else if (entry.isFile() && this.shouldIndexFile(entry.name)) {
        await this.indexFile(fullPath, relativePath, index)
      }
    }
  }

  /**
   * Index a single file
   */
  private async indexFile(
    filePath: string,
    relativePath: string,
    index: SearchIndex
  ): Promise<void> {
    // Normalize path separators for cross-platform compatibility
    const normalizedRelativePath = relativePath.replace(/\\/g, "/")

    try {
      const content = await readFile(filePath, "utf-8")

      // Extract frontmatter if it's a markdown file
      let frontmatterTags: string[] = []
      let libraryName = ""

      if (normalizedRelativePath.endsWith(".md")) {
        const { frontmatter } = await this.parseMarkdownWithFrontmatter(filePath)
        if (frontmatter) {
          frontmatterTags = frontmatter.tags || []
          libraryName = frontmatter.library || ""
          
          // Update tag index
          for (const tag of frontmatterTags) {
            if (!index.tags[tag]) {
              index.tags[tag] = {
                tag,
                files: [],
                libraries: [],
                count: 0
              }
            }

            if (!index.tags[tag].files.includes(normalizedRelativePath)) {
              index.tags[tag].files.push(normalizedRelativePath)
              index.tags[tag].count++
            }

            if (libraryName && !index.tags[tag].libraries.includes(libraryName)) {
              index.tags[tag].libraries.push(libraryName)
            }
          }

          // Also track this library in the libraries index if not already present
          if (libraryName && !index.libraries[libraryName]) {
            // Extract library path from relative path (e.g., "docs/react/useEffect.md" -> "docs/react")
            const libraryPath = normalizedRelativePath.substring(0, normalizedRelativePath.lastIndexOf("/"))
            index.libraries[libraryName] = {
              manifest: {
                name: libraryName,
                lastUpdated: new Date().toISOString(),
                checksum: "",
                tags: frontmatterTags,
                apiEndpoints: [],
                concepts: [],
                docs: [normalizedRelativePath]
              },
              relativePath: libraryPath,
              contentHash: ""
            }
          } else if (libraryName && index.libraries[libraryName]) {
            // Add doc to existing library
            if (!index.libraries[libraryName].manifest.docs.includes(normalizedRelativePath)) {
              index.libraries[libraryName].manifest.docs.push(normalizedRelativePath)
            }
          }
        }
      }

      // Tokenize content for full-text search
      const tokens = this.tokenize(content.toLowerCase())

      // Add tokens to index
      for (const token of tokens) {
        if (!index.tokens[token]) {
          index.tokens[token] = []
        }
        if (!index.tokens[token].includes(normalizedRelativePath)) {
          index.tokens[token].push(normalizedRelativePath)
        }
      }

      // Check if this is a library manifest
      if (normalizedRelativePath.endsWith("manifest.json")) {
        try {
          const manifest = JSON.parse(content) as LibraryManifest
          index.libraries[manifest.name] = {
            manifest,
            relativePath: normalizedRelativePath.replace("/manifest.json", ""),
            contentHash: createHash("sha256").update(content).digest("hex")
          }
        } catch {
          // Ignore invalid JSON
        }
      }
    } catch (error) {
      log(`[LibraryIndexer] Error indexing file ${filePath}:`, error)
    }
  }

  /**
   * Parse markdown file and extract frontmatter
   */
  private async parseMarkdownWithFrontmatter(filePath: string): Promise<{
    frontmatter: DocFrontmatter | null
    content: string
  }> {
    try {
      const fileContent = await readFile(filePath, "utf-8")

      // Match frontmatter with flexible line endings (handles \r\n on Windows)
      const frontmatterMatch = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
      if (!frontmatterMatch) {
        return { frontmatter: null, content: fileContent }
      }

      const frontmatter = parseYAML(frontmatterMatch[1]) as DocFrontmatter
      const content = frontmatterMatch[2] || ""

      return { frontmatter, content }
    } catch (error) {
      return { frontmatter: null, content: "" }
    }
  }

  /**
   * Extract frontmatter from markdown content or file path
   */
  private async extractFrontmatter(contentOrPath: string): Promise<DocFrontmatter | null> {
    try {
      let content: string

      // Check if it's a file path or content
      if (contentOrPath.includes("\\") || contentOrPath.includes("/")) {
        content = await readFile(contentOrPath, "utf-8")
      } else {
        content = contentOrPath
      }

      // Match frontmatter with flexible line endings
      const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!frontmatterMatch) {
        return null
      }

      const frontmatter = parseYAML(frontmatterMatch[1]) as DocFrontmatter
      return frontmatter
    } catch (error) {
      return null
    }
  }

  /**
   * Create markdown with YAML frontmatter
   */
  private createMarkdownWithFrontmatter(content: string, frontmatter: DocFrontmatter): string {
    const yamlFrontmatter = stringifyYAML(frontmatter)
    return `---\n${yamlFrontmatter}\n---\n\n${content}`
  }

  /**
   * Update library manifest
   */
  private async updateLibraryManifest(
    libraryName: string,
    docFileName: string,
    frontmatter: DocFrontmatter
  ): Promise<void> {
    const manifestPath = join(this.docsPath, libraryName, "manifest.json")
    
    let manifest: LibraryManifest
    try {
      const existingContent = await readFile(manifestPath, "utf-8")
      manifest = JSON.parse(existingContent) as LibraryManifest
    } catch {
      // Create new manifest
      manifest = {
        name: libraryName,
        lastUpdated: new Date().toISOString(),
        checksum: "",
        tags: [],
        apiEndpoints: [],
        concepts: [],
        docs: []
      }
    }
    
    // Update manifest
    manifest.lastUpdated = new Date().toISOString()
    manifest.docs.push(docFileName)
    
    // Merge tags
    for (const tag of frontmatter.tags || []) {
      if (!manifest.tags.includes(tag)) {
        manifest.tags.push(tag)
      }
    }
    
    // Save manifest
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  }

  /**
   * Generate filename from URL
   */
  private generateFileNameFromUrl(url: string): string {
    const urlObj = new URL(url)
    let filename = urlObj.pathname.split("/").pop() || "doc"
    
    if (!filename.endsWith(".md")) {
      filename += ".md"
    }
    
    // Sanitize filename
    return filename.replace(/[^a-zA-Z0-9\-_\.]/g, "_")
  }

  /**
   * Tokenize text for search indexing
   */
  private tokenize(text: string): string[] {
    // Extract words, camelCase parts, and special patterns
    const tokens = new Set<string>()
    
    // Regular words
    for (const word of text.match(/\b\w+\b/g) || []) {
      tokens.add(word)
    }
    
    // CamelCase parts (e.g., "useState" -> ["use", "state"])
    for (const camelCase of text.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) || []) {
      const parts = camelCase.split(/(?=[A-Z])/)
      for (const part of parts) {
        if (part.length > 2) {
          tokens.add(part.toLowerCase())
        }
      }
    }
    
    // API patterns (e.g., "function()", "Class.method")
    for (const api of text.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)/g) || []) {
      const name = api.split(/\s*\(/)[0]
      if (name.length > 2) {
        tokens.add(name)
      }
    }
    
    return Array.from(tokens)
  }

  /**
   * Check if a file should be indexed
   */
  private shouldIndexFile(fileName: string): boolean {
    const indexableExtensions = [".md", ".txt", ".json", ".js", ".ts", ".py", ".java", ".cpp", ".c"]
    return indexableExtensions.some(ext => fileName.endsWith(ext))
  }

  /**
   * Ensure directories exist
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await stat(dirPath)
    } catch {
      // Directory doesn't exist, create it
      await mkdir(dirPath, { recursive: true })
      log(`[LibraryIndexer] Created directory: ${dirPath}`)
    }
  }

  /**
   * Ensure directories exist
   */
  private async ensureDirectories(): Promise<void> {
    await this.ensureDirectory(this.libraryPath)
    await this.ensureDirectory(this.docsPath)
    await this.ensureDirectory(this.patternsPath)
    await this.ensureDirectory(this.scriptsPath)
  }

  /**
   * Check if a path exists
   */
  private async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }
}

/**
 * Create a library indexer instance
 */
export function createLibraryIndexer(
  ctx: PluginInput,
  options?: Partial<LibraryIndexOptions>
): LibraryIndexer {
  const libraryPath = join(ctx.directory, "./library")
  return new LibraryIndexer({ libraryPath, ...options })
}