export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
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
  } catch {
    throw Error(
      "Unable to connect to the dashboard data service. Check your connection and try again.",
    );
  }
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
    throw Error(message);
  }
  return data as T;
}
