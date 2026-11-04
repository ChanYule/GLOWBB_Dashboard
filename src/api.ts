async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers:
        options.body instanceof FormData
          ? options.headers
          : {
              Accept: "application/json",
              "Content-Type": "application/json",
              ...options.headers,
            },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw Error(
      "Unable to connect to the dashboard data service. Check your connection and try again.",
      { cause: error },
    );
  }
  if (res.status === 413)
    throw Error(
      "This upload is too large. Choose a file smaller than 4 MB and try again.",
    );
  if (
    !res.headers
      .get("content-type")
      ?.match(/\bapplication\/(?:[\w.-]+\+)?json\b/i)
  ) {
    throw Error(
      res.status === 404
        ? "The dashboard data service is not deployed or connected yet. Please finish the server setup, then try again."
        : "The dashboard data service returned an unexpected response. Please try again.",
    );
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw Error(
      "The dashboard data service returned an unreadable response. Please try again.",
    );
  }
  if (!res.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : "Unable to complete request.";
    throw Object.assign(Error(message), { status: res.status });
  }
  return data as T;
}

// Coalesce only concurrent GETs. Never persist protected results across sessions
// and never share a cancellable request with another caller.
const inFlight = new Map<string, Promise<unknown>>();
export function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  if ((options.method || "GET") !== "GET") {
    inFlight.clear();
    return request<T>(url, options);
  }
  if (options.signal || options.headers || options.body)
    return request<T>(url, options);
  const existing = inFlight.get(url);
  if (existing) return existing as Promise<T>;
  const pending = request<T>(url, options).finally(() => {
    if (inFlight.get(url) === pending) inFlight.delete(url);
  });
  inFlight.set(url, pending);
  return pending;
}
