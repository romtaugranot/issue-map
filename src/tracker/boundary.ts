/** What leaves the machine: a Tracker's CLI, and anonymous HTTPS probes. Adapters reach Trackers only through these. */
import { execFile } from "node:child_process";

export type CliResult =
  | { kind: "exited"; code: number; stdout: string; stderr: string }
  | { kind: "missing" };

export type Cli = (command: string, args: string[]) => Promise<CliResult>;

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

/** A JSON object, or `null` for anything else. */
export function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const processCli: Cli = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") return resolve({ kind: "missing" });
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
