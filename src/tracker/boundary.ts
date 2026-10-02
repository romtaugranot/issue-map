/** What leaves the machine: a Tracker's CLI, and anonymous HTTPS probes. Adapters reach Trackers only through these. */
import { execFile } from "node:child_process";

export type CliResult =
  /** `timedOut`: it hadn't exited after that many seconds, so it was killed and its output dropped. */
  | { kind: "exited"; code: number; stdout: string; stderr: string; timedOut?: number }
  | { kind: "missing" };

/**
 * Runs a Tracker's CLI. `unset` names environment variables it runs
 * without, such as a token issued for another host than the one it's
 * pointed at; `seconds`, how long it may take, `CALL_SECONDS` unless said.
 */
export type Cli = (command: string, args: string[], unset?: string[], seconds?: number) => Promise<CliResult>;

/** How long one CLI call may take before it's killed: generous, so only a hung one is. */
export const CALL_SECONDS = 60;

/** How long a page of a full read may take: on a large Project one can take far longer to answer. */
export const PAGE_SECONDS = 300;

export type HttpResult =
  | { kind: "response"; status: number; headers: Record<string, string>; body: string }
  | { kind: "unreachable"; reason: string };

/** One anonymous GET: never carries a credential. */
export type Http = (url: string) => Promise<HttpResult>;

/** What every adapter is built from. */
export interface AdapterDeps {
  cli: Cli;
  http: Http;
  env: Record<string, string | undefined>;
}

/** Whether a Tracker's version, such as `16.11.2-ee` or `3.19.1`, is `since` or later. */
export function atLeast(version: string, since: string): boolean {
  const [have, want] = [version, since].map((v) => {
    const parts = v.split(/[.-]/);
    return [0, 1, 2].map((i) => Number.parseInt(parts[i] ?? "0", 10) || 0);
  });
  for (let i = 0; i < 3; i++) if (have![i] !== want![i]) return have![i]! > want![i]!;
  return true;
}

/** The host an environment variable names, which may be written as a URL; `null` where it names none. */
export function hostNamed(value: string | undefined): string | null {
  const name = value?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return name || null;
}

/** A JSON object, or `null` for anything else. */
export function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const processCli: Cli = (command, args, unset = [], seconds = CALL_SECONDS) =>
  new Promise((resolve) => {
    const env = { ...process.env };
    for (const name of unset) delete env[name];
    execFile(command, args, { maxBuffer: 64 * 1024 * 1024, env, timeout: seconds * 1000, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") return resolve({ kind: "missing" });
      // Only the timeout kills it.
      if (error?.killed) return resolve({ kind: "exited", code: 1, stdout: "", stderr: "", timedOut: seconds });
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ kind: "exited", code, stdout, stderr });
    });
  });

export const anonymousHttp: Http = async (url) => {
  try {
    const response = await fetch(url, { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(5000) });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => (headers[name.toLowerCase()] = value));
    return { kind: "response", status: response.status, headers, body: await response.text() };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return { kind: "unreachable", reason: cause ?? (error as Error).message };
  }
};
