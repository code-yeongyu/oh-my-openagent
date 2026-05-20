import { setSisyphusRuleDeprecationLogger } from "@oh-my-opencode/rules-core";
import { log } from "../../shared/logger";

setSisyphusRuleDeprecationLogger(log);

export { findRuleFiles } from "@oh-my-opencode/rules-core";
export type { FindRuleFilesOptions } from "@oh-my-opencode/rules-core";
