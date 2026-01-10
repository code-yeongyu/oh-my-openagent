import * as fs from "fs";
import * as path from "path";

export interface JournalEntry {
  agentId: string;
  taskId?: string;
  decision: string;
  reasoning?: string;
  timestamp?: string;
}

export class DecisionJournal {
  private logDir: string;

  constructor(config: { logDir: string }) {
    this.logDir = config.logDir;
  }

  async log(entry: JournalEntry): Promise<void> {
    if (!fs.existsSync(this.logDir)) {
      await fs.promises.mkdir(this.logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const filename = `decision-${timestamp.replace(/[:.]/g, "-")}-${Math.random().toString(36).substring(7)}.json`;
    const filePath = path.join(this.logDir, filename);

    const fileContent = {
      ...entry,
      timestamp,
    };

    await fs.promises.writeFile(filePath, JSON.stringify(fileContent, null, 2));
  }
}
