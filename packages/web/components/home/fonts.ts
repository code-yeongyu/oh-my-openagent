import localFont from "next/font/local"

/** Timeless Sans (timeless.co/type, Timeless Free Font License 1.3, public/fonts/LICENSE-timeless.txt), Latin-1 subset. */
export const timelessSans = localFont({
  src: "../../app/fonts/TimelessSansVF.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-timeless",
  preload: true,
})

/** JetBrains Mono (OFL, public/fonts/OFL-jetbrains-mono.txt): the inside of terminal panes and nothing else. */
export const jetBrainsMono = localFont({
  src: "../../app/fonts/JetBrainsMonoVF.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-jetbrains",
  // Only terminal panes below the fold use it: no preload competing with the headline face.
  preload: false,
})
