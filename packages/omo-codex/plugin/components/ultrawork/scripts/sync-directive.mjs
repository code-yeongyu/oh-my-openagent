#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const componentRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const codexPromptUrl = new URL(import.meta.resolve("@oh-my-opencode/prompts-core/prompts/ultrawork/codex.md"));
const directivePath = join(componentRoot, "directive.md");
const skillDirectory = join(componentRoot, "skills", "ultrawork");
const skillPath = join(skillDirectory, "SKILL.md");

const skillFrontmatter = `---
name: ultrawork
description: Binding ultrawork mode directive for omo on Codex. When a prompt contains ultrawork or ulw, the omo UserPromptSubmit hook injects a short bootstrap that points at this file. Read the whole file and follow every rule in it for the rest of the task.
metadata:
  short-description: Binding ultrawork mode directive
---

`;

const codexPrompt = await readFile(codexPromptUrl, "utf8");
await writeFile(directivePath, codexPrompt);
await mkdir(skillDirectory, { recursive: true });
await writeFile(skillPath, `${skillFrontmatter}${codexPrompt}`);
