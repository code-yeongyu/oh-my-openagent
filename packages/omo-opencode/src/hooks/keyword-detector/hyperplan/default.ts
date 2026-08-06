import { HYPERPLAN_MODE_PROMPT } from "@oh-my-opencode/prompts-core"

/**
 * Hyperplan keyword detector.
 *
 * Triggers when the user wants adversarial multi-agent planning via team-mode.
 *
 * Triggers (case-insensitive, word-bounded):
 * - English: hyperplan, hpp
 *
 * The detector injects a thin wrapper that loads the `hyperplan` skill, which
 * carries the full orchestration instructions for the 5-member adversarial team.
 *
 * The `hpp` shorthand uses an extra negative-lookbehind so that the very common
 * C++ header-file extension `.hpp` (e.g. `interface.hpp`, `src/buffer.hpp`)
 * does NOT falsely trigger hyperplan mode. A leading `.` would otherwise
 * satisfy `\b` because the dot is a non-word character. See issue #4215.
 */

export const HYPERPLAN_PATTERN = /\bhyperplan\b|(?<![\w.])hpp\b/i

export const HYPERPLAN_MESSAGE = HYPERPLAN_MODE_PROMPT
