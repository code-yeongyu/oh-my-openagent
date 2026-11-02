// X11 scroll-direction scenarios: the engine's semantic scroll contract (positive `dy` moves the view
// toward the end of the content, positive `dx` toward its right edge, negatives back) on a Tk text
// widget, for XTEST (foreground) and XSendEvent (background) delivery, and the scroll unit: `dy` is
// pixels, so a vertical scroll moves a bounded pixel distance. The widget reports its own view and
// line height; the engine's report is never read.
import { asObject, Engine, type Outcome, outcome } from "./engine.ts";
import { type Context, type Result, result } from "./scenario.ts";
import type { ScrollView, X11Observer, X11Stage } from "./x11-env.ts";

/** Pixels; the X11 backend sends one wheel click per 40 px, so 3 clicks. */
const VERTICAL_PIXELS = 120;
/** Pixels; 2 clicks, which the fixture binds to 4 columns each. */
const HORIZONTAL_PIXELS = 80;
/**
 * The distance the view may move for VERTICAL_PIXELS. Tk 8.6 binds each button-4/5 click to
 * `yview scroll -50 pixels`, so 3 clicks are 150 px (1.25x); 0.5x..2x admits toolkits that scroll
 * 3 lines of 13..26 px per click and still rejects the old rule of one click per unit (120 clicks).
 */
const DISTANCE_BOUNDS = { min: VERTICAL_PIXELS / 2, max: VERTICAL_PIXELS * 2 } as const;

interface Step {
	readonly reply: Outcome;
	readonly view: ScrollView;
}

export async function scrollDirection(
	ctx: Context,
	stage: X11Stage,
	observe: X11Observer,
	deliveryMode: "foreground" | "background",
): Promise<Result> {
	const engine = Engine.spawn(ctx.engineBinary, ctx.procs.childEnv(stage.env));
	try {
		await engine.activate(false);
		await observe.activate(stage.other);
		const frame = asObject(await engine.result("capture", { target: stage.scroll }));
		const at = {
			target: stage.scroll,
			x: Math.floor(Number(frame.width) / 2),
			y: Math.floor(Number(frame.height) / 2),
			frameId: frame.frameId ?? null,
			opts: { deliveryMode },
		};
		const start = observe.scrollView();
		let markers = 0;
		// After each scroll, a pointer motion to a fresh point near the widget's top-left corner (away
		// from the scroll point) marks the end of the wheel events; see X11Observer.scrollViewAfter.
		const step = async (dx: number, dy: number): Promise<Step> => {
			const reply = outcome(await engine.exec("scroll", { ...at, dx, dy }));
			markers += 1;
			const marker = { x: start.origin.x + 4 + markers, y: start.origin.y + 4 };
			return { reply, view: await observe.scrollViewAfter(marker) };
		};
		const before = { active: await observe.activeWindow(), ...start };
		const down = await step(0, VERTICAL_PIXELS);
		const up = await step(0, -VERTICAL_PIXELS);
		const right = await step(HORIZONTAL_PIXELS, 0);
		const left = await step(-HORIZONTAL_PIXELS, 0);
		const after = { active: await observe.activeWindow(), ...left.view };
		const pixelsMoved = (down.view.line - start.line) * start.lineHeight;
		return result(
			`x11-scroll-direction-${deliveryMode}`,
			{
				other_active_before: before.active === stage.other,
				scroll_requests_ok: [down, up, right, left].every((taken) => taken.reply === "ok"),
				positive_dy_moves_toward_end: down.view.line > start.line,
				line_height_measured: start.lineHeight > 0,
				positive_dy_distance_within_bounds:
					pixelsMoved >= DISTANCE_BOUNDS.min && pixelsMoved <= DISTANCE_BOUNDS.max,
				negative_dy_moves_toward_start: up.view.line < down.view.line,
				negative_dy_returns_to_start: up.view.line === start.line,
				positive_dx_moves_toward_right_edge: right.view.column > up.view.column,
				negative_dx_moves_toward_left_edge: left.view.column < right.view.column,
				negative_dx_returns_to_start: left.view.column === start.column,
				active_window_restored: after.active === before.active,
			},
			{
				display: stage.display,
				target: stage.scroll,
				other: stage.other,
				deliveryMode,
				point: { x: at.x, y: at.y },
				pixels: { vertical: VERTICAL_PIXELS, horizontal: HORIZONTAL_PIXELS },
				lineHeight: start.lineHeight,
				linesMoved: down.view.line - start.line,
				pixelsMoved,
				distanceBounds: DISTANCE_BOUNDS,
				views: { start, afterPositiveDy: down.view, afterNegativeDy: up.view, afterPositiveDx: right.view, afterNegativeDx: left.view },
				replies: { positiveDy: down.reply, negativeDy: up.reply, positiveDx: right.reply, negativeDx: left.reply },
			},
			{ before, after },
		);
	} finally {
		await engine.close();
	}
}
