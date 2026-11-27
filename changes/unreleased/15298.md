### Added

- The omo SDK's `config` namespace can now explain model routing and engine settings and check routing edits before you make them, without ever showing a config file's secrets, free text or paths.
  - `config.explain({ path })` shows the value and scope (user, project or global) of a category's or agent's `model`, `models`, `fallback_models`, `variant` or `reasoning`, or of a typed engine compaction or retry setting (`engine:` prefix). Any other key answers `path_not_allowed`; a value that looks like a credential answers `value_withheld`.
  - `config.check({ edits? })` lists policy findings for the current files, or for the files as the edits would leave them, without writing anything.
  - `config.modelSwaps({ session? })` lists a session's fallback model swaps, whether a fallback window is still open, and turns per model.
  - `config.status()` also reports each builtin category's and agent's model chain and the engine's compaction and retry settings.
