/**
 * Herdr surface layer.
 *
 * All terminal operations used by the subagent runtime are isolated here:
 * create a sibling pane, submit a command, read output, close the pane, and
 * poll for the child process sentinel. Pane IDs are Herdr's opaque public IDs
 * (for example `w1:p2`).
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);
let herdrAvailable: boolean | undefined;

function hasHerdr(): boolean {
  if (herdrAvailable !== undefined) return herdrAvailable;
  try {
    execFileSync("herdr", ["--version"], { stdio: "ignore" });
    herdrAvailable = true;
  } catch {
    herdrAvailable = false;
  }
  return herdrAvailable;
}

export function isMuxAvailable(): boolean {
  return (
    process.env.HERDR_ENV === "1" &&
    typeof process.env.HERDR_PANE_ID === "string" &&
    process.env.HERDR_PANE_ID.length > 0 &&
    hasHerdr()
  );
}

export function muxSetupHint(): string {
  return "Start pi inside Herdr so HERDR_ENV and HERDR_PANE_ID are available.";
}

function requireHerdr(): void {
  if (!isMuxAvailable()) {
    throw new Error(`Herdr is required for subagents. ${muxSetupHint()}`);
  }
}

function runHerdr(args: string[]): string {
  requireHerdr();
  try {
    return execFileSync("herdr", args, { encoding: "utf8" });
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const detail = stderr || stdout || error?.message || String(error);
    throw new Error(`herdr ${args.join(" ")} failed: ${detail}`);
  }
}

async function runHerdrAsync(args: string[]): Promise<string> {
  requireHerdr();
  try {
    const { stdout } = await execFileAsync("herdr", args, { encoding: "utf8" });
    return stdout;
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const detail = stderr || stdout || error?.message || String(error);
    throw new Error(`herdr ${args.join(" ")} failed: ${detail}`);
  }
}

function parseJson(output: string, operation: string): any {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Unexpected Herdr ${operation} output: ${output.trim() || "<empty>"}`);
  }
}

export function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function chooseSplitDirection(parentPane: string): "right" | "down" {
  try {
    const payload = parseJson(runHerdr(["pane", "layout", "--pane", parentPane]), "pane layout");
    const panes = payload?.result?.layout?.panes;
    const pane = Array.isArray(panes) ? panes.find((item: any) => item?.pane_id === parentPane) : null;
    const width = Number(pane?.rect?.width ?? 0);
    const height = Number(pane?.rect?.height ?? 0);
    return width >= height * 2 ? "right" : "down";
  } catch {
    return "right";
  }
}

export function createSurface(name: string): string {
  const parentPane = process.env.HERDR_PANE_ID;
  if (!parentPane) throw new Error(`Missing HERDR_PANE_ID. ${muxSetupHint()}`);
  return createSurfaceSplit(name, chooseSplitDirection(parentPane), parentPane);
}

export function createSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  requireHerdr();
  const source = fromSurface ?? process.env.HERDR_PANE_ID;
  if (!source) throw new Error(`Missing source pane. ${muxSetupHint()}`);

  const splitDirection = direction === "up" || direction === "down" ? "down" : "right";
  const payload = parseJson(
    runHerdr([
      "pane",
      "split",
      "--pane",
      source,
      "--direction",
      splitDirection,
      "--cwd",
      process.cwd(),
      "--no-focus",
    ]),
    "pane split",
  );
  const pane = payload?.result?.pane?.pane_id;
  if (typeof pane !== "string" || pane.length === 0) {
    throw new Error(`Herdr pane split did not return a pane ID: ${JSON.stringify(payload)}`);
  }

  // Herdr creates right/down splits. Swap the new and source panes when the
  // caller explicitly requested the opposite side.
  if (direction === "left" || direction === "up") {
    runHerdr(["pane", "swap", "--source-pane", pane, "--target-pane", source]);
  }

  if (name.trim()) {
    try {
      runHerdr(["pane", "rename", pane, name.trim()]);
    } catch {
      // Pane labels are cosmetic and must not make spawning fail.
    }
  }
  return pane;
}

/** Submit text plus Enter to a pane without changing focus. */
export function sendCommand(surface: string, command: string): void {
  runHerdr(["pane", "run", surface, command]);
}

export function sendLongCommand(
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string {
  const scriptPath =
    options?.scriptPath ??
    join(
      tmpdir(),
      "pi-subagent-scripts",
      `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sh`,
    );
  mkdirSync(dirname(scriptPath), { recursive: true });

  const scriptParts = ["#!/bin/bash"];
  if (options?.scriptPreamble) scriptParts.push(options.scriptPreamble.trimEnd());
  scriptParts.push(command);
  writeFileSync(scriptPath, scriptParts.join("\n") + "\n", { mode: 0o755 });
  sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
  return scriptPath;
}

export function readScreen(surface: string, lines = 50): string {
  return runHerdr([
    "pane",
    "read",
    surface,
    "--source",
    "recent-unwrapped",
    "--lines",
    String(Math.max(1, lines)),
  ]);
}

export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  return runHerdrAsync([
    "pane",
    "read",
    surface,
    "--source",
    "recent-unwrapped",
    "--lines",
    String(Math.max(1, lines)),
  ]);
}

export function closeSurface(surface: string): void {
  runHerdr(["pane", "close", surface]);
}

export interface PollResult {
  reason: "done" | "sentinel" | "error";
  exitCode: number;
  errorMessage?: string;
}

function interpretExitSidecar(data: any): PollResult {
  if (data?.type === "error") {
    const errorMessage =
      typeof data.errorMessage === "string" && data.errorMessage.trim() !== ""
        ? data.errorMessage
        : "Subagent exited with stopReason=error (no errorMessage in sidecar).";
    return { reason: "error", exitCode: 1, errorMessage };
  }
  return { reason: "done", exitCode: 0 };
}

export const __pollForExitTest__ = { interpretExitSidecar };

export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    interval: number;
    sessionFile?: string;
    sentinelFile?: string;
    onTick?: (elapsed: number) => void;
  },
): Promise<PollResult> {
  const start = Date.now();

  for (;;) {
    if (signal.aborted) throw new Error("Aborted while waiting for subagent to finish");

    if (options.sessionFile) {
      try {
        const exitFile = `${options.sessionFile}.exit`;
        if (existsSync(exitFile)) {
          const data = JSON.parse(readFileSync(exitFile, "utf8"));
          rmSync(exitFile, { force: true });
          return interpretExitSidecar(data);
        }
      } catch {}
    }

    if (options.sentinelFile) {
      try {
        if (existsSync(options.sentinelFile)) return { reason: "sentinel", exitCode: 0 };
      } catch {}
    }

    try {
      const screen = await readScreenAsync(surface, 5);
      const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
      if (match) return { reason: "sentinel", exitCode: Number.parseInt(match[1], 10) };
    } catch {
      if (options.sessionFile) {
        try {
          const exitFile = `${options.sessionFile}.exit`;
          if (existsSync(exitFile)) {
            const data = JSON.parse(readFileSync(exitFile, "utf8"));
            rmSync(exitFile, { force: true });
            return interpretExitSidecar(data);
          }
        } catch {}
      }
    }

    options.onTick?.(Math.floor((Date.now() - start) / 1000));
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, options.interval);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
