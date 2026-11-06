export const THEME_STORAGE_KEY = "omo-theme"

/** Runs in <head> before first paint: a pinned Light or Dark choice wins over prefers-color-scheme. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}})()`
