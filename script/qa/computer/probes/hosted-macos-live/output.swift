import Foundation

func emit(_ object: [String: Any]) -> Never {
  let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(0)
}

func fail(_ message: String, code: Int32 = 2) -> Never {
  FileHandle.standardError.write(Data("omo-probe: \(message)\n".utf8))
  exit(code)
}
