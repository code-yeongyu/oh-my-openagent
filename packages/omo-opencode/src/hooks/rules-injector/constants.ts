import { join } from "node:path";
import { OPENCODE_STORAGE } from "../../shared";
export const RULES_INJECTOR_STORAGE = join(OPENCODE_STORAGE, "rules-injector");

export {
  GITHUB_INSTRUCTIONS_PATTERN,
  OPENCODE_USER_RULE_DIRS,
  PROJECT_MARKERS,
  PROJECT_RULE_FILES,
  PROJECT_RULE_SUBDIRS,
  RULE_EXTENSIONS,
  USER_RULE_DIR,
} from "@oh-my-opencode/rules-engine";
