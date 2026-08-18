/** Compatibility export surface for skills-usage consumers. */
export {
  incrementSkillUsage,
  readSkillsUsageLedger,
  skillsUsagePaths,
  type SkillsUsageLedger,
  type SkillsUsageLedgerPath,
  type SkillUsageEntry,
} from "./skills-usage-ledger"
export { extractSkillId, SkillsUsageTracker } from "./skills-usage-tracker"
export {
  registerSkillsUsage,
  type SkillsUsageOptions,
} from "./skills-usage-wiring"
