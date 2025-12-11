import { join } from "node:path";
import { xdgData } from "xdg-basedir";

export const OPENCODE_STORAGE = join(xdgData ?? "", "opencode", "storage");
export const README_INJECTOR_STORAGE = join(
  OPENCODE_STORAGE,
  "directory-readme",
);
export const README_FILENAME = "README.md";
