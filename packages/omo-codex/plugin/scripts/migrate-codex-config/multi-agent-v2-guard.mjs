/**
 * Runtime migration for `[features.multi_agent_v2]`.
 *
 * Historical behavior (openai/codex#26753): force `enabled = false` on every
 * SessionStart because enabling V2 made every turn 400 with encrypted
 * spawn_agent parameters on models that were not configured for encrypted
 * tool use. OpenAI closed that as NOT_PLANNED (V2 under development).
 *
 * GPT-5.6 models that declare `multi_agent_version: "v2"` in the Codex model
 * catalog invert that failure mode: forcing `enabled = false` makes every
 * turn 400 with a reserved `collaboration.spawn_agent` schema mismatch
 * (lazycodex#118 / oh-my-openagent#6002 / openai/codex#31097), and
 * stale routing pairs can leave Codex on the wrong spawn-agent tool surface.
 * For those models this guard clears the managed disable and converges the
 * V2 table to the reserved-schema-safe agents namespace pair.
 *
 * When no model is selected in config or visible from SessionStart, install
 * only the inert namespace/metadata compatibility pair. Explicit V1 models
 * keep the #26753 force-disable path.
 *
 * Opt out of the whole migration with LAZYCODEX_CONFIG_MIGRATION_DISABLED=1
 * (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1).
 */

import {
	clearMultiAgentV2DisableForReservedSchema,
	ensureV2CompatibilitySettings,
	forceDisableLegacyEncryptedV2,
	removeFeaturesShorthand,
} from "./multi-agent-v2-config-editor.mjs";
import {
	prefersMultiAgentV2,
	readRootModel,
	readRootModelCatalogPath,
	resolveMultiAgentVersionForModel,
	resolveMultiAgentVersionFromConfig,
} from "./multi-agent-v2-model-resolution.mjs";
import { isTomlLexicallyValid } from "./toml-lexical-lines.mjs";

export {
	prefersMultiAgentV2,
	readRootModel,
	readRootModelCatalogPath,
	resolveMultiAgentVersionForModel,
	resolveMultiAgentVersionFromConfig,
};

/**
 * @param {string} config
 * @param {{
 *   multiAgentVersion?: string | null,
 *   sessionModel?: string | null,
 *   requireSessionModel?: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   modelsCachePath?: string,
 *   configPath?: string,
 * }} [options]
 */
export function forceDisableMultiAgentV2(config, options = {}) {
	if (!isTomlLexicallyValid(config)) return config;
	// Always normalize the legacy `[features]` boolean shorthand first: leaving
	// `multi_agent_v2 = true|false` in place while a later guard appends the
	// `[features.multi_agent_v2]` table would define the same name as both a
	// scalar and a table, which Codex rejects as invalid TOML.
	const normalized = removeFeaturesShorthand(config);
	const sessionModel = normalizeModel(options.sessionModel);
	const multiAgentVersion =
		options.multiAgentVersion !== undefined
			? options.multiAgentVersion
			: resolveMultiAgentVersionFromConfig(normalized, options);
	const effectiveModel = sessionModel || readRootModel(normalized);

	if (prefersMultiAgentV2(multiAgentVersion, effectiveModel)) {
		return clearMultiAgentV2DisableForReservedSchema(normalized);
	}

	// SessionStart can run with an override model (`codex -m gpt-5.6-terra`) while
	// config.toml still lists a different default. If we cannot see the effective
	// session model, do not force-disable — writing enabled=false would break a
	// GPT-5.6 reserved collaboration.spawn_agent session.
	if (options.requireSessionModel === true && !sessionModel) {
		return readRootModel(normalized) === null
			? ensureV2CompatibilitySettings(normalized)
			: normalized;
	}

	// No model evidence at all (no session model AND no root `model` in
	// config.toml — Codex Desktop selects the model in the UI): config alone
	// cannot prove the session is not a GPT-5.6 reserved-schema model, and
	// writing `enabled = false` would 400 every turn on those sessions
	// (#6002). Leave the enable state untouched.
	if (
		multiAgentVersion == null &&
		!sessionModel &&
		!readRootModel(normalized)
	) {
		return ensureV2CompatibilitySettings(normalized);
	}

	// Unknown catalog entry for an explicit session model: skip force-disable
	// rather than assume the legacy encrypted-V2 failure mode.
	if (sessionModel && multiAgentVersion == null) {
		return normalized;
	}

	return forceDisableLegacyEncryptedV2(normalized);
}

function normalizeModel(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
