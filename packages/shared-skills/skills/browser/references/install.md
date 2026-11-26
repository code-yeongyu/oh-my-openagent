# Installing the attached engine

## Doctor states

`node "<skill-root>/scripts/browser-doctor.mjs" --json` reports one state:

| State | Meaning | Next |
|---|---|---|
| `ready` | CLI, daemon and a connected browser | start a session |
| `no-cli` / `no-daemon` / `no-extension` | something is missing | `node "<skill-root>/scripts/browser-install.mjs" [--browser=<id>]` prepares everything it can for **the browser the user uses**, then prints the **single** step only the user can do (relaunch that browser and click **Enable**); relay it verbatim, wait, re-run the doctor |
| `choose-browser` | the signals do not single out one browser (Safari/Firefox default, an idle default while another browser runs, several in use) | nothing was installed; take the browser from memory or ask the user, then `browser-install.mjs --browser=<id>` |
| `no-browser-support` | no Chromium-family profile on this machine | say so and stop |
| `outdated-extension` | the only connected extension is BrowserSkill 0.4.0, which leaves a "BrowserSkill" tab group in the user's browser after every task | start no session; relay the doctor's remedy (update the extension to 0.4.1 or later, delete saved "BrowserSkill" groups by hand), then re-run the doctor |

**Install into the browser the user actually uses, never into whatever happens to be on disk.** Before
installing, check your memory for the user's browser; otherwise read the doctor's `browser` (picked
from the OS default browser, running apps and recent use — `candidates` shows the evidence). If memory
and the doctor disagree, or the doctor says `choose-browser`, ask the user. Pass the answer as
`--browser=<id>` and record it in memory. A Chrome that is merely installed is not their browser.

Three pieces. The onboarding script prepares all three; a human finishes exactly one.

| Piece | Channel | Automatable |
|---|---|---|
| `bsk` CLI + daemon | upstream installer, GitHub Releases | **yes** |
| Browser extension | registered from the Web Store listing through Chrome's external-extension mechanism | **yes, up to one click** — the browser asks the user to enable it |
| Daemon process | auto-starts on the first call | nothing to do |

## Inside the OmO desktop app

The app installs the `bsk` CLI and starts its daemon itself, and keeps the daemon running when the app closes.
Do not run `browser-install.mjs` there unless the doctor says the app's engine is missing. `BSK_HOME` and `BSK_BIN`
still decide where the CLI and daemon are found, here and everywhere else.

## Supported

| | |
|---|---|
| Operating systems | macOS (Apple Silicon and Intel), Linux (x64, ARM64), Windows x64 |
| Browsers | Chrome, Microsoft Edge, Brave, Chromium, Arc, Dia, Vivaldi, Opera, Comet, Naver Whale — whichever the doctor lists under `candidates` |

## Which browser

The extension goes into exactly one browser: the one the user works in. Installed is not the same as
used — a Chrome launched once keeps its profile directory forever — so the scripts rank candidates by:

| Signal | Where it comes from |
|---|---|
| Default browser | macOS LaunchServices `https` handler, Linux `xdg-settings`, Windows `UserChoice` ProgId |
| Running now | the app in `/Applications` (macOS), the process table elsewhere |
| Used in the last 7 days | the profile's `Local State` / `History` modification time |

Order of authority:

1. **Your memory.** If you recorded the user's browser before, pass it: `--browser=<id>`.
2. **`--browser=<id>` / `OMOWRIGHT_BROWSER`** set by the user.
3. **The default browser, when it is also in use** (or nothing else is).
4. **The only browser in use** when no default can be read.

Anything else is `choose-browser` (doctor) / `needsChoice: true` (install): nothing is registered and
`candidates` lists every browser with its signals. Ask the user which one they use, run the install
with `--browser=<id>`, and save the answer to memory so the next session does not ask again. When
the default browser is Safari or Firefox, BrowserSkill cannot drive it — say so and ask which
Chromium-family browser to use.

The doctor also lists `registeredElsewhere`: browsers that still carry an entry from an older
onboarding. They are not removed automatically (removing the entry uninstalls an extension the user
may have enabled); remove one only when the user asks, with omowright's `unregisterExternalExtension`.

## One command

```bash
node "<skill-root>/scripts/browser-install.mjs" [--browser=<id>] [--json] [--wait-ms=180000]
```

In order it: runs upstream's official `install.sh` / `install.ps1` into `~/.local/bin` (any PATH
line the installer appends to a shell rc file is reverted — the library calls the binary by
absolute path); starts the daemon with `bsk status`; and, for **the one browser the user actually
uses**, registers the Web Store listing as an external extension:

| Platform | Where the entry goes | The user's one step |
|---|---|---|
| macOS | `<user data dir>/External Extensions/<id>.json` | quit the browser completely, open it again, click **Enable** in the dialog |
| Windows | `HKCU\Software\<vendor>\<browser>\Extensions\<id>` (`reg add`, no admin) | click **Enable** on the toolbar badge; no restart |
| Linux (Chromium) | `<user data dir>/External Extensions/<id>.json` | relaunch; installs without a prompt |
| Linux (Chrome / Edge / Brave) | `/opt/google/chrome/extensions/<id>.json` and siblings — root only | otherwise open the store link it prints and click **Add** |
| Opera, and Vivaldi / Whale off macOS | no external-extension path | open the store link it prints in that browser and click **Add** |

The script prints that step as `humanStep`. **Relay it verbatim and wait**; with `--wait-ms` it
keeps polling the daemon until the extension connects. An empty `browsersConnected` afterwards is
not a failure to work around — the browser is closed or the user has not clicked yet; say which
and ask.

If the user removed the extension from the browser before, Chrome blocklists its id for external
installs. The script detects that (`reason: "blocklisted"`) and prints the store link instead:

- Chrome: https://chromewebstore.google.com/detail/hhcmgoofomhgciiibhipgmgkgnoenaoi
- Edge: https://microsoftedge.microsoft.com/addons/detail/browserskill/emacgiaaaiojkkpkddmmdfhmokgmnikg

Enterprise force-install policies are deliberately not used: they brand the browser "managed by
your organization" and the user cannot remove the extension.

## Do not install upstream's skill

Upstream ships its own agent skill through `bsk install-skill`. **Do not run it here.** This
package already provides the skill, and upstream's copy installs under a different name into the
user skill directory, which takes precedence over a shipped skill — two descriptions of the same
engine, one of them shadowing the one that knows about omowright and this package's scripts.

## Diagnosing

```bash
node "<skill-root>/scripts/browser-doctor.mjs" --json   # this package's view: cli, daemon, the user's browser + candidates, registrations, connections
bsk doctor                                              # upstream's own checks
bsk logs                                                # daemon log
```

The daemon exits about ten minutes after the last browser disconnects and is not a system
service, so a reboot also stops it. Both heal on the next call — `connectBrowserSkill()` starts it
unless `BSK_AUTO_START=0` (sandboxes that reap background processes keep the daemon on the host
and share `BSK_HOME`; see upstream's sandboxed-agents guide).
