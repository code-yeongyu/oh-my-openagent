import { looksLikeImage, readImageSize } from "./image-size"
import { OK, positiveNumberParam, type OutboundGate } from "./types"

// Images must read on a phone: refuse any image taller than `max_ratio` x its width (default 2.2)
// or higher than `max_height` px (default 2400) and ask for per-scene captures instead. An image
// whose size cannot be read is refused too: an unknown size is not a readable one.
export const gate: OutboundGate = {
  id: "image_viewport",
  phase: "outbound",
  async run(intent, params, ctx) {
    const maxRatio = positiveNumberParam(params, "max_ratio", 2.2)
    const maxHeight = positiveNumberParam(params, "max_height", 2400)
    const sizeOf = ctx.imageSize ?? readImageSize
    for (const op of intent.ops) {
      if (op.op !== "upload") continue
      for (const file of op.files) {
        if (!looksLikeImage(file.path)) continue
        const size = await sizeOf(file.path).catch(() => null)
        if (size === null) return { refuse: `cannot read the size of image '${file.title}'; send viewport-sized per-scene captures` }
        if (size.width <= 0 || size.height / size.width > maxRatio || size.height > maxHeight) {
          return {
            refuse: `image '${file.title}' is ${size.width}x${size.height} px, too tall to read on a phone (max height/width ${maxRatio}, max height ${maxHeight} px); send viewport-sized per-scene captures instead`,
          }
        }
      }
    }
    return OK
  },
}
