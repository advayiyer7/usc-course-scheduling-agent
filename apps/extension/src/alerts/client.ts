import {
  alertInbox,
  type AlertInbox,
} from "../../../../packages/contracts/src/alerts.js";

const key = "usc-alert-pairing-v1";
const API = "http://127.0.0.1:3000/api/alerts";
export class AlertHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readAlertToken(): Promise<string | undefined> {
  const token =
    typeof chrome !== "undefined" && chrome.storage?.local
      ? (await chrome.storage.local.get(key))[key]
      : localStorage.getItem(key);
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
    ? token
    : undefined;
}
export async function saveAlertToken(token?: string) {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    if (token) await chrome.storage.local.set({ [key]: token });
    else await chrome.storage.local.remove(key);
  } else if (token) localStorage.setItem(key, token);
  else localStorage.removeItem(key);
}
export async function alertRequest<T = { ok: boolean }>(
  path: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  const value = await response.json();
  if (!response.ok)
    throw new AlertHttpError(
      response.status,
      typeof value.error?.message === "string"
        ? value.error.message
        : "Alert service is unavailable.",
    );
  return value as T;
}
export async function readInbox(token: string): Promise<AlertInbox> {
  return alertInbox.parse(await alertRequest("inbox", token));
}

/** Serialize planner updates so slow requests cannot restore a previous revision. */
export class AlertClient {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly token: string) {}
  write(path: string, body: unknown) {
    const next = this.tail.then(() => alertRequest(path, this.token, body));
    this.tail = next.catch(() => {});
    return next;
  }
  async inbox() {
    await this.tail;
    return readInbox(this.token);
  }
}
