# Tier 2 — Chrome stealth (CloakBrowser + agent-browser)

Real interaction (clicks, forms, screenshots, video, persistent login) for pages that defeat Tier 1/1.5. Two runtime tools, both installed on demand — neither is vendored in this skill:

- **CloakBrowser** (`pip`) — stealth Chromium with source-level C++ fingerprint patches. The Python wrapper source is MIT; the downloaded Chromium binary is covered by CloakBrowser's separate binary license and is not redistributed by this package. Passes Cloudflare Turnstile, FingerprintJS, BrowserScan, and 30+ detectors. Pin **0.4.0**.
- **agent-browser** (`npm`, Apache-2.0) — native CDP automation CLI that drives CloakBrowser. AX-tree snapshots, `@eN` refs, click/fill/type/scroll, screenshots, video, cookie/state/session management. Pin **0.29.1**.

```
CloakBrowser (stealth Chromium) <- CDP port 9242 -> agent-browser CLI
  - 57 C++ fingerprint patches                  - AX-tree snapshots, @eN refs
  - Canvas/WebGL consistency                    - click / fill / type / scroll
  - navigator.webdriver = false at C++ source   - screenshot, video record
  - Humanize mode (mouse curves, timing)        - cookie / state / session mgmt
```

## Install (one-time)

CloakBrowser runs in a dedicated Python venv. Cross-platform: macOS, Linux, and Windows all supported by both tools (use the venv path convention for your OS).

```bash
# CloakBrowser (MIT wrapper source; separate binary license, pin 0.4.0):
uv venv .cloak-venv --python 3.13
# macOS/Linux: source .cloak-venv/bin/activate    Windows: .cloak-venv\Scripts\activate
uv pip install "cloakbrowser==0.4.0"
python -c "import cloakbrowser; cloakbrowser.ensure_binary()"   # downloads stealth Chromium on first import

# agent-browser (Apache-2.0, pin 0.29.1):
npm i -g agent-browser@0.29.1 && agent-browser install
agent-browser --version   # 0.29.1
```

Verify CloakBrowser:

```bash
python -c "import cloakbrowser; print(cloakbrowser.__version__, cloakbrowser.CHROMIUM_VERSION, cloakbrowser.binary_info()['installed'])"
# -> 0.4.0  <chromium-version>  True
```

## Launch + drive

```bash
# 1. Launch CloakBrowser with CDP on :9242 (background). With the venv active:
python -c "import asyncio,cloakbrowser; asyncio.run(cloakbrowser.launch_async(headless=False, stealth_args=True, args=['--remote-debugging-port=9242']))" &

# 2. CloakBrowser launches tabless -> agent-browser would say "No page found".
#    Open the first tab via CDP before any agent-browser command:
curl -s -X PUT "http://127.0.0.1:9242/json/new?https://example.com"

# 3. Connect agent-browser. CloakBrowser already patches navigator.webdriver=false at the
#    C++ source, so NO --init-script is required — only --user-agent to hide HeadlessChrome:
agent-browser --cdp 9242 \
  --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.177 Safari/537.36" \
  open https://example.com

# 4. Interact:
agent-browser --cdp 9242 snapshot -i        # interactive elements (@eN refs)
agent-browser --cdp 9242 click @e3
agent-browser --cdp 9242 screenshot out.png

# 5. Close when done:
agent-browser --cdp 9242 close
```

agent-browser ships its own always-version-matched usage guide — load it instead of guessing flags:

```bash
agent-browser skills get core            # core workflows, patterns, troubleshooting
agent-browser skills get core --full     # + full command reference and templates
agent-browser skills get electron        # Electron apps (VS Code, Slack, Discord, Figma, ...)
agent-browser skills list                # everything available on the installed version
```

## Verify stealth

```bash
agent-browser --cdp 9242 eval 'navigator.webdriver'   # must print false
```

Tested May 2026: bot.sannysoft.com all-green, browserscan.net "Normal" (15/15), nowsecure.nl Turnstile bypassed.

## Cookie login (cross-platform)

`scripts/extract_cookies.py` reads cookies from a local browser profile and optionally injects them into the running CDP session. Profile-path resolution and value decryption are per-OS:

| OS | Profile location | Cookie value decryption |
|----|------------------|--------------------------|
| macOS | `~/Library/Application Support/<app>/` | Keychain (AES-128-CBC, PBKDF2 salt `saltysalt`) |
| Linux | `~/.config/<app>/` (Chromium), `~/.mozilla/firefox/` (Firefox) | libsecret/SecretService, then PBKDF2 + AES-128-CBC |
| Windows | `%LOCALAPPDATA%\<app>\User Data\` | DPAPI (`CryptUnprotectData`) + AES-256-GCM (`os_crypt` key) |

```bash
# Extract to a file:
mkdir -p ~/.local/state/omo-cookies
python3 ../scripts/extract_cookies.py --browser chrome --domain youtube.com --output ~/.local/state/omo-cookies/youtube.cookies.json
# Extract and inject into the running CDP session:
python3 ../scripts/extract_cookies.py --browser chrome --domain youtube.com --inject --cdp 9242
```

Cookie export files are written with owner-only `0600` permissions. Do not place live auth cookies in shared temp directories or commit them to a repo. Cookie injection sends values to CDP over stdin rather than argv, so live cookie values do not appear in process listings. Cookies apply on next navigation — reload after injecting. Google services use fingerprint-bound tokens (SIDTS) that may not transfer across browser profiles. Firefox-family profiles store cookies unencrypted; Chromium-family profiles trigger a one-time OS-keyring prompt on macOS/Linux.

## Anti-patterns

- Do NOT launch CloakBrowser for plain text extraction — use Tier 1.
- Do NOT pass an `--init-script` for the webdriver flag — CloakBrowser already patches it at source; the only required override is `--user-agent`.
- Do NOT run agent-browser before creating the first tab via `curl -X PUT .../json/new` — CloakBrowser launches tabless.
- Do NOT use vanilla Chrome when stealth is needed — always CloakBrowser.
- Do NOT forget to `close` the session when done.
- Do NOT inject cookies without reloading the page.

## Troubleshooting

```bash
# Port 9242 already in use (macOS/Linux):
lsof -ti:9242 | xargs kill -9
# agent-browser can't connect:
curl -s http://127.0.0.1:9242/json/version | head -5   # empty -> CloakBrowser not running
# Update either tool:
uv pip install --upgrade "cloakbrowser==0.4.0" && python -c "import cloakbrowser; cloakbrowser.ensure_binary()"
npm i -g agent-browser@0.29.1
```
