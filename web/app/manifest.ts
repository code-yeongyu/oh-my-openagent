import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Oh My OpenAgent",
    short_name: "OMO",
    description:
      "The Best Agent Harness. Meet Sisyphus: The batteries-included agent that codes like you.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#00d4ff",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  }
}
