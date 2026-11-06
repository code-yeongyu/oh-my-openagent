// Tests await rejections through this instead of expect(promise).rejects: Bun's .rejects/.resolves wait with a
// nested event-loop run (wait_for_promise), and on Windows Bun 1.4.3 can crash when that nested run closes a socket
// whose callback is still on the stack (oven-sh/bun#39643, reverted before 1.4.3, re-landed in 1.4.4 by #46021).
export const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("expected the promise to reject, but it fulfilled");
    },
    (error: unknown) => error,
  );
