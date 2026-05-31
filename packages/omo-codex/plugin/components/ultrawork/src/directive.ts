import { readFileSync } from "node:fs";

export const ULTRAWORK_DIRECTIVE: string = readFileSync(new URL("../directive.md", import.meta.url), "utf8");
