export function createApiFetch(fetcher: typeof fetch = fetch): typeof fetch {
  const pending = new Map<string, Promise<Response>>();

  return async (input, init) => {
    const request = new Request(input, {
      ...init,
      credentials: init?.credentials ?? "include",
    });
    const isRead = request.method === "GET" || request.method === "HEAD";
    const execute = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await fetcher(request.clone(), {
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(isRead ? 20_000 : 180_000),
            ]),
          });
          if (
            !isRead ||
            attempt > 0 ||
            ![429, 502, 503, 504].includes(response.status)
          )
            return response;
          const retryAfter = response.headers.get("Retry-After");
          const seconds = retryAfter === null ? NaN : Number(retryAfter);
          const delay =
            retryAfter === null
              ? 400
              : Number.isFinite(seconds)
                ? seconds * 1000
                : Date.parse(retryAfter) - Date.now();
          if (!Number.isFinite(delay) || delay > 5000) return response;
          await response.body?.cancel();
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, delay))
          );
        } catch (error) {
          if (!isRead || attempt > 0 || request.signal.aborted) throw error;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    };

    // Requests with a caller-owned signal must retain independent cancellation.
    if (!isRead || init?.signal || input instanceof Request) return execute();
    const key = JSON.stringify([
      request.method,
      request.url,
      request.credentials,
      [...request.headers],
      request.cache,
    ]);
    let flight = pending.get(key);
    if (!flight) {
      flight = execute();
      pending.set(key, flight);
      const clear = () => {
        if (pending.get(key) === flight) pending.delete(key);
      };
      void flight.then(clear, clear);
    }
    return (await flight).clone();
  };
}
