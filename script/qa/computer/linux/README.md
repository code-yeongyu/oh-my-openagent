# Linux live driver

`script/qa/computer/linux.ts` drives the computer-use engine against an X session that the driver starts itself. It never connects to a display it did not start.

```sh
bun script/qa/computer/linux.ts --session xvfb --scenario xft-dpi-scale --json
bun script/qa/computer/linux.ts --session xvfb --all
```

## Sessions

| Session      | What it starts                                                           | Where it runs                                    |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------ |
| `xvfb`       | Xvfb, xfwm4, xcompmgr, a private session bus and the AT-SPI bus launcher | the QA container built from `Dockerfile`         |
| `xvfb-nobus` | the `xvfb` session without the accessibility bus                         | the QA container                                 |
| `none`       | no display server                                                        | anywhere                                         |
| `xorg`       | Xorg with the dummy video driver, the one session with kernel input      | directly on a host granted `/dev/uinput`, never in a container |

Every session gives its processes and the engine their own `XDG_RUNTIME_DIR` and `XDG_STATE_HOME` under the run directory. The `xvfb` session waits until xcompmgr owns `_NET_WM_CM_S0`, so a scenario always runs on the same capture path.

## `--all`

`--all` runs every registered scenario and prints one line at the end:

```text
SET linux/<session> pass=<n> fail=<n> blocked=<n>
```

A scenario that the session cannot admit, or that runs on a host missing a tool it needs, counts as blocked with its reason printed. It never counts as a pass.

The exit code is:

| Exit | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| `0`  | at least one scenario passed and none failed                                |
| `1`  | at least one scenario failed                                                |
| `2`  | the command line was wrong                                                  |
| `3`  | nothing passed and nothing failed: every scenario was blocked, so the run proves nothing |

A CI step that reads only the exit code therefore never treats an all-blocked run as green.
