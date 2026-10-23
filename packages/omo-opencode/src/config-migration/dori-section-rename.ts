import { hasLegacyGatewaySection, migrateLegacyDoriSection } from "@oh-my-opencode/omo-config-core"

import type { DoriSectionRename } from "./migration-plans"

/** The real `gateway` -> `dori` rename for `createLegacyConfigMigrationPlans`. */
export const doriSectionRename: DoriSectionRename = {
  shouldRun: hasLegacyGatewaySection,
  transform: migrateLegacyDoriSection,
}
