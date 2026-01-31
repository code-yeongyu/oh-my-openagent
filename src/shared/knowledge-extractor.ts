import { existsSync, writeFileSync, readFileSync } from "node:fs";

export interface KnowledgeEntry {
  id: string;
  pattern: string;
  solution: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Issue {
  description: string;
  fix: string;
  context: string;
}

export class KnowledgeExtractor {
  constructor(private storagePath: string) {}

  async extract(issue: Issue): Promise<KnowledgeEntry> {
    const pattern = issue.description.toLowerCase();
    const solution = issue.fix;
    
    return {
      id: crypto.randomUUID(),
      pattern,
      solution,
      timestamp: Date.now()
    };
  }

  async extractAndSave(issue: Issue): Promise<void> {
    const entry = await this.extract(issue);
    const knowledge = this.load();
    knowledge.push(entry);
    this.save(knowledge);
  }

  async compress(limit: number): Promise<void> {
    const knowledge = this.load();
    if (knowledge.length <= limit) return;
    
    // Keep the latest entries based on timestamp
    const compressed = knowledge
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-limit);
      
    this.save(compressed);
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    const now = Date.now();
    const knowledge = this.load();
    const filtered = knowledge.filter(entry => (now - entry.timestamp) <= maxAgeMs);
    this.save(filtered);
  }

  private load(): KnowledgeEntry[] {
    if (!existsSync(this.storagePath)) {
      return [];
    }
    try {
      const content = readFileSync(this.storagePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private save(knowledge: KnowledgeEntry[]): void {
    writeFileSync(this.storagePath, JSON.stringify(knowledge, null, 2));
  }
}
