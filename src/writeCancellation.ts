export class WriteCancelled extends Error {
  constructor() { super("write_cancelled"); this.name = "WriteCancelled"; }
}
export const isWriteCancelled = (error: unknown): error is WriteCancelled => error instanceof WriteCancelled;
/** Event actions stop quietly after cancellation, while normal failures retain their existing handling. */
export function quietWrite<Args extends unknown[], Result>(action: (...args: Args) => Result) {
  return async (...args: Args): Promise<Awaited<Result> | undefined> => {
    try { return await action(...args); } catch (error) { if (!isWriteCancelled(error)) throw error; }
  };
}
