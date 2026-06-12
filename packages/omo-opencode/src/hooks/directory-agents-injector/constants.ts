import { join } from "node:path";
import { OPENCODE_STORAGE } from "../../shared";
export const AGENTS_INJECTOR_STORAGE = join(
  OPENCODE_STORAGE,
  "directory-agents",
);
export const AGENTS_FILENAME = "AGENTS.md";
