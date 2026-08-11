/**
 * Local minimal Theme double replacing the senpi runtime Theme the omo-senpi port imported
 * (`../../senpi-test-runtime`, which reached into @code-yeongyu/senpi's dist). Only the surface
 * the tip renderer and its test touch: `fg(color, text)` returning ANSI-wrapped text so the
 * ANSI-presence assertions keep passing without a harness TUI runtime.
 */
export class Theme {
  constructor(
    readonly foreground: Record<string, string>,
    readonly background: Record<string, string>,
    readonly mode: string,
  ) {}

  fg(_color: string, text: string): string {
    return `\x1b[0m${text}\x1b[0m`
  }
}
