import { REFACTOR_CODEMAP_AND_TESTS } from "./refactor-sections/codemap-and-tests"
import { REFACTOR_INTRO_AND_ANALYSIS } from "./refactor-sections/intro-and-analysis"
import { REFACTOR_PLAN_AND_EXECUTION } from "./refactor-sections/plan-and-execution"
import { REFACTOR_VERIFICATION_AND_TOOLING } from "./refactor-sections/verification-and-tooling"
export { REFACTOR_TEAM_MODE_ADDENDUM } from "./refactor-sections/team-mode-addendum"

export const REFACTOR_TEMPLATE =
  REFACTOR_INTRO_AND_ANALYSIS +
  REFACTOR_CODEMAP_AND_TESTS +
  REFACTOR_PLAN_AND_EXECUTION +
  REFACTOR_VERIFICATION_AND_TOOLING
