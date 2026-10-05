# Install OmO

One command installs the native `omo` binary for your OS and CPU. You don't need Node.js, npm or Bun.

<!-- install-tabs:start -->

**macOS, Linux, WSL**

```bash
curl -fsSL https://get.omo.dev/install.sh | bash
```

**Windows PowerShell**

```powershell
irm https://get.omo.dev/install.ps1 | iex
```

**Windows CMD**

```bat
powershell -ExecutionPolicy Bypass -c "irm https://get.omo.dev/install.ps1 | iex"
```

<!-- install-tabs:end -->

The script picks the build for your OS, CPU and C library, checks it against the release `SHA256SUMS`, and installs it at `~/.local/bin/omo` (`%USERPROFILE%\.local\bin\omo.exe` on Windows). On WSL, run the macOS/Linux command inside your Linux distribution; it installs the Linux build there. The script refuses to run as root or as Administrator, so run it as your own user.

Binaries come from get.omo.dev, a CDN copy of each GitHub release. When get.omo.dev can't serve a file, the script downloads the same file from GitHub Releases and checks it the same way.

## Check the install

Open a **new** terminal, so it picks up the updated `PATH`, and run:

```bash
omo --version
```

It prints the installed version. Then open a project, run `omo`, and describe the job.

If the terminal says `omo: command not found` (or `omo is not recognized` on Windows), see [Fix your PATH](#fix-your-path).

## Fix your PATH

When `~/.local/bin` is not on your `PATH`, the installer adds it for you:

| Shell | File the installer edits |
| :--- | :--- |
| zsh | `~/.zshrc` (or `$ZDOTDIR/.zshrc`) |
| bash on macOS | `~/.bash_profile` |
| bash on Linux and WSL | `~/.bashrc` |
| fish | `~/.config/fish/conf.d/omo.fish` |
| any other shell | `~/.profile` |
| Windows | your User `PATH` environment variable |

On macOS, Linux and WSL the edit is a block between `# >>> omo installer >>>` and `# <<< omo installer <<<`, so running the installer again never adds a second copy. A terminal that was already open does not re-read that file. Open a new one, or add the directory to the current session:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

To add it yourself (for example after installing with `OMO_NO_MODIFY_PATH=1`):

```bash
# zsh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
# bash (use ~/.bash_profile on macOS)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
# fish
fish_add_path ~/.local/bin
```

```powershell
# Windows PowerShell
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
[Environment]::SetEnvironmentVariable('Path', "$userPath;$HOME\.local\bin", 'User')
```

On Windows the window you installed from can run `omo` right away. Other terminals see the new `PATH` after you open them again.

If `omo --version` prints something unexpected, another `omo` may come first on your `PATH`. `command -v omo` (macOS, Linux, WSL) or `Get-Command omo` (PowerShell) shows which one runs. The installer also reports an npm or Bun install of `omo-ai` it finds, and leaves it in place.

## Pick a channel or version

The installer follows the `latest` channel, the same release as `omo-ai@latest` on npm. Pass `beta` for the beta channel, or an exact version:

```bash
curl -fsSL https://get.omo.dev/install.sh | bash -s -- beta
curl -fsSL https://get.omo.dev/install.sh | bash -s -- 5.1.1
```

```powershell
& ([scriptblock]::Create((irm https://get.omo.dev/install.ps1))) beta
```

Settings, read from the environment:

| Variable | Effect |
| :--- | :--- |
| `OMO_INSTALL_DIR` | Install directory (default `~/.local/bin`) |
| `OMO_NO_MODIFY_PATH=1` | Never edit shell profiles or the User `PATH` |
| `OMO_INSTALL_BASE_URL` | Download from another mirror instead of `https://get.omo.dev` |

In a pipe, set the variable on the `bash` side: `curl -fsSL https://get.omo.dev/install.sh | OMO_INSTALL_DIR="$HOME/bin" bash`.

## Update

Run the install command again. It replaces the binary when the channel has a newer version and does nothing otherwise.

## Uninstall

macOS, Linux and WSL:

```bash
rm ~/.local/bin/omo
rm -rf ~/.omo/binary-runtime ~/.omo/install.json
```

Then delete the `# >>> omo installer >>>` block from the shell file listed in [Fix your PATH](#fix-your-path).

Windows PowerShell:

```powershell
Remove-Item "$HOME\.local\bin\omo.exe"
Remove-Item -Recurse "$HOME\.omo\binary-runtime", "$HOME\.omo\install.json"
```

Then remove `%USERPROFILE%\.local\bin` from your User `PATH` if nothing else lives there.

`~/.omo` also holds your settings, sessions and memory. Delete the whole folder only if you want those gone too.

## Behind a proxy or offline

The installer needs HTTPS access to `get.omo.dev`. If that fails, it falls back to `registry.npmjs.org` (to resolve the channel) and `github.com` (for the files). On macOS, Linux and WSL it downloads with `curl` (or `wget`), which honor the `https_proxy` / `HTTPS_PROXY` environment variables. Windows PowerShell uses the system proxy settings.

The binary is self-contained. On first run it unpacks its runtime into `~/.omo/binary-runtime/<version>/` without downloading anything, so it runs on a machine with no internet access. To install on such a machine, download the asset for your platform and `SHA256SUMS` from [GitHub Releases](https://github.com/code-yeongyu/oh-my-openagent/releases) on a connected machine, verify it, and copy it to `~/.local/bin/omo`. The asset names and the manual steps are in the [compiled binary guide](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/binary-install.md). Teams with an internal mirror can point `OMO_INSTALL_BASE_URL` at a server that copies the `get.omo.dev` paths (`/channels/<channel>`, `/v/<version>/<asset>`).

## Install with npm or Bun instead

The same OmO is published to npm as `omo-ai`:

```bash
bun add -g omo-ai
# or
npm i -g omo-ai
```

A package-manager install updates with `omo update` and uninstalls with `bun remove -g omo-ai` (or `npm uninstall -g omo-ai`). The unrelated `omo` package on npm belongs to someone else.

Run OmO as your own user, even when an administrator installed the npm package system-wide. On macOS and Linux, a securely root-owned installation uses a complete, private plugin copy under `~/.omo/agent/native-plugin/` so task and team hosts receive a launch spec owned by the running user. An explicit agent-directory override also moves this cache. The shared installation is not changed, and a changed plugin payload gets a new content-keyed copy.

The launch-spec security checks remain enabled. Unsafe source permissions, symlinks or special files in the copied payload, and an incomplete or modified cache are refused rather than used as a fallback. Do not run the assistant as root or change the shared launch spec's ownership to one user. If the installation is not eligible for a private copy, use a user-owned npm prefix instead:

```bash
npm i -g --prefix "$HOME/.local" omo-ai
export PATH="$HOME/.local/bin:$PATH"
```

Looking for the OpenCode or Codex plugin editions instead? See [Installation](installation.md).
