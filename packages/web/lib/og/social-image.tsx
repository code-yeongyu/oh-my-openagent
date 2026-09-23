import { omoCat, omoWordmark } from "./artwork"
import { ogBrand } from "./palette"
import { formatOgStars } from "./stars"

export function SocialImage({ count }: { readonly count: number | null }) {
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: "100%",
        height: "100%",
        backgroundColor: ogBrand.paper,
        color: ogBrand.ink,
        fontFamily: ogBrand.font,
      }}
    >
      {/* Original vector artwork, not flattened copy: Satori requires raw img elements. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- next/image cannot render inside ImageResponse */}
      <img
        src={"data:image/svg+xml;utf8," + encodeURIComponent(omoCat)}
        alt=""
        width={282}
        height={(282 * 289.943603515625) / 325.0923156738281}
        style={{ position: "absolute", left: 162, top: 196 }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- original designed-vector wordmark */}
      <img
        src={"data:image/svg+xml;utf8," + encodeURIComponent(omoWordmark)}
        alt="OmO"
        width={390}
        height={(390 * 156) / 499}
        style={{ position: "absolute", left: 494, top: 204 }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          left: 494,
          top: 349,
          fontSize: 36,
          lineHeight: "46px",
          letterSpacing: 0,
          whiteSpace: "nowrap",
        }}
      >
        <div style={{ display: "flex", fontWeight: 400 }}>Your tool for real work.</div>
        <div style={{ display: "flex", fontWeight: 700 }}>But it&apos;s an agent.</div>
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 48,
          bottom: 42,
          alignItems: "center",
          gap: 16,
          fontSize: 36,
          fontWeight: 400,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill={ogBrand.ink} aria-hidden="true">
          <path d="M12 .297a12 12 0 0 0-3.793 23.384c.6.111.82-.261.82-.577v-2.234c-3.338.726-4.043-1.416-4.043-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.071 1.835 2.809 1.305 3.495.998.108-.776.419-1.305.762-1.605-2.665-.304-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.323 3.301 1.23A11.52 11.52 0 0 1 12 6.097c1.02.005 2.047.138 3.006.404 2.291-1.553 3.297-1.23 3.297-1.23.655 1.652.243 2.873.12 3.176.769.84 1.235 1.91 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.216.694.825.576A12 12 0 0 0 12 .297Z" />
        </svg>
        {formatOgStars(count)}
      </div>
    </div>
  )
}
