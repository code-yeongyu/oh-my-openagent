/**
 * OMO Warm — Claude Code inspired sidebar theme.
 *
 * Warm earthy palette: amber accents, tan text, dark brown backgrounds.
 * Applied at TUI startup via api.theme.set().
 */
export const OMO_WARM_THEME = {
  name: "OMO Warm",
  type: "dark" as const,
  colors: {
    primary: "#D4915D",
    primaryDimmed: "#A0683A",
    secondary: "#9BABC4",
    accent: "#D4915D",
    accentDimmed: "#8B5A3A",

    text: "#D4C5B9",
    textMuted: "#8B7D6B",
    textDimmed: "#5C5247",

    background: "#1A1A1B",
    backgroundPanel: "#222223",
    backgroundSelected: "#2D2520",

    border: "#3A3530",
    borderSubtle: "#2D2A25",
    borderActive: "#D4915D",

    error: "#C56B4A",
    warning: "#C4A56B",
    success: "#8B9B6B",
    info: "#7B8BA5",

    diffAdded: "#2D3A2D",
    diffRemoved: "#3A2525",

    markdownHeading: "#D4915D",
    markdownCodeBackground: "#2A2A2B",

    syntaxKeyword: "#C48B5D",
    syntaxString: "#8B9B6B",
    syntaxComment: "#5C5247",
    syntaxFunction: "#9BABC4",

    thinkingOpacity: 0.5,
  } as Record<string, unknown>,
}
