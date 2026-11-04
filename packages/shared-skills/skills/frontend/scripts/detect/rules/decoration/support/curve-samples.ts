export type Point = readonly [number, number]
export const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
export function cubic(p0: Point, p1: Point, p2: Point, p3: Point): readonly Point[] {
	return Array.from({ length: 15 }, (_, i) => {
		const t = (i + 1) / 16,
			u = 1 - t,
			a = u * u * u,
			b = 3 * u * u * t,
			c = 3 * u * t * t,
			d = t * t * t
		return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]] satisfies Point
	})
}
export function arc(
	from: Point,
	rxInput: number,
	ryInput: number,
	rotation: number,
	large: boolean,
	sweep: boolean,
	to: Point,
): readonly Point[] {
	let rx = Math.abs(rxInput),
		ry = Math.abs(ryInput)
	if ((from[0] === to[0] && from[1] === to[1]) || rx === 0 || ry === 0) return []
	const phi = (rotation * Math.PI) / 180,
		sin = Math.sin(phi),
		cos = Math.cos(phi),
		dx = (from[0] - to[0]) / 2,
		dy = (from[1] - to[1]) / 2
	const x1 = cos * dx + sin * dy,
		y1 = -sin * dx + cos * dy,
		lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
	if (lambda > 1) {
		rx *= Math.sqrt(lambda)
		ry *= Math.sqrt(lambda)
	}
	const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1,
		den = rx * rx * y1 * y1 + ry * ry * x1 * x1
	const coef = (den === 0 ? 0 : Math.sqrt(Math.max(0, num / den))) * (large === sweep ? -1 : 1)
	const cx1 = (coef * rx * y1) / ry,
		cy1 = (-coef * ry * x1) / rx,
		cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2,
		cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2
	const theta = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx)
	let delta = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx) - theta
	if (sweep && delta < 0) delta += Math.PI * 2
	else if (!sweep && delta > 0) delta -= Math.PI * 2
	return Array.from({ length: 15 }, (_, i) => {
		const t = theta + (delta * (i + 1)) / 16,
			ex = rx * Math.cos(t),
			ey = ry * Math.sin(t)
		return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy] satisfies Point
	})
}
