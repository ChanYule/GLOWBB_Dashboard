async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const timeoutMessage =
    url.split("?")[0] === "/api/client-registry/confirm"
      ? "The save request timed out. Refresh the dashboard and check whether the registry was saved before trying again. If it was not saved, preview the file again."
      : "The data service timed out. Refresh the dashboard to check the latest saved data before trying again.";
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
  if (res.status === 504)
    throw Object.assign(Error(timeoutMessage), { status: res.status });
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
    const timeout =
      data &&
      typeof data === "object" &&
      "error" in data &&
      data.error &&
      typeof data.error === "object" &&
      "code" in data.error &&
      ["FUNCTION_INVOCATION_TIMEOUT", "FUNCTION_RESPONSE_TIMEOUT"].includes(
        String(data.error.code),
      );
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : timeout
          ? timeoutMessage
          : `The data service could not complete this request (HTTP ${res.status}). Please try again.`;
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
