import { ImageResponse } from "next/og"

export const alt = "oh-my-openagent — The Best Agent Harness (Twitter)"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`
  const css = await (await fetch(url)).text()
  const match = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)
  if (!match?.[1]) throw new Error(`Font URL not found for ${family} ${weight}`)
  const fontResponse = await fetch(match[1])
  return fontResponse.arrayBuffer()
}

export default async function TwitterImage(): Promise<ImageResponse> {
  const [geistBold, geistRegular, geistMonoMedium] = await Promise.all([
    loadGoogleFont("Geist", 700),
    loadGoogleFont("Geist", 400),
    loadGoogleFont("Geist Mono", 500),
  ])

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#0a0a0a",
        padding: "64px 80px",
        position: "relative",
        fontFamily: "Geist",
      }}
    >
      {/* Dotted grid background: flexbox-only, no grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          display: "flex",
        }}
      />

      {/* Top-left: brand wordmark */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            background: "#00d4ff",
            borderRadius: 2,
            display: "flex",
          }}
        />
        <div
          style={{
            fontFamily: "Geist Mono",
            fontSize: 24,
            fontWeight: 500,
            color: "#00d4ff",
            letterSpacing: "-0.01em",
            display: "flex",
          }}
        >
          oh-my-openagent
        </div>
      </div>

      {/* Center stack: headline + subtitle */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 28,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            fontSize: 88,
            fontWeight: 700,
            color: "#ededed",
            letterSpacing: "-0.04em",
            lineHeight: 1.0,
            display: "flex",
            flexWrap: "wrap",
          }}
        >
          <span style={{ display: "flex" }}>The Best Agent</span>
          <span style={{ display: "flex", color: "#00d4ff", marginLeft: 24 }}>Harness</span>
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 400,
            color: "#a1a1a1",
            lineHeight: 1.4,
            maxWidth: 900,
            display: "flex",
          }}
        >
          Sisyphus orchestrates the team. Type ultrawork. Done.
        </div>
      </div>

      {/* Bottom row: install command + cursor */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 20px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 9999,
            fontFamily: "Geist Mono",
            fontSize: 22,
            color: "#d4d4d8",
          }}
        >
          <span style={{ color: "#00d4ff", display: "flex" }}>$</span>
          <span style={{ display: "flex" }}>bunx oh-my-openagent install</span>
        </div>
        <div
          style={{
            fontFamily: "Geist Mono",
            fontSize: 36,
            color: "#00d4ff",
            display: "flex",
          }}
        >
          ▌
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Geist", data: geistRegular, weight: 400, style: "normal" },
        { name: "Geist", data: geistBold, weight: 700, style: "normal" },
        { name: "Geist Mono", data: geistMonoMedium, weight: 500, style: "normal" },
      ],
    },
  )
}
