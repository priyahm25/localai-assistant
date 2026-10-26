/** Coalesces duplicate calls while one UI-triggered asynchronous operation is running. */
export function createAsyncSingleFlight<T>() {
  let active: Promise<T> | undefined;
  return {
    run(operation: () => Promise<T>): Promise<T> {
      if (active) return active;
      const current = Promise.resolve().then(operation);
      active = current;
      void current.finally(() => {
        if (active === current) active = undefined;
      }).catch(() => {});
      return current;
    },
  };
}
