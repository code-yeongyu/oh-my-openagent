import { GraphGlyph } from "./graph-glyph"
import { omoLogo } from "./omo-logo"
import { ogPalette } from "./palette"
import { OgTagline } from "./tagline"
import type { FormattedStatsData } from "@/lib/stats"

const { ink0, textHi, textMid, textLo, textFaint, line, accent } = ogPalette
const rule = {
  position: "absolute",
  left: 28,
  right: 28,
  height: 1,
  backgroundColor: line,
  display: "flex",
} as const

export function SocialImage({ stats }: { readonly stats: FormattedStatsData }) {
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: "100%",
        height: "100%",
        backgroundColor: ink0,
        backgroundImage:
          "radial-gradient(circle at 82% 42%, rgba(0,212,255,0.14), rgba(0,212,255,0) 46%)",
        color: textHi,
        fontFamily: "Geist",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 28,
          right: 28,
          bottom: 28,
          border: `1px solid ${line}`,
          display: "flex",
        }}
      />
      <div style={{ ...rule, top: 148 }} />
      <div style={{ ...rule, bottom: 116 }} />

      <div
        style={{
          position: "absolute",
          top: 52,
          left: 72,
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- satori renders raw img, next/image does not exist here */}
        <img
          src={"data:image/svg+xml;utf8," + encodeURIComponent(omoLogo)}
          width={72}
          height={72}
          alt=""
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              fontWeight: 500,
              fontSize: 46,
              letterSpacing: -0.6,
              color: textHi,
            }}
          >
            OmO
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Geist Mono",
              fontSize: 18,
              letterSpacing: 3.2,
              color: textLo,
            }}
          >
            YOUR TOOL FOR REAL WORK · BUT IT'S AN AGENT
          </div>
        </div>
      </div>

      <div style={{ position: "absolute", top: 196, left: 72, display: "flex" }}>
        <OgTagline text={stats.description} />
      </div>

      <div style={{ position: "absolute", top: 150, right: 60, display: "flex" }}>
        <GraphGlyph />
      </div>
      <div
        style={{
          position: "absolute",
          top: 176,
          right: 44,
          display: "flex",
          flexDirection: "column",
          gap: 116,
          fontFamily: "Geist Mono",
          fontSize: 14,
          letterSpacing: 2,
          color: textFaint,
        }}
      >
        <div style={{ display: "flex" }}>01</div>
        <div style={{ display: "flex" }}>02</div>
        <div style={{ display: "flex" }}>03</div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          bottom: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "Geist Mono",
          fontSize: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              color: accent,
              fontSize: 48,
              fontWeight: 500,
            }}
          >
            <svg width="38" height="38" viewBox="0 0 24 24" fill={accent} aria-hidden="true">
              <path d="m12 1 3.4 6.9 7.6 1.1-5.5 5.4 1.3 7.6-6.8-3.6L5.2 22l1.3-7.6L1 9l7.6-1.1Z" />
            </svg>
            {stats.stars} stars
          </div>
          <div style={{ display: "flex", color: textLo, fontSize: 24 }}>
            {stats.totalDownloads} downloads
          </div>
        </div>
        <div style={{ display: "flex", color: textMid }}>omo.dev</div>
      </div>
    </div>
  )
}

export function MinimalSocialImage({ stats }: { readonly stats: FormattedStatsData }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: 72,
        backgroundColor: ink0,
        color: textHi,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 64, fontWeight: 700 }}>OmO</div>
      <div style={{ display: "flex", fontSize: 48, lineHeight: 1.2 }}>{stats.description}</div>
      <div style={{ display: "flex", fontSize: 54, color: accent, fontWeight: 600 }}>
        {stats.stars} stars · omo.dev
      </div>
    </div>
  )
}
