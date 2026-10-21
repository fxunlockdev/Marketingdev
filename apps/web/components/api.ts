export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reauthenticate = false,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  key?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError(
      0,
      "We couldn’t confirm that request. Your entries are still here. Check your connection before trying again.",
    );
  }
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "We couldn’t read the response. Please try again.",
    );
  }
  if (!response.ok) {
    const safe =
      response.status === 401
        ? path.startsWith("/api/auth/")
          ? "Email or password was not accepted. Check your details and try again."
          : "Your session has ended. Sign in again to continue."
        : response.status === 429
          ? "Too many requests. Wait a moment before trying again."
          : response.status >= 500
            ? "We couldn’t save or load your work. Please try again."
            : (data.error ??
              data.message ??
              "This request could not be completed.");
    throw new ApiError(
      response.status,
      typeof safe === "string" ? safe : "This request could not be completed.",
      response.status === 401 && !path.startsWith("/api/auth/"),
    );
  }
  return data;
}
export type Workspace = { id: string; name: string; role: string };
export type Brand = {
  id: string;
  name: string;
  website: string | null;
  revision: number;
};
export type Asset = {
  id: string;
  filename: string;
  content_type: string;
  expected_bytes: number;
  state: string;
  error_code: string | null;
  job_id: string | null;
  cancel_requested: boolean | null;
};
export const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
