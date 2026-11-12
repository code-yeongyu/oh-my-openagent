import CoreGraphics
import Foundation
import ScreenCaptureKit

func pixelStats(_ image: CGImage) -> [String: Any] {
  let width = image.width
  let height = image.height
  var pixels = [UInt8](repeating: 0, count: width * height * 4)
  let space = CGColorSpace(name: CGColorSpace.sRGB)!
  let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
    guard
      let context = CGContext(
        data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return false }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return true
  }
  guard drawn else { return ["width": width, "height": height, "error": "bitmap context"] }
  var nonBlack = 0
  var orange = 0
  var distinct = Set<Int>()
  for index in stride(from: 0, to: pixels.count, by: 4) {
    let r = Int(pixels[index]), g = Int(pixels[index + 1]), b = Int(pixels[index + 2])
    if r + g + b > 30 { nonBlack += 1 }
    if r > 180 && g > 60 && g < 200 && b < 90 { orange += 1 }
    distinct.insert((r >> 4) << 8 | (g >> 4) << 4 | (b >> 4))
  }
  let total = max(width * height, 1)
  return [
    "width": width, "height": height, "nonBlackFraction": Double(nonBlack) / Double(total),
    "fixtureColorFraction": Double(orange) / Double(total), "distinctColors": distinct.count,
  ]
}

func capture(_ pid: pid_t) -> [String: Any] {
  var result: [String: Any] = ["preflight": CGPreflightScreenCaptureAccess()]
  let done = DispatchSemaphore(value: 0)
  SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
    guard let content else {
      result["error"] = "shareable content: \(error.map { String(describing: $0) } ?? "nil")"
      done.signal()
      return
    }
    guard let window = content.windows.first(where: { $0.owningApplication?.processID == pid }) else {
      result["error"] = "no on-screen window for pid \(pid) among \(content.windows.count)"
      done.signal()
      return
    }
    let configuration = SCStreamConfiguration()
    configuration.width = max(Int(window.frame.width) * 2, 2)
    configuration.height = max(Int(window.frame.height) * 2, 2)
    configuration.showsCursor = false
    SCScreenshotManager.captureImage(
      contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration
    ) { image, captureError in
      if let image {
        result["stats"] = pixelStats(image)
      } else {
        result["error"] = "capture: \(captureError.map { String(describing: $0) } ?? "nil")"
      }
      done.signal()
    }
  }
  if done.wait(timeout: .now() + 20) == .timedOut { result["error"] = "capture timed out after 20 s" }
  return result
}
