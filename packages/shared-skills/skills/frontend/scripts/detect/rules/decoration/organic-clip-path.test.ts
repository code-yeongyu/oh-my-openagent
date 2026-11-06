import { test } from "bun:test"
import { organicClipPath } from "./organic-clip-path"
import { assertCases } from "./support/assert-cases"

const blob =
	"polygon(50% 0%,61% 8%,74% 6%,82% 16%,94% 22%,96% 36%,100% 50%,92% 63%,88% 78%,74% 88%,60% 100%,46% 96%,30% 98%,18% 86%,6% 78%,2% 62%,0% 48%,6% 34%,12% 20%,22% 10%,36% 4%)"
test("#given repeated inline contours #then one declaration reports once", () => {
	assertCases(organicClipPath, [
		{ id: "first", attributes: { style: "clip-path:" + blob }, style: { "clip-path": blob } },
		{ id: "second", attributes: { style: "clip-path:" + blob }, style: { "clip-path": blob } },
	], ["#first"])
})
test("#given organic polygons #then cut corners circles and coarse grid shapes pass", () => {
	assertCases(
		organicClipPath,
		[
			{ id: "flag", style: { "clip-path": blob } },
			{ id: "hex", style: { "clip-path": "polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%)" } },
			{ id: "circle", style: { "clip-path": "circle(50% at 50% 50%)" } },
			{ id: "cut", style: { "clip-path": "polygon(0 0,100% 0,100% 85%,85% 100%,0 100%)" } },
		],
		["#flag"],
	)
})
test("#given notches even zigzags and torn edges #then only irregular contours report", () => {
	assertCases(
		organicClipPath,
		[
			{
				id: "flag",
				style: {
					"clip-path":
						"polygon(0 0,100% 0,100% 96%,95% 100%,90% 97%,85% 100%,80% 96%,75% 99%,70% 96%,65% 100%,60% 97%,55% 99%,50% 96%,0 96%)",
				},
			},
			{
				id: "zigzag",
				style: { "clip-path": "polygon(0% 0%,100% 0%,100% 20%,96% 40%,100% 60%,96% 80%,100% 100%,0% 100%,4% 80%,0% 60%,4% 40%,0% 20%)" },
			},
			{
				id: "notch",
				style: {
					"clip-path":
						"polygon(4px 0%,calc(100% - 4px) 0%,calc(100% - 4px) 4px,100% 4px,100% calc(100% - 4px),calc(100% - 4px) calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,4px calc(100% - 4px),0% calc(100% - 4px),0% 4px,4px 4px)",
				},
			},
		],
		["#flag"],
	)
})
test("#given curved silhouettes and smooth corner rectangles #then only organic paths report", () => {
	assertCases(
		organicClipPath,
		[
			{
				id: "flag",
				style: { "clip-path": "path('M0 0 H1440 V300 C1260 360 1080 240 900 300 C720 360 540 240 360 300 C180 360 90 260 0 300 Z')" },
			},
			{
				id: "rounded",
				style: { "clip-path": "path('M10 0 L90 0 Q100 0 100 10 L100 90 Q100 100 90 100 L10 100 Q0 100 0 90 L0 10 Q0 0 10 0 Z')" },
			},
			{ id: "line", style: { "clip-path": "path('M0 0 L100 0 L100 100 L0 100 Z')" } },
		],
		["#flag"],
	)
})
