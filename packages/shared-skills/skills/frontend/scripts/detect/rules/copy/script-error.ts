import type { PageHit, PageRule } from "../../rule"

export const scriptError: PageRule = {
	meta: {
		id: "script-error", name: "Uncaught script error on load", category: "quality", severity: "error", engine: "page",
		description: "An uncaught exception or rejected promise occurred while the page loaded.",
		fixHint: "Fix the failing script or handle its rejected promise, then verify the page loads without uncaught errors.",
	},
	check: ({ snapshot }) => {
		if (!snapshot.scriptErrorsCaptured) {
			return [{
				element: null,
				message: "Script errors were not captured: this renderer could not install its error probe before the page's scripts",
				snippet: snapshot.url,
				severity: "advisory",
				severityFixed: true,
			}]
		}
		const counts = new Map<string, number>()
		const hits: PageHit[] = []
		for (const error of new Set(snapshot.scriptErrors)) {
			const hydration = /Minified React error #(418|419|422|423|425)(?!\d)/.test(error)
			const media = error.includes("AbortError") && error.includes("The play() request was interrupted")
			const adTech = /browsingTopics|joinAdInterestGroup|runAdAuction|adsbygoogle|_prebidjs/.test(error)
			const kind = adTech ? "ad-tech" : hydration || media ? "recoverable" : "uncaught"
			const count = counts.get(kind) ?? 0
			if (error.trim() === "" || count >= 3) continue
			counts.set(kind, count + 1)
			hits.push({
				element: null,
				message: kind === "uncaught" ? "Uncaught page script error" : `Page script error (${kind})`,
				snippet: error,
				severity: kind === "uncaught" ? "error" : "advisory",
			})
		}
		return hits
	},
}
