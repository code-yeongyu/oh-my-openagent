/**
 * How a literal byte sequence is spelled when it lands in the engine's config.
 *
 * The engine resolves every config value as a template: `$$` is a literal `$`, `$!` a literal
 * `!`, `${NAME}` / `$NAME` an environment lookup, and a value STARTING WITH `!` is run as a
 * shell command. A literal that reaches the config unescaped is therefore not the literal the
 * user wrote: `$TOKEN` becomes whatever the environment holds, and `!cmd` becomes a command.
 *
 * `$$` and `$!` are the engine's own literal escapes, so escaping a `$` as `$$` and a `!` as
 * `$!` makes the engine read back the exact bytes.
 */
export function literalConfigValue(value) {
  return value.replace(/[$!]/g, "$$$&")
}
