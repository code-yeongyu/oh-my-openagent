export const THEME_STORAGE_KEY = "omo-theme"

/**
 * Points every theme-color meta at the pinned theme's colour, or restores each one's own media colour for System.
 * Shared by the pre-paint script below and the theme switch.
 */
export function syncThemeColor(pinned: "light" | "dark" | null): void {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.media.includes("dark") ? "#0f0e0d" : "#fbfaf7"
    meta.content = pinned === null ? own : pinned === "dark" ? "#0f0e0d" : "#fbfaf7"
  }
}

/**
 * Runs in <head> before first paint: marks the document as scripted (so scroll reveals start hidden instead of
 * flashing out after hydration) and applies a pinned Light or Dark choice over prefers-color-scheme.
 */
export const themeInitScript = `(function(){var d=document.documentElement;d.classList.add("js");try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark"){d.dataset.theme=t;document.addEventListener("DOMContentLoaded",function(){(${syncThemeColor.toString()})(t)})}}catch(e){}})()`
