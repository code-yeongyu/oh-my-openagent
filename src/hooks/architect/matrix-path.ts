export function isMatrixPath(filePath: string): boolean {
  return /\.matrixx[/\\]/.test(filePath)
}
