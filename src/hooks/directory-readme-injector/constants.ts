import { join } from "node:path";
import { getOpenCodeStorageDir } from "../../shared/data-path";

export const OPENCODE_STORAGE = getOpenCodeStorageDir();
export const README_INJECTOR_STORAGE = join(
  OPENCODE_STORAGE,
  "directory-readme",
);
export const README_FILENAME = "README.md";
