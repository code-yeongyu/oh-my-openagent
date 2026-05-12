import { join } from "node:path";
import { OPENCODE_STORAGE } from "../../shared/opencode-storage-paths";
export const README_INJECTOR_STORAGE = join(
  OPENCODE_STORAGE,
  "directory-readme",
);
export const README_FILENAME = "README.md";
