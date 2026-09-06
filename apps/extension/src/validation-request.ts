export type ReviewState<T> =
  | { status: "pending" }
  | { status: "ready"; value: T }
  | { status: "error"; message: string };

// Each selection owns its observer. Cancel both the timer and in-flight fetch;
// also guard completion when a transport cannot honor AbortSignal.
export function observeValidation<T>(
  request: (signal: AbortSignal) => Promise<T>,
  onChange: (state: ReviewState<T>) => void,
  delayMs = 350,
) {
  const controller = new AbortController();
  let active = true;
  onChange({ status: "pending" });
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const value = await request(controller.signal);
        if (active) onChange({ status: "ready", value });
      } catch (error) {
        if (active)
          onChange({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Schedule validation failed. Try again.",
          });
      }
    })();
  }, delayMs);
  return () => {
    active = false;
    clearTimeout(timer);
    controller.abort();
  };
}
