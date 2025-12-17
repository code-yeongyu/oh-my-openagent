#!/usr/bin/env npx ts-node
/**
 * Changelog Generation Script
 *
 * Generates a changelog from git commits following conventional commits format.
 * Groups commits by type and links to Linear issues.
 *
 * Usage:
 *   npx ts-node generate-changelog.ts [options]
 *
 * Options:
 *   --from <tag>      Start from this tag (default: last tag)
 *   --to <ref>        End at this ref (default: HEAD)
 *   --output <file>   Output file (default: CHANGELOG.md)
 *   --format <type>   Output format: markdown, json (default: markdown)
 *   --linear-url <url> Linear base URL for issue links
 */

import { execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync } from "fs";

interface Commit {
  hash: string;
  type: string;
  scope: string | null;
  subject: string;
  body: string;
  linearId: string | null;
  date: string;
  author: string;
}

interface ChangelogSection {
  title: string;
  emoji: string;
  commits: Commit[];
}

interface ChangelogConfig {
  from?: string;
  to: string;
  output: string;
  format: "markdown" | "json";
  linearUrl: string;
}

const TYPE_CONFIG: Record<string, { title: string; emoji: string }> = {
  feat: { title: "Features", emoji: "✨" },
  fix: { title: "Bug Fixes", emoji: "🐛" },
  docs: { title: "Documentation", emoji: "📚" },
  style: { title: "Styles", emoji: "💄" },
  refactor: { title: "Code Refactoring", emoji: "♻️" },
  perf: { title: "Performance Improvements", emoji: "⚡" },
  test: { title: "Tests", emoji: "✅" },
  build: { title: "Build System", emoji: "📦" },
  ci: { title: "CI/CD", emoji: "👷" },
  chore: { title: "Chores", emoji: "🔧" },
  revert: { title: "Reverts", emoji: "⏪" },
};

function parseArgs(): ChangelogConfig {
  const args = process.argv.slice(2);
  const config: ChangelogConfig = {
    to: "HEAD",
    output: "CHANGELOG.md",
    format: "markdown",
    linearUrl: "https://linear.app/team/issue",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--from":
        config.from = args[++i];
        break;
      case "--to":
        config.to = args[++i];
        break;
      case "--output":
        config.output = args[++i];
        break;
      case "--format":
        config.format = args[++i] as "markdown" | "json";
        break;
      case "--linear-url":
        config.linearUrl = args[++i];
        break;
    }
  }

  return config;
}

function getLastTag(): string | null {
  try {
    return execSync("git describe --tags --abbrev=0 2>/dev/null", {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

function getCommits(from: string | null, to: string): Commit[] {
  const range = from ? `${from}..${to}` : to;
  const format = "%H|%s|%b|%ad|%an";

  try {
    const output = execSync(
      `git log ${range} --pretty=format:"${format}" --date=short`,
      { encoding: "utf-8" }
    );

    if (!output.trim()) {
      return [];
    }

    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => parseCommit(line))
      .filter((commit): commit is Commit => commit !== null);
  } catch (error) {
    console.error("Error getting commits:", error);
    return [];
  }
}

function parseCommit(line: string): Commit | null {
  const parts = line.split("|");
  if (parts.length < 5) return null;

  const [hash, subject, body, date, author] = parts;

  // Parse conventional commit format: type(scope): description [LINEAR-ID]
  const conventionalRegex =
    /^(\w+)(?:\(([^)]+)\))?: (.+?)(?: \[([A-Z]+-\d+)\])?$/;
  const match = subject.match(conventionalRegex);

  if (!match) {
    // Non-conventional commit, skip or categorize as "other"
    return null;
  }

  const [, type, scope, description, linearId] = match;

  return {
    hash: hash.substring(0, 7),
    type,
    scope: scope || null,
    subject: description,
    body: body || "",
    linearId: linearId || null,
    date,
    author,
  };
}

function groupCommitsByType(commits: Commit[]): Map<string, Commit[]> {
  const groups = new Map<string, Commit[]>();

  for (const commit of commits) {
    const existing = groups.get(commit.type) || [];
    existing.push(commit);
    groups.set(commit.type, existing);
  }

  return groups;
}

function generateMarkdown(
  commits: Commit[],
  config: ChangelogConfig,
  version?: string
): string {
  const groups = groupCommitsByType(commits);
  const date = new Date().toISOString().split("T")[0];
  const versionHeader = version || "Unreleased";

  let markdown = `## [${versionHeader}] - ${date}\n\n`;

  // Sort types by priority
  const typeOrder = [
    "feat",
    "fix",
    "perf",
    "refactor",
    "docs",
    "style",
    "test",
    "build",
    "ci",
    "chore",
    "revert",
  ];

  for (const type of typeOrder) {
    const typeCommits = groups.get(type);
    if (!typeCommits || typeCommits.length === 0) continue;

    const typeConfig = TYPE_CONFIG[type] || { title: type, emoji: "📝" };
    markdown += `### ${typeConfig.emoji} ${typeConfig.title}\n\n`;

    for (const commit of typeCommits) {
      const scope = commit.scope ? `**${commit.scope}**: ` : "";
      const linearLink = commit.linearId
        ? ` ([${commit.linearId}](${config.linearUrl}/${commit.linearId}))`
        : "";
      markdown += `- ${scope}${commit.subject}${linearLink}\n`;
    }

    markdown += "\n";
  }

  return markdown;
}

function generateJson(commits: Commit[], config: ChangelogConfig): string {
  const groups = groupCommitsByType(commits);
  const sections: ChangelogSection[] = [];

  for (const [type, typeCommits] of groups) {
    const typeConfig = TYPE_CONFIG[type] || { title: type, emoji: "📝" };
    sections.push({
      title: typeConfig.title,
      emoji: typeConfig.emoji,
      commits: typeCommits,
    });
  }

  return JSON.stringify(
    {
      date: new Date().toISOString(),
      sections,
      config,
    },
    null,
    2
  );
}

function prependToChangelog(content: string, outputPath: string): void {
  let existingContent = "";

  if (existsSync(outputPath)) {
    existingContent = readFileSync(outputPath, "utf-8");

    // Remove existing "Unreleased" section if present
    existingContent = existingContent.replace(
      /## \[Unreleased\][\s\S]*?(?=## \[|$)/,
      ""
    );
  }

  const header = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

  // Check if header already exists
  if (existingContent.includes("# Changelog")) {
    existingContent = existingContent.replace(/# Changelog[\s\S]*?\n\n/, "");
  }

  writeFileSync(outputPath, header + content + existingContent);
}

async function main(): Promise<void> {
  const config = parseArgs();

  // Get the starting point
  const from = config.from || getLastTag();

  console.log(`Generating changelog from ${from || "beginning"} to ${config.to}`);

  // Get commits
  const commits = getCommits(from, config.to);

  if (commits.length === 0) {
    console.log("No conventional commits found in range");
    return;
  }

  console.log(`Found ${commits.length} conventional commits`);

  // Generate output
  let output: string;
  if (config.format === "json") {
    output = generateJson(commits, config);
    writeFileSync(config.output, output);
  } else {
    output = generateMarkdown(commits, config);
    prependToChangelog(output, config.output);
  }

  console.log(`Changelog written to ${config.output}`);

  // Print summary
  const groups = groupCommitsByType(commits);
  console.log("\nSummary:");
  for (const [type, typeCommits] of groups) {
    const typeConfig = TYPE_CONFIG[type] || { title: type, emoji: "📝" };
    console.log(`  ${typeConfig.emoji} ${typeConfig.title}: ${typeCommits.length}`);
  }
}

main().catch(console.error);

