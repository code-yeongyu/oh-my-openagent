/**
 * @deprecated This module is deprecated. Use `librarian-local-index` instead.
 *
 * The `librarian-local-index` module provides a more comprehensive implementation with:
 * - Full-text tokenized search with relevance scoring
 * - Tag-based queries with AND/OR operators
 * - Library manifests for tracking API endpoints and concepts
 * - Standalone query script generation
 * - Integration with the enhanced-librarian agent
 *
 * This module will be removed in a future version.
 *
 * @see src/features/librarian-local-index
 */
import { z } from "zod";
import type { Tool } from "@opencode-ai/sdk";

// Types for local library index system
export interface LibraryDoc {
  /** Unique identifier for the document */
  id: string;
  /** Title of the document */
  title: string;
  /** Source URL or reference */
  source: string;
  /** Date when document was fetched/created */
  createdAt: Date;
  /** Date when document was last updated */
  updatedAt: Date;
  /** File path relative to library root */
  filePath: string;
  /** Tags for categorization and search */
  tags: string[];
  /** Language/library/framework this doc relates to */
  language?: string;
  /** Version of the library/framework */
  version?: string;
  /** Brief description of content */
  description?: string;
}

export interface LibraryIndex {
  /** All indexed documents */
  documents: LibraryDoc[];
  /** Tag to document IDs mapping */
  tagIndex: Record<string, string[]>;
  /** Language to document IDs mapping */
  languageIndex: Record<string, string[]>;
  /** Full-text search index (simplified) */
  searchIndex: Record<string, string[]>;
}

export interface QueryOptions {
  /** Tag filters */
  tags?: string[];
  /** Language filter */
  language?: string;
  /** Version filter */
  version?: string;
  /** Search query (full-text) */
  query?: string;
  /** Maximum results to return */
  limit?: number;
  /** Sort order */
  sortBy?: 'relevance' | 'createdAt' | 'updatedAt' | 'title';
}

export interface AddDocOptions {
  /** Overwrite if document already exists */
  overwrite?: boolean;
  /** Tags to add to frontmatter */
  tags?: string[];
  /** Language */
  language?: string;
  /** Version */
  version?: string;
  /** Description */
  description?: string;
}

// Schema for YAML frontmatter
export const FrontmatterSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tags: z.array(z.string()),
  language: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
});

export type FrontmatterType = z.infer<typeof FrontmatterSchema>;

// Tool definitions for library management
export const LIBRARY_TOOLS: Record<string, Tool> = {
  library_init: {
    description: "Initialize the local library index structure",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path where to create the library folder (default: ./library)",
        },
      },
      required: [],
    },
  },
  
  library_add_doc: {
    description: "Add a document to the library index",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Markdown content of the document",
        },
        title: {
          type: "string",
          description: "Title of the document",
        },
        source: {
          type: "string",
          description: "Source URL or reference",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization",
        },
        language: {
          type: "string",
          description: "Language/library/framework",
        },
        version: {
          type: "string",
          description: "Version of the library/framework",
        },
        description: {
          type: "string",
          description: "Brief description of content",
        },
        overwrite: {
          type: "boolean",
          description: "Overwrite if document already exists",
        },
      },
      required: ["content", "title", "source", "tags"],
    },
  },
  
  library_query: {
    description: "Query the library index for documents",
    parameters: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags",
        },
        language: {
          type: "string",
          description: "Filter by language",
        },
        version: {
          type: "string",
          description: "Filter by version",
        },
        query: {
          type: "string",
          description: "Full-text search query",
        },
        limit: {
          type: "number",
          description: "Maximum results to return",
        },
        sortBy: {
          type: "string",
          enum: ["relevance", "createdAt", "updatedAt", "title"],
          description: "Sort order",
        },
      },
      required: [],
    },
  },
  
  library_list_tags: {
    description: "List all available tags in the library",
    parameters: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: "Filter tags by language",
        },
      },
      required: [],
    },
  },
  
  library_sync: {
    description: "Sync library index with file system (rebuild index)",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to library folder (default: ./library)",
        },
      },
      required: [],
    },
  },
  
  library_stats: {
    description: "Get statistics about the library",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};