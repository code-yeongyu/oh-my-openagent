import * as fs from "fs";
import * as path from "path";
import type {
  Ledger,
  LedgerConfig,
  LedgerState,
  LedgerMetadata,
} from "./types";
import { DEFAULT_LEDGER_CONFIG } from "./types";

export class LedgerManager {
  private config: LedgerConfig;
  private projectDir: string;

  constructor(projectDir: string, config: Partial<LedgerConfig> = {}) {
    this.projectDir = projectDir;
    this.config = { ...DEFAULT_LEDGER_CONFIG, ...config };
  }

  private get ledgerDir(): string {
    return path.join(this.projectDir, this.config.ledgerDir);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.ledgerDir)) {
      fs.mkdirSync(this.ledgerDir, { recursive: true });
    }
  }

  findLatestLedger(): Ledger | null {
    if (!fs.existsSync(this.ledgerDir)) {
      return null;
    }

    const files = fs
      .readdirSync(this.ledgerDir)
      .filter((f) => f.startsWith("CONTINUITY_CLAUDE-") && f.endsWith(".md"))
      .sort((a, b) => {
        const statA = fs.statSync(path.join(this.ledgerDir, a));
        const statB = fs.statSync(path.join(this.ledgerDir, b));
        return statB.mtime.getTime() - statA.mtime.getTime();
      });

    if (files.length === 0) {
      return null;
    }

    return this.loadLedger(files[0]);
  }

  loadLedger(filename: string): Ledger | null {
    const filePath = path.join(this.ledgerDir, filename);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    return this.parseLedger(content, filePath, filename);
  }

  private parseLedger(
    content: string,
    filePath: string,
    filename: string,
  ): Ledger {
    const sessionName = filename
      .replace("CONTINUITY_CLAUDE-", "")
      .replace(".md", "");
    const stats = fs.statSync(filePath);

    const goalMatch = content.match(/## Goal\n([\s\S]*?)(?=\n## |$)/);
    const constraintsMatch = content.match(
      /## Constraints\n([\s\S]*?)(?=\n## |$)/,
    );
    const decisionsMatch = content.match(
      /## Key Decisions\n([\s\S]*?)(?=\n## |$)/,
    );
    const stateMatch = content.match(/## State\n([\s\S]*?)(?=\n## |$)/);
    const questionsMatch = content.match(
      /## Open Questions\n([\s\S]*?)(?=\n## |$)/,
    );
    const workingSetMatch = content.match(
      /## Working Set\n([\s\S]*?)(?=\n## |$)/,
    );

    const state = this.parseState(stateMatch?.[1] || "");
    const workingSet = this.parseWorkingSet(workingSetMatch?.[1] || "");

    return {
      metadata: {
        sessionName,
        updatedAt: stats.mtime.toISOString(),
        createdAt: stats.birthtime.toISOString(),
        filePath,
      },
      goal: goalMatch?.[1]?.trim() || "",
      constraints: this.parseList(constraintsMatch?.[1] || ""),
      keyDecisions: this.parseDecisions(decisionsMatch?.[1] || ""),
      state,
      openQuestions: this.parseList(questionsMatch?.[1] || ""),
      workingSet,
      agentReports: [],
      rawContent: content,
    };
  }

  private parseState(content: string): LedgerState {
    const doneMatch = content.match(/- Done: ([^\n]+)/);
    const nowMatch = content.match(/- Now: ([^\n]+)/);
    const nextMatch = content.match(/- Next: ([^\n]+)/);

    return {
      done: doneMatch
        ? doneMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      now: nowMatch?.[1]?.trim() || "",
      next: nextMatch
        ? nextMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    };
  }

  private parseWorkingSet(content: string): Ledger["workingSet"] {
    const branchMatch = content.match(/- Branch: `([^`]+)`/);
    const filesMatch = content.match(/- Key files: ([^\n]+)/);
    const testMatch = content.match(/- Test cmd: `([^`]+)`/);
    const buildMatch = content.match(/- Build cmd: `([^`]+)`/);

    return {
      branch: branchMatch?.[1],
      keyFiles: filesMatch
        ? filesMatch[1].split(",").map((s) => s.trim().replace(/`/g, ""))
        : [],
      testCmd: testMatch?.[1],
      buildCmd: buildMatch?.[1],
    };
  }

  private parseList(content: string): string[] {
    return content
      .split("\n")
      .filter((line) => line.trim().startsWith("-"))
      .map((line) => line.replace(/^-\s*/, "").trim())
      .filter(Boolean);
  }

  private parseDecisions(content: string): Ledger["keyDecisions"] {
    const decisions: Ledger["keyDecisions"] = [];
    const lines = content.split("\n").filter((l) => l.trim().startsWith("-"));

    for (const line of lines) {
      const match = line.match(/^-\s*(.+?):\s*(.+)$/);
      if (match) {
        decisions.push({
          decision: match[1].trim(),
          rationale: match[2].trim(),
        });
      }
    }

    return decisions;
  }

  createLedger(sessionName: string, initialData: Partial<Ledger> = {}): Ledger {
    this.ensureDir();

    const filename = `CONTINUITY_CLAUDE-${sessionName}.md`;
    const filePath = path.join(this.ledgerDir, filename);
    const now = new Date().toISOString();

    const ledger: Ledger = {
      metadata: {
        sessionName,
        updatedAt: now,
        createdAt: now,
        filePath,
      },
      goal: initialData.goal || "",
      constraints: initialData.constraints || [],
      keyDecisions: initialData.keyDecisions || [],
      state: initialData.state || { done: [], now: "", next: [] },
      openQuestions: initialData.openQuestions || [],
      workingSet: initialData.workingSet || { keyFiles: [] },
      agentReports: [],
    };

    this.saveLedger(ledger);
    return ledger;
  }

  saveLedger(ledger: Ledger): void {
    this.ensureDir();
    const content = this.serializeLedger(ledger);
    fs.writeFileSync(ledger.metadata.filePath, content, "utf-8");
  }

  private serializeLedger(ledger: Ledger): string {
    const lines: string[] = [
      `# Session: ${ledger.metadata.sessionName}`,
      `Updated: ${new Date().toISOString()}`,
      "",
      "## Goal",
      ledger.goal || "<Success criteria>",
      "",
      "## Constraints",
      ...(ledger.constraints.length > 0
        ? ledger.constraints.map((c) => `- ${c}`)
        : ["<Tech requirements, patterns to follow>"]),
      "",
      "## Key Decisions",
      ...(ledger.keyDecisions.length > 0
        ? ledger.keyDecisions.map((d) => `- ${d.decision}: ${d.rationale}`)
        : ["<Choices made with rationale>"]),
      "",
      "## State",
      `- Done: ${ledger.state.done.join(", ") || "<completed items>"}`,
      `- Now: ${ledger.state.now || "<current focus>"}`,
      `- Next: ${ledger.state.next.join(", ") || "<queued items>"}`,
      "",
      "## Open Questions",
      ...(ledger.openQuestions.length > 0
        ? ledger.openQuestions.map((q) => {
            const cleanQ = q.replace(/^UNCONFIRMED:\s*/i, "");
            return `- UNCONFIRMED: ${cleanQ}`;
          })
        : ["- UNCONFIRMED: <things needing verification>"]),
      "",
      "## Working Set",
      ledger.workingSet.branch
        ? `- Branch: \`${ledger.workingSet.branch}\``
        : "- Branch: `<branch-name>`",
      `- Key files: ${ledger.workingSet.keyFiles.length > 0 ? ledger.workingSet.keyFiles.map((f) => `\`${f}\``).join(", ") : "<active files>"}`,
      ledger.workingSet.testCmd
        ? `- Test cmd: \`${ledger.workingSet.testCmd}\``
        : "",
      ledger.workingSet.buildCmd
        ? `- Build cmd: \`${ledger.workingSet.buildCmd}\``
        : "",
    ].filter((line) => line !== undefined);

    if (ledger.agentReports.length > 0) {
      lines.push("", "## Agent Reports");
      const reportsToKeep = ledger.agentReports.slice(
        -this.config.maxAgentReports,
      );
      for (const report of reportsToKeep) {
        lines.push(
          `### ${report.agent} (${report.timestamp})`,
          report.summary,
          "",
        );
      }
    }

    return lines.join("\n");
  }

  updateState(ledger: Ledger, updates: Partial<LedgerState>): Ledger {
    const updated = {
      ...ledger,
      state: { ...ledger.state, ...updates },
      metadata: {
        ...ledger.metadata,
        updatedAt: new Date().toISOString(),
      },
    };
    this.saveLedger(updated);
    return updated;
  }

  addAgentReport(ledger: Ledger, agent: string, summary: string): Ledger {
    const updated = {
      ...ledger,
      agentReports: [
        ...ledger.agentReports,
        {
          timestamp: new Date().toISOString(),
          agent,
          summary,
        },
      ].slice(-this.config.maxAgentReports),
      metadata: {
        ...ledger.metadata,
        updatedAt: new Date().toISOString(),
      },
    };
    this.saveLedger(updated);
    return updated;
  }

  pruneLedger(ledger: Ledger): Ledger {
    let content = ledger.rawContent || "";
    const originalLength = content.length;

    content = content.replace(
      /\n### Session Ended \([^)]+\)\n- Reason: \w+\n/g,
      "",
    );

    const agentReportsMatch = content.match(
      /## Agent Reports\n([\s\S]*?)(?=\n## |$)/,
    );
    if (agentReportsMatch) {
      const reports = agentReportsMatch[0].match(
        /### [^\n]+ \(\d{4}-\d{2}-\d{2}[^)]*\)[\s\S]*?(?=\n### |\n## |$)/g,
      );
      if (reports && reports.length > this.config.maxAgentReports) {
        const keptReports = reports.slice(-this.config.maxAgentReports);
        const newSection = "## Agent Reports\n" + keptReports.join("");
        content = content.replace(agentReportsMatch[0], newSection);
      }
    }

    if (content.length !== originalLength) {
      const filePath = ledger.metadata.filePath;
      fs.writeFileSync(filePath, content, "utf-8");
      return this.parseLedger(content, filePath, path.basename(filePath));
    }

    return ledger;
  }

  generateStatusLine(ledger: Ledger | null, contextPercentage: number): string {
    const tokenDisplay = `${(contextPercentage * 100).toFixed(0)}%`;

    let color: "green" | "yellow" | "red" = "green";
    let warning = "";

    if (contextPercentage >= 0.8) {
      color = "red";
      warning = " [CRITICAL]";
    } else if (contextPercentage >= 0.6) {
      color = "yellow";
      warning = " [WARNING]";
    }

    const focus = ledger?.state.now || "No active ledger";
    const done = ledger?.state.done.slice(-1)[0];

    const continuity = done
      ? `✓ ${done.substring(0, 20)}${done.length > 20 ? ".." : ""} → ${focus.substring(0, 25)}${focus.length > 25 ? ".." : ""}`
      : focus.substring(0, 40);

    return `${tokenDisplay}${warning} | ${continuity}`;
  }
}

export function createLedgerManager(
  projectDir: string,
  config?: Partial<LedgerConfig>,
): LedgerManager {
  return new LedgerManager(projectDir, config);
}
