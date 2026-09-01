import type { SgManifestAsset, SgRuntimeArch, SgRuntimePlatform, SgRuntimeSlug } from "./types"

export const SG_PINNED_VERSION = "0.43.0"

export const SG_RELEASE_ASSETS = {
  "darwin-arm64": {
    sha256: "8c847d0a29aa4b3101b3361e0b3ee7fb53c7e497adc9ed1afc9615538cd40782",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-aarch64-apple-darwin.zip",
  },
  "darwin-x64": {
    sha256: "6d703090b106747b2f56086b6ccc7e798fe78bcae70257aa20519b220153555b",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-x86_64-apple-darwin.zip",
  },
  "linux-arm64": {
    sha256: "e706846148493967f3ab8011334817edd86ce5acbec10718b2a7b40799c640ff",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-aarch64-unknown-linux-gnu.zip",
  },
  "linux-x64": {
    sha256: "a26253a9c821d935f7e383e40f0de7c2ca62a4121de1f73a6d81ec32eae631e0",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-x86_64-unknown-linux-gnu.zip",
  },
  "win32-arm64": {
    sha256: "a519fdd90324bf6858fde2d3feb2b862d67b834dc11af8f5b6c2c8143ab6a6c5",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-aarch64-pc-windows-msvc.zip",
  },
  "win32-x64": {
    sha256: "a4febbc8c48671e5729d85e29e4ebe5a051b7250d19545bca18e725ccf40ef61",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-x86_64-pc-windows-msvc.zip",
  },
} as const satisfies Record<SgRuntimeSlug, SgManifestAsset>

export function normalizeRuntimePlatform(platform: NodeJS.Platform = process.platform): SgRuntimePlatform {
  if (platform === "darwin" || platform === "linux" || platform === "win32") return platform
  return "linux"
}

export function normalizeRuntimeArch(arch: string = process.arch): SgRuntimeArch {
  if (arch === "arm64" || arch === "aarch64") return "arm64"
  return "x64"
}

export function runtimeSlug(platform: NodeJS.Platform = process.platform, arch: string = process.arch): SgRuntimeSlug {
  return `${normalizeRuntimePlatform(platform)}-${normalizeRuntimeArch(arch)}`
}

export function sgBinaryName(platform: NodeJS.Platform = process.platform): "sg" | "sg.exe" {
  return normalizeRuntimePlatform(platform) === "win32" ? "sg.exe" : "sg"
}
