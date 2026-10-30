# Installing the compiled `omo` binary

Each GitHub Release of oh-my-openagent attaches per-OS/arch single-file `omo` executables plus a `SHA256SUMS` checksum file. The binary is self-contained: it embeds the senpi engine, the omo plugin payload, and every runtime resource, and provisions them into `~/.omo/binary-runtime/<version>/` on first run. No node, npm, or bun install is required.

## One-line install (recommended)

[Install OmO](install.md) is the full guide: every platform, channels, fixing your `PATH`, updating and uninstalling.

```sh
curl -fsSL https://get.omo.dev/install.sh | bash            # latest
curl -fsSL https://get.omo.dev/install.sh | bash -s -- beta # beta channel, or pass a version such as 5.1.1
```

```powershell
irm https://get.omo.dev/install.ps1 | iex
```

The script picks the asset for your OS, CPU, libc and AVX2 support (Rosetta shells get the Apple Silicon build), verifies it against the release `SHA256SUMS`, and installs it as `~/.local/bin/omo` (`%USERPROFILE%\.local\bin\omo.exe` on Windows). If that directory is not on `PATH` it adds a marked block to your shell profile (or your Windows user `PATH`). It writes a receipt to `~/.omo/install.json` and reports any npm `omo-ai` install it finds without removing it. It refuses to run as root.

Binaries come from the get.omo.dev mirror, a Cloudflare R2 copy of each release behind the CDN. When the mirror does not have a version, or is unreachable, the script downloads the same file from GitHub Releases and verifies it the same way. Settings: `OMO_INSTALL_DIR` (install directory), `OMO_NO_MODIFY_PATH=1` (never edit profiles).

## Manual install (per OS)

Download the asset for your platform with `curl`, make it executable, and run it. Replace `<VERSION>` with the release tag (for example `5.0.0-beta.20`) and `<TARGET>` with your platform from the table below.

```sh
# macOS (Apple Silicon)
curl -Lo omo "https://github.com/code-yeongyu/oh-my-openagent/releases/download/v<VERSION>/omo-darwin-arm64"
chmod +x omo
./omo --version
```

```sh
# macOS (Intel)
curl -Lo omo "https://github.com/code-yeongyu/oh-my-openagent/releases/download/v<VERSION>/omo-darwin-x64"
chmod +x omo
./omo --version
```

```sh
# Linux x64 (glibc)
curl -Lo omo "https://github.com/code-yeongyu/oh-my-openagent/releases/download/v<VERSION>/omo-linux-x64"
chmod +x omo
./omo --version
```

```sh
# Linux ARM64 (glibc)
curl -Lo omo "https://github.com/code-yeongyu/oh-my-openagent/releases/download/v<VERSION>/omo-linux-arm64"
chmod +x omo
./omo --version
```

```sh
# Linux x64 (musl / Alpine)
curl -Lo omo "https://github.com/code-yeongyu/oh-my-openagent/releases/download/v<VERSION>/omo-linux-x64-musl"
chmod +x omo
./omo --version
```

```powershell
# Windows x64 (PowerShell)
curl.exe -Lo omo.exe "https://github.com/code-yeongyu/oh-my-openagent/releases/download/v<VERSION>/omo-windows-x64.exe"
.\omo.exe --version
```

Verify the download against the release checksums:

```sh
curl -LO "https://github.com/code-yeongyu/oh-my-openagent/releases/download/v<VERSION>/SHA256SUMS"
shasum -a 256 -c SHA256SUMS --ignore-missing
```

## Platform targets

| Asset | Platform |
|-------|----------|
| `omo-darwin-arm64` | macOS Apple Silicon |
| `omo-darwin-x64` | macOS Intel |
| `omo-darwin-x64-baseline` | macOS Intel (older CPUs, no AVX2) |
| `omo-linux-x64` | Linux x64 (glibc) |
| `omo-linux-x64-baseline` | Linux x64 (glibc, no AVX2) |
| `linux-arm64` -> `omo-linux-arm64` | Linux ARM64 (glibc) |
| `omo-linux-x64-musl` | Linux x64 (musl / Alpine) |
| `omo-linux-x64-musl-baseline` | Linux x64 (musl, no AVX2) |
| `omo-linux-arm64-musl` | Linux ARM64 (musl / Alpine) |
| `omo-windows-x64.exe` | Windows x64 |
| `omo-windows-x64-baseline.exe` | Windows x64 (older CPUs, no AVX2) |
| `omo-windows-arm64.exe` | Windows ARM64 (true ARM64) |

## macOS: use curl, not a browser download

The binaries are unsigned. A binary downloaded through a web browser carries the `com.apple.quarantine` attribute and macOS Gatekeeper will suspend it on first run. `curl` does not attach that attribute, so installing with the `curl` commands above avoids the quarantine prompt entirely. Do not strip quarantine attributes with `xattr -d` as a workaround - that weakens the same protection on files that genuinely need it.

## First run: self-provisioning

On first run the binary writes its runtime to `~/.omo/binary-runtime/<version>/` (the engine, plugin, native PTY prebuild, themes, and assets) and re-executes from there. Subsequent runs start directly from the provisioned copy. This is normal and happens once per version.

## Updating

Re-run the one-line installer: it replaces the binary when the channel has a newer version and does nothing otherwise. For a manual install, download the new release's asset the same way and replace the binary; the `update` subcommand prints the exact `curl` command for your platform.

## Notes and limits

- **Windows ARM64 is a true ARM64 binary.** This differs from the npm `oh-my-opencode-windows-arm64` package, which ships an x64 binary under emulation. The release asset runs natively on ARM64 Windows.
- **`--inspect` / inspector mode is unsupported** in the compiled binaries; use the npm install for debugging with an inspector.
- **Beta and stable releases both carry these assets.** The compiled binary is the OmO Native edition; on stable releases it is still built from the beta-channel engine, so treat it as a beta-quality native build attached for convenience.
- **glibc floor:** the Linux glibc binaries inherit Bun's own glibc floor; older distributions should use the musl (Alpine) variants.
