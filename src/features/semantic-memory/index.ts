import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface SemanticMemoryOptions {
  baseDir?: string;
  namespace?: string;
}

export interface SetOptions {
  ttl?: number;
}

export interface MemoryEntry {
  key: string;
  value: any;
  expiresAt?: number;
}

export class SemanticMemory {
  private baseDir: string;
  private namespace: string;

  constructor(options: SemanticMemoryOptions = {}) {
    this.baseDir = options.baseDir || ".sisyphus/memory";
    this.namespace = options.namespace || "default";
  }

  private get namespaceDir(): string {
    return join(this.baseDir, this.namespace);
  }

  private getFilePath(key: string): string {
    return join(this.namespaceDir, `${encodeURIComponent(key)}.json`);
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.namespaceDir)) {
      await mkdir(this.namespaceDir, { recursive: true });
    }
  }

  async set(key: string, value: any, options?: SetOptions): Promise<void> {
    await this.ensureDir();
    
    const entry: MemoryEntry = {
      key,
      value,
    };

    if (options?.ttl) {
      entry.expiresAt = Date.now() + options.ttl;
    }

    await writeFile(this.getFilePath(key), JSON.stringify(entry, null, 2));
  }

  async get(key: string): Promise<any> {
    const filePath = this.getFilePath(key);
    
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const entry = JSON.parse(content) as MemoryEntry;

      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        await this.delete(key);
        return null;
      }

      return entry.value;
    } catch (error) {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    if (existsSync(filePath)) {
      await rm(filePath);
    }
  }

  private globToRegex(pattern: string): RegExp {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${regexPattern}$`);
  }

  async search(pattern: string): Promise<{ key: string; value: any }[]> {
    if (!existsSync(this.namespaceDir)) {
      return [];
    }

    const files = await readdir(this.namespaceDir);
    const results: { key: string; value: any }[] = [];
    const regex = this.globToRegex(pattern);

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const encodedKey = file.slice(0, -5);
      const key = decodeURIComponent(encodedKey);

      if (regex.test(key)) {
        const value = await this.get(key);
        if (value !== null) {
          results.push({ key, value });
        }
      }
    }

    return results;
  }
}
