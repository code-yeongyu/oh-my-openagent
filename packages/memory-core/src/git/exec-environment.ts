// A memory repository's git must run against that repository and its own config, whatever the process
// that hosts the engine exported. An inherited GIT_CONFIG_COUNT/KEY_n/VALUE_n or GIT_CONFIG_PARAMETERS
// outranks the repository's config: `core.hooksPath=/dev/null` there made every memory commit skip the
// installed pre-commit, commit-msg and post-commit hooks (no validation, no mirror push) without an error
// (omo #12354). GIT_DIR, GIT_WORK_TREE and the rest point git at another repository altogether.
//
// The names are git's own repository-local list (`git rev-parse --local-env-vars`), which git itself clears
// when it moves into another repository, plus the numbered config pairs GIT_CONFIG_COUNT selects and GIT_NAMESPACE,
// which would move every ref the memory repository reads or writes.
// GIT_INDEX_FILE is the one exception: memory-core callers set it on purpose for a temporary index.
// File selection (GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM) is kept, so the user's credentials and identity still apply.
const REPOSITORY_LOCAL_GIT_ENV = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
])
const NUMBERED_CONFIG_PAIR = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/

/** The environment a memory repository's git runs with: `environment` minus inherited repository and config redirection. */
export function memoryGitEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(environment)) {
    // Windows environment names are case-insensitive, so `Git_Dir` reaches git as GIT_DIR there.
    const upper = name.toUpperCase()
    if (REPOSITORY_LOCAL_GIT_ENV.has(upper) || NUMBERED_CONFIG_PAIR.test(upper)) continue
    kept[name] = value
  }
  return kept
}
