import type { OhMyOpenCodeConfig } from "../config";
import type { FallbackModelObject } from "../config/schema/fallback-models";
export declare function getModelProvider(model: string): string | undefined;
export declare function isProviderDisabled(model: string | undefined, disabled: readonly string[]): boolean;
export declare function filterDisabledProviderModels<T extends string | FallbackModelObject>(models: readonly T[], disabled: readonly string[]): T[];
/**
 * Filters `disabled_providers`-listed entries out of every agent/category
 * fallback chain and substitutes any primary `model` referencing a disabled
 * provider with the first allowed entry from the same chain.
 *
 * Returns the same config reference (mutated in place). Safe to call when
 * `disabled_providers` is unset or empty - it becomes a no-op.
 */
export declare function applyDisabledProviders(config: OhMyOpenCodeConfig): OhMyOpenCodeConfig;
