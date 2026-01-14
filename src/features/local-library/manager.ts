import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { glob } from "glob";
import { 
  LibraryDoc, 
  LibraryIndex, 
  QueryOptions, 
  AddDocOptions,
  FrontmatterSchema,
  type FrontmatterType 
} from "./index";

export class LibraryManager {
  private libraryPath: string;
  private indexPath: string;
  private docsPath: string;
  private index: LibraryIndex;

  constructor(libraryPath: string = "./library") {
    this.libraryPath = path.resolve(libraryPath);
    this.indexPath = path.join(this.libraryPath, "index.json");
    this.docsPath = path.join(this.libraryPath, "docs");
    this.index = { documents: [], tagIndex: {}, languageIndex: {}, searchIndex: {} };
  }

  /**
   * Initialize library folder structure
   */
  async init(): Promise<void> {
    await fs.mkdir(this.docsPath, { recursive: true });
    
    // Initialize empty index if it doesn't exist
    try {
      const existingIndex = await fs.readFile(this.indexPath, 'utf-8');
      this.index = JSON.parse(existingIndex);
      // Hydrate date fields
      this.index.documents = this.index.documents.map(doc => ({
        ...doc,
        createdAt: new Date(doc.createdAt as string),
        updatedAt: new Date(doc.updatedAt as string),
      }));
    } catch (error) {
      await this.saveIndex();
    }
  }

  /**
   * Add a document to the library
   */
  async addDoc(
    content: string,
    options: AddDocOptions & { title: string; source: string; tags: string[] }
  ): Promise<LibraryDoc> {
    const now = new Date().toISOString();
    
    // Generate ID from title or use provided
    const id = options.id || this.generateId(options.title);
    const sanitizedId = path.basename(id.replace(/[/\\]/g, '_'));
    const filePath = path.join(this.docsPath, `${sanitizedId}.md`);

    // Create frontmatter
    const frontmatter: FrontmatterType = {
      id: sanitizedId,
      title: options.title,
      source: options.source,
      created_at: options.overwrite ? 
        this.getDocument(id)?.createdAt || now : 
        now,
      updated_at: now,
      tags: options.tags || [],
      language: options.language,
      version: options.version,
      description: options.description,
    };

    // Validate frontmatter
    const validated = FrontmatterSchema.parse(frontmatter);

    // Write markdown file with frontmatter
    const markdown = this.createMarkdownWithFrontmatter(content, validated);

    if (!options.overwrite) {
      // Check if file exists
      try {
        await fs.access(filePath);
        throw new Error(`Document with id "${sanitizedId}" already exists. Use overwrite=true to replace it.`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    await fs.writeFile(filePath, markdown, 'utf-8');

    // Create document object
    const doc: LibraryDoc = {
      id: sanitizedId,
      title: validated.title,
      source: validated.source,
      createdAt: new Date(validated.created_at),
      updatedAt: new Date(validated.updated_at),
      filePath: path.relative(this.libraryPath, filePath),
      tags: validated.tags,
      language: validated.language,
      version: validated.version,
      description: validated.description,
    };

    // Update index
    this.updateIndex(doc);
    await this.saveIndex();

    return doc;
  }

  /**
   * Query documents from the library
   */
  async query(options: QueryOptions = {}): Promise<LibraryDoc[]> {
    let results = [...this.index.documents];

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      const docIds = new Set<string>();
      options.tags.forEach(tag => {
        const ids = this.index.tagIndex[tag] || [];
        ids.forEach(id => docIds.add(id));
      });
      results = results.filter(doc => docIds.has(doc.id));
    }

    // Filter by language
    if (options.language) {
      const docIds = this.index.languageIndex[options.language] || [];
      const docIdSet = new Set(docIds);
      results = results.filter(doc => docIdSet.has(doc.id));
    }

    // Filter by version
    if (options.version) {
      results = results.filter(doc => doc.version === options.version);
    }

    // Full-text search
    if (options.query) {
      const query = options.query.toLowerCase();
      const searchTerms = query.split(/\s+/);
      
      results = results.filter(doc => {
        const searchable = [
          doc.title,
          doc.description || '',
          doc.tags.join(' '),
          doc.language || '',
          doc.version || '',
        ].join(' ').toLowerCase();

        return searchTerms.every(term => searchable.includes(term));
      });
    }

    // Sort results
    results = this.sortResults(results, options.sortBy);

    // Apply limit
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get all available tags
   */
  async listTags(language?: string): Promise<string[]> {
    let tags = Object.keys(this.index.tagIndex);

    if (language) {
      const docIds = this.index.languageIndex[language] || [];
      const docIdSet = new Set(docIds);
      tags = tags.filter(tag => {
        const tagDocIds = this.index.tagIndex[tag] || [];
        return tagDocIds.some(id => docIdSet.has(id));
      });
    }

    return tags.sort();
  }

  /**
   * Sync index with file system
   */
  async sync(): Promise<void> {
    const markdownFiles = await glob(path.join(this.docsPath, "*.md"));
    
    // Reset index
    this.index = { documents: [], tagIndex: {}, languageIndex: {}, searchIndex: {} };

    for (const filePath of markdownFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const { frontmatter, body } = this.parseMarkdownWithFrontmatter(content);
        
        if (frontmatter && FrontmatterSchema.safeParse(frontmatter).success) {
          const validated = FrontmatterSchema.parse(frontmatter);
          const doc: LibraryDoc = {
            id: validated.id,
            title: validated.title,
            source: validated.source,
            createdAt: new Date(validated.created_at),
            updatedAt: new Date(validated.updated_at),
            filePath: path.relative(this.libraryPath, filePath),
            tags: validated.tags,
            language: validated.language,
            version: validated.version,
            description: validated.description,
          };
          
          this.updateIndex(doc);
        }
      } catch (error) {
        console.warn(`Failed to index ${filePath}:`, error);
      }
    }

    await this.saveIndex();
  }

  /**
   * Get library statistics
   */
  async getStats(): Promise<{
    totalDocs: number;
    totalTags: number;
    languages: Record<string, number>;
    recentDocs: number;
  }> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentDocs = this.index.documents.filter(
      doc => doc.createdAt > thirtyDaysAgo
    ).length;

    const languages: Record<string, number> = {};
    this.index.documents.forEach(doc => {
      if (doc.language) {
        languages[doc.language] = (languages[doc.language] || 0) + 1;
      }
    });

    return {
      totalDocs: this.index.documents.length,
      totalTags: Object.keys(this.index.tagIndex).length,
      languages,
      recentDocs,
    };
  }

  private generateId(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }

  private createMarkdownWithFrontmatter(content: string, frontmatter: FrontmatterType): string {
    const yamlStr = yaml.dump(frontmatter, {
      defaultQuotingType: '"',
      defaultQuotingStyle: '"',
    });
    
    return `---\n${yamlStr}---\n\n${content}`;
  }

  private parseMarkdownWithFrontmatter(content: string): {
    frontmatter?: any;
    body: string;
  } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);
    
    if (match) {
      try {
        const frontmatter = yaml.load(match[1]);
        return { frontmatter, body: match[2] };
      } catch (error) {
        // Invalid YAML
        return { body: content };
      }
    }
    
    return { body: content };
  }

  private updateIndex(doc: LibraryDoc): void {
    // Remove existing doc with same ID if it exists
    const existingIndex = this.index.documents.findIndex(d => d.id === doc.id);
    if (existingIndex !== -1) {
      const oldDoc = this.index.documents[existingIndex];
      // Clean up old indices
      oldDoc.tags.forEach(tag => {
        const idx = this.index.tagIndex[tag]?.indexOf(doc.id);
        if (idx !== undefined && idx > -1) {
          this.index.tagIndex[tag].splice(idx, 1);
        }
      });
      
      if (oldDoc.language) {
        const idx = this.index.languageIndex[oldDoc.language]?.indexOf(doc.id);
        if (idx !== undefined && idx > -1) {
          this.index.languageIndex[oldDoc.language].splice(idx, 1);
        }
      }
      
      this.index.documents.splice(existingIndex, 1);
    }

    // Add new document
    this.index.documents.push(doc);

    // Update tag index
    doc.tags.forEach(tag => {
      if (!this.index.tagIndex[tag]) {
        this.index.tagIndex[tag] = [];
      }
      if (!this.index.tagIndex[tag].includes(doc.id)) {
        this.index.tagIndex[tag].push(doc.id);
      }
    });

    // Update language index
    if (doc.language) {
      if (!this.index.languageIndex[doc.language]) {
        this.index.languageIndex[doc.language] = [];
      }
      if (!this.index.languageIndex[doc.language].includes(doc.id)) {
        this.index.languageIndex[doc.language].push(doc.id);
      }
    }

    // Update search index (simplified - just tokenize title and description)
    const searchable = [doc.title, doc.description || ''].join(' ').toLowerCase();
    const tokens = searchable.split(/\s+/).filter(t => t.length > 2);
    
    tokens.forEach(token => {
      if (!this.index.searchIndex[token]) {
        this.index.searchIndex[token] = [];
      }
      if (!this.index.searchIndex[token].includes(doc.id)) {
        this.index.searchIndex[token].push(doc.id);
      }
    });
  }

  private sortResults(docs: LibraryDoc[], sortBy?: string): LibraryDoc[] {
    if (!sortBy || sortBy === 'relevance') {
      return docs;
    }

    return docs.sort((a, b) => {
      switch (sortBy) {
        case 'createdAt':
          return b.createdAt.getTime() - a.createdAt.getTime();
        case 'updatedAt':
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });
  }

  private async saveIndex(): Promise<void> {
    await fs.writeFile(
      this.indexPath,
      JSON.stringify(this.index, null, 2),
      'utf-8'
    );
  }

  private getDocument(id: string): LibraryDoc | undefined {
    return this.index.documents.find(doc => doc.id === id);
  }
}