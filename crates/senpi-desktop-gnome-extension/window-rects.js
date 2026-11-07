// Pure half of the extension: no gi:// imports, so it runs under bun test too.
// The reply shape is the contract of crates/senpi-desktop-backend-wayland/src/compositor/gnome.rs.

export const OBJECT_PATH = "/dev/omo/SenpiDesktop/WindowRects";

export const INTERFACE_XML = `<node>
  <interface name="dev.omo.SenpiDesktop.WindowRects">
    <method name="List">
      <arg type="s" direction="out" name="json"/>
    </method>
  </interface>
</node>`;

/**
 * Describes Mutter windows, already sorted bottom first, as plain records.
 * Reads geometry and visibility only; never moves, focuses or changes a window.
 */
export function describeWindows(windows, workspace, isDesktopWindow) {
	return windows.map((window) => {
		const rect = window.get_frame_rect();
		return {
			id: String(window.get_stable_sequence()),
			pid: window.get_pid() > 0 ? window.get_pid() : 0,
			title: window.get_title() ?? "",
			x: Math.round(rect.x),
			y: Math.round(rect.y),
			width: Math.round(rect.width),
			height: Math.round(rect.height),
			shown: !window.minimized && !window.is_hidden() && window.located_on_workspace(workspace),
			desktopWindow: isDesktopWindow(window),
		};
	});
}
