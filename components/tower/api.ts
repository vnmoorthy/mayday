// Tiny fetch wrapper for the Mayday HTTP API. Errors carry the status code so
// callers can treat 403 (unclaimed airspace) differently from a plain failure.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function api<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Could not reach Mayday. Check your connection and try again.", 0);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed with status ${res.status}.`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}
