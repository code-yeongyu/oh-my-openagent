// Bun 1.4.2 (oven-sh/bun#43819): a promise settled by a worker_threads reply never wakes
// expect(p).resolves/.rejects once the worker has answered before, so gateway tests await every
// store-backed promise plainly through this helper and assert the settled value.
export async function settled<T>(promise: Promise<T>): Promise<{ readonly value?: T; readonly error?: Error }> {
  return await promise.then((value) => ({ value }), (error: unknown) => ({ error: error instanceof Error ? error : new Error(String(error)) }))
}
