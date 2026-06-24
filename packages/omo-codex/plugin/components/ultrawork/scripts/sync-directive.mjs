#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const componentRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const codexPromptUrl = new URL(import.meta.resolve("@oh-my-opencode/prompts-core/prompts/ultrawork/codex.md"));
const directivePath = join(componentRoot, "directive.md");

const codexPrompt = await readFile(codexPromptUrl, "utf8");
await writeFile(directivePath, codexPrompt);
