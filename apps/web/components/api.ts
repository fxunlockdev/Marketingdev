// Coalesce only concurrent reads. Never cache credentials or completed API responses.
const reads=new Map<string,Promise<unknown>>();
export function api<T=any>(path:string,body?:unknown,method=body===undefined?'GET':'POST',key?:string):Promise<T>{
 if(method==='GET'&&body===undefined){const existing=reads.get(path);if(existing)return existing as Promise<T>;
  const pending=request<T>(path,body,method,key);reads.set(path,pending);
  const clear=()=>{if(reads.get(path)===pending)reads.delete(path);};void pending.then(clear,clear);return pending;
 }
 reads.clear();return request<T>(path,body,method,key).then(value=>{
  reads.clear();
  if(typeof window!=='undefined'&&(/\/businesses(?:\/[^/]+)?$/.test(path)||path.includes('/brain/approve')||path==='/api/auth/update-user'||path.includes('/members')||path.includes('/invitations')))window.dispatchEvent(new Event('desvio-workspace-changed'));
  return value;
 });
}
export class ApiError extends Error {
  readonly status:number;
  readonly reauthenticate:boolean;
  constructor(
    status: number,
    message: string,
    reauthenticate = false,
  ) {
    super(message);
    this.status=status;this.reauthenticate=reauthenticate;
  }
}
async function request<T = any>(
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
        ? path.startsWith("/api/auth/two-factor/")
          ? "This verification was not accepted. Check your code or sign in again."
          : path.startsWith("/api/auth/")
          ? "Email or password was not accepted. Check your details and try again."
          : "Your session has ended. Sign in again to continue."
        : response.status === 429
          ? data.code === "ACCOUNT_TEMPORARILY_LOCKED"
            ? "Too many incorrect verification attempts. Wait 15 minutes, then sign in again."
            : "Too many requests. Wait a moment before trying again."
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
