import { ToolHandler } from "@opencode-ai/sdk";
import { LibraryManager } from "./manager";
import type { LibraryDoc } from "./index";

// Global instance to manage library
let libraryManager: LibraryManager | null = null;

function getLibraryManager(path?: string): LibraryManager {
  if (!libraryManager) {
    libraryManager = new LibraryManager(path);
  }
  return libraryManager;
}

export const library_init: ToolHandler = async ({ args }) => {
  const libraryPath = args.path || "./library";
  const manager = getLibraryManager(libraryPath);
  
  try {
    await manager.init();
    return {
      success: true,
      result: `Library initialized at ${libraryPath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to initialize library",
    };
  }
};

export const library_add_doc: ToolHandler = async ({ args }) => {
  const manager = getLibraryManager();
  
  try {
    const doc = await manager.addDoc(args.content, {
      title: args.title,
      source: args.source,
      tags: args.tags,
      language: args.language,
      version: args.version,
      description: args.description,
      overwrite: args.overwrite,
    });
    
    return {
      success: true,
      result: {
        id: doc.id,
        title: doc.title,
        filePath: doc.filePath,
        message: `Document "${doc.title}" added to library`,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to add document",
    };
  }
};

export const library_query: ToolHandler = async ({ args }) => {
  const manager = getLibraryManager();
  
  try {
    const docs = await manager.query(args);
    
    // Format results
    const results = docs.map(doc => ({
      id: doc.id,
      title: doc.title,
      description: doc.description,
      source: doc.source,
      language: doc.language,
      version: doc.version,
      tags: doc.tags,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      filePath: doc.filePath,
    }));
    
    return {
      success: true,
      result: {
        documents: results,
        count: results.length,
        query: args,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to query library",
    };
  }
};

export const library_list_tags: ToolHandler = async ({ args }) => {
  const manager = getLibraryManager();
  
  try {
    const tags = await manager.listTags(args.language);
    
    return {
      success: true,
      result: {
        tags,
        count: tags.length,
        language: args.language,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to list tags",
    };
  }
};

export const library_sync: ToolHandler = async ({ args }) => {
  const libraryPath = args.path || "./library";
  const manager = getLibraryManager(libraryPath);
  
  try {
    await manager.sync();
    
    const stats = await manager.getStats();
    
    return {
      success: true,
      result: {
        message: `Library synced successfully`,
        stats,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to sync library",
    };
  }
};

export const library_stats: ToolHandler = async ({}) => {
  const manager = getLibraryManager();
  
  try {
    const stats = await manager.getStats();
    
    return {
      success: true,
      result: stats,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get library stats",
    };
  }
};

// Tool exports for the library feature
export const libraryTools = {
  library_init,
  library_add_doc,
  library_query,
  library_list_tags,
  library_sync,
  library_stats,
};