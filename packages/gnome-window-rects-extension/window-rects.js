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

/**
 * GNOME Shell's own state that puts shell UI over every window: the Activities
 * overview (and its app grid), a shell modal (polkit or end-session dialog, an open
 * panel menu) and the lock screen. Window input is refused while any is true.
 */
export function describeShell({ overviewVisible, modalCount, locked }) {
	return { overview: Boolean(overviewVisible), modal: modalCount > 0, locked: Boolean(locked) };
}

/**
 * Shell chrome that takes pointer input above windows (the top bar, a showing
 * notification banner), from Main.layoutManager's tracked actors: only mapped actors
 * in the shell's input region, as stage rects. Window input under one is refused.
 */
export function describeChrome(tracked) {
	return tracked.flatMap(({ actor, affectsInputRegion }) => {
		if (!affectsInputRegion || !actor.is_mapped()) return [];
		const [x, y] = actor.get_transformed_position();
		const [width, height] = actor.get_transformed_size();
		const rect = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
		return rect.width > 0 && rect.height > 0 ? [rect] : [];
	});
}

/** The whole `List` reply: shell state, input-taking chrome, then the window stack. */
export function describeReply({ windows, workspace, isDesktopWindow, shell, tracked }) {
	return {
		shell: describeShell(shell),
		chrome: describeChrome(tracked),
		windows: describeWindows(windows, workspace, isDesktopWindow),
	};
}
