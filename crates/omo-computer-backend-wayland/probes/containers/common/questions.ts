// SP-W question registry: one entry per question and condition of the SP-W spike. A ledger row is one entry
// on one compositor. The answer to each binary question is CONFIRMS (yes) or CONTRADICTS (no).
import {
  a11yGsettings,
  a11yRegistry,
  gnomeExtensionNoLogout,
  kdeActivate,
  kdePwmBind,
  wlrForeignToplevel,
} from "./desktop-questions.ts"
import {
  clipboardGrant,
  eiRegions,
  globalShortcuts,
  rdRestore,
  scRestoreSession,
  secondConnect,
} from "./portal-questions.ts"
import { releaseOnClose } from "./release-question.ts"
import type { Answer, Compositor } from "./session-kit.ts"

export type Question = {
  readonly id: string
  readonly compositors: readonly Compositor[]
  readonly question: string
  readonly condition: string
  readonly run: (c: Compositor) => Promise<Answer>
}

const ALL: readonly Compositor[] = ["gnome", "kde", "sway"]

export const QUESTIONS: readonly Question[] = [
  {
    id: "sc-restore-session",
    compositors: ALL,
    question: "Does the ScreenCast restore token (persist_mode 2) survive a session under the file policy?",
    condition:
      "token kept in one 0600 O_NOFOLLOW file; full session restart (bus, compositor, portals) over the same home; no dialog answered on restore",
    run: scRestoreSession,
  },
  {
    id: "rd-restore-engine",
    compositors: ALL,
    question: "Does the RemoteDesktop session's own restore_token (persist_mode 2) survive an engine restart?",
    condition:
      "token kept in one 0600 O_NOFOLLOW file; new client process on the same session bus; no dialog answered on restore",
    run: (c) => rdRestore(c, "engine"),
  },
  {
    id: "rd-restore-session",
    compositors: ALL,
    question: "Does the RemoteDesktop session's own restore_token (persist_mode 2) survive a session restart?",
    condition:
      "token kept in one 0600 O_NOFOLLOW file; full session restart over the same home; no dialog answered on restore",
    run: (c) => rdRestore(c, "session"),
  },
  {
    id: "gs-version",
    compositors: ALL,
    question: "Does the GlobalShortcuts portal exist (its version property answers)?",
    condition: "org.freedesktop.portal.GlobalShortcuts version read on the portal frontend",
    run: globalShortcuts,
  },
  {
    id: "ei-regions-combined",
    compositors: ALL,
    question: "Does libei announce absolute-pointer regions covering every output?",
    condition:
      "combined RemoteDesktop + ScreenCast (monitors, multiple) session; two outputs; regions compared with xdg-output logical rects in 8 px buckets",
    run: (c) => eiRegions(c, true),
  },
  {
    id: "ei-regions-nostream",
    compositors: ALL,
    question: "With NO stream in the RemoteDesktop session, does the EIS absolute pointer announce a region at all?",
    condition: "RemoteDesktop session with keyboard+pointer devices and no ScreenCast sources",
    run: (c) => eiRegions(c, false),
  },
  {
    id: "eis-second-connect",
    compositors: ALL,
    question: "Does a second ConnectToEIS on one live RemoteDesktop session succeed?",
    condition:
      "RemoteDesktop session (keyboard+pointer); first EIS socket still open; second socket must reach a libei connect event",
    run: secondConnect,
  },
  {
    id: "clipboard-grant",
    compositors: ALL,
    question: "Does the backend grant RequestClipboard on the combined session before Start?",
    condition: "Clipboard.RequestClipboard before RemoteDesktop.Start; grant read from Start's clipboard_enabled",
    run: clipboardGrant,
  },
  {
    id: "release-on-close",
    compositors: ALL,
    question: "Does the compositor release every key its destroyed virtual device held when the owner's socket closes?",
    condition:
      "hold shift, SIGKILL the owner, read modifiers through an independent wev client within 2 s (GNOME/KDE: libei via the portal; sway: virtual_protocols)",
    run: releaseOnClose,
  },
  {
    id: "ext-no-logout",
    compositors: ["gnome"],
    question: "Does the GNOME read-only extension install without a logout?",
    condition: "gnome-extensions install + enable; bus name owned within 5 s; control leg after logout and login",
    run: gnomeExtensionNoLogout,
  },
  {
    id: "a11y-gsettings",
    compositors: ["gnome"],
    question: "On GNOME 46, does the org.a11y.Status.IsEnabled = true write land in toolkit-accessibility?",
    condition: "write through the a11y bus launcher's org.a11y.Status; GSettings read back within 2 s (dconf backend)",
    run: a11yGsettings,
  },
  {
    id: "a11y-registry-gedit",
    compositors: ["gnome"],
    question:
      "On GNOME 46, does gedit started after the IsEnabled write appear in the AT-SPI registry with no other step?",
    condition: "gedit --new-window on Wayland, registry polled 20 s",
    run: (c) => a11yRegistry(c, "gedit"),
  },
  {
    id: "a11y-registry-qt6",
    compositors: ["gnome"],
    question:
      "On GNOME 46, does a Qt6 app started after the IsEnabled write appear in the AT-SPI registry with no other step?",
    condition: "PyQt6 window, QT_QPA_PLATFORM=wayland, no QT_LINUX_ACCESSIBILITY_ALWAYS_ON, registry polled 20 s",
    run: (c) => a11yRegistry(c, "qt6"),
  },
  {
    id: "a11y-registry-chromium",
    compositors: ["gnome"],
    question:
      "On GNOME 46, does Chromium started after the IsEnabled write appear in the AT-SPI registry with no other step?",
    condition:
      "Chromium snapshot, --ozone-platform=wayland (--no-sandbox for the container only), registry polled 20 s",
    run: (c) => a11yRegistry(c, "chromium"),
  },
  {
    id: "kde-pwm-bind-plain",
    compositors: ["kde"],
    question: "Does org_kde_plasma_window_management bind for a launcher-spawned engine?",
    condition: "plain child process with no desktop file (the launcher-spawned shape)",
    run: (c) => kdePwmBind(c, "plain"),
  },
  {
    id: "kde-pwm-bind-desktop-file",
    compositors: ["kde"],
    question: "Does org_kde_plasma_window_management bind for a launcher-spawned engine?",
    condition: "same binary named by a user desktop file with X-KDE-Wayland-Interfaces",
    run: (c) => kdePwmBind(c, "desktop-file"),
  },
  {
    id: "kde-activate",
    compositors: ["kde"],
    question:
      "Does request_activate (plasma window management) carry an activation that focus-stealing prevention honours?",
    condition:
      "helper authorised by a desktop file; asks KWin to activate the older of two windows while the newer one is active; active state read back within 2 s",
    run: kdeActivate,
  },
  {
    id: "wlr-foreign-toplevel",
    compositors: ["kde", "sway"],
    question: "Is the wlr foreign-toplevel manager advertised (expected false on KWin)?",
    condition: "zwlr_foreign_toplevel_manager_v1 in the registry of a plain client",
    run: wlrForeignToplevel,
  },
]
