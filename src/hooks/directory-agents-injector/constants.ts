import { join } from "node:path";
import { xdgData } from "xdg-basedir";

export const OPENCODE_STORAGE = join(xdgData ?? "", "opencode", "storage");
export const AGENTS_INJECTOR_STORAGE = join(
  OPENCODE_STORAGE,
  "directory-agents",
);
export const AGENTS_FILENAME = "AGENTS.md";
