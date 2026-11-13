import Gio from "gi://Gio"
import Meta from "gi://Meta"
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js"
import * as Main from "resource:///org/gnome/shell/ui/main.js"

import { describeReply, INTERFACE_XML, OBJECT_PATH } from "./window-rects.js"

// Exported on GNOME Shell's own session-bus connection, so callers reach it at
// org.gnome.Shell and no other process can answer in its place.
export default class SenpiWindowRects extends Extension {
  enable() {
    this._exported = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, {
      List() {
        const windows = global.display.sort_windows_by_stacking(
          global.get_window_actors().map((actor) => actor.get_meta_window()),
        )
        return JSON.stringify(
          describeReply({
            windows,
            workspace: global.workspace_manager.get_active_workspace(),
            isDesktopWindow: (window) => window.get_window_type() === Meta.WindowType.DESKTOP,
            // Shell UI is Clutter actors, not Mutter windows: report it so the
            // backend never sends window input that would land on it.
            shell: {
              overviewVisible: Main.overview.visible,
              modalCount: Main.modalCount,
              locked: Main.sessionMode.isLocked || Main.screenShield?.locked === true,
            },
            // layoutManager keeps no public list of its chrome; this is the one it
            // builds the shell's input region from.
            tracked: Main.layoutManager._trackedActors ?? [],
          }),
        )
      },
    })
    this._exported.export(Gio.DBus.session, OBJECT_PATH)
  }

  disable() {
    this._exported?.unexport()
    this._exported = null
  }
}
