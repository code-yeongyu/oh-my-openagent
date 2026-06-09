import { setSisyphusRuleDeprecationLogger } from "@oh-my-opencode/rules-engine";
import { log } from "../../shared/logger";

setSisyphusRuleDeprecationLogger(log);

export { findRuleFiles } from "@oh-my-opencode/rules-engine";
export type { FindRuleFilesOptions } from "@oh-my-opencode/rules-engine";
