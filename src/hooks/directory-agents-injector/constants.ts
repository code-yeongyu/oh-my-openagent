import { join } from "node:path";
import { getOpenCodeStorageDir } from "../../shared/data-path";

export const OPENCODE_STORAGE = getOpenCodeStorageDir();
export const AGENTS_INJECTOR_STORAGE = join(
  OPENCODE_STORAGE,
  "directory-agents",
);
export const AGENTS_FILENAME = "AGENTS.md";
