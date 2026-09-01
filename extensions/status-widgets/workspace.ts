// workspace, GitHub 계정, provider quota를 aboveEditor widget 한 줄로 표시한다.

import { execFile } from "node:child_process";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "status-widgets:workspace";
const configuredInterval = Number(process.env.PI_WORKSPACE_STATUS_INTERVAL_MS);
const INTERVAL_MS = Number.isFinite(configuredInterval) && configuredInterval >= 2_000
  ? configuredInterval
  : 5_000;

const ICONS = {
  cwd: "",
  branch: "",
  fiveHour: "󱎖",
  calendar: "",
  clock: "",
  money: "",
} as const;

export interface ProviderQuota {
  label: string;
  utilization: number;
  resetsAt: number;
}

export interface WorkspaceProviderStatus {
  subscription?: string;
  quotas?: ProviderQuota[];
  monthlyCredits?: {
    used: number;
    limit: number;
    resetsAt?: number;
  };
  balance?: string;
  balanceLevel?: "success" | "warning" | "error";
}

interface GitStatus {
  branch: string;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
  ahead: number;
  behind: number;
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 3_000,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function parseGitStatus(output: string): GitStatus {
  const status: GitStatus = {
    branch: "",
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
    ahead: 0,
    behind: 0,
  };
  let oid = "";

  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.head ")) status.branch = line.slice(14).trim();
    else if (line.startsWith("# branch.oid ")) oid = line.slice(13).trim();
    else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (line.startsWith("? ")) {
      status.untracked += 1;
    } else if (line.startsWith("u ")) {
      status.conflicted += 1;
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const xy = line.split(" ", 3)[1] || "..";
      if (xy[0] && xy[0] !== ".") status.staged += 1;
      if (xy[1] && xy[1] !== ".") status.modified += 1;
    }
  }

  if (!status.branch || status.branch === "(detached)") {
    status.branch = oid && oid !== "(initial)" ? oid.slice(0, 7) : "detached";
  }
  return status;
}

async function readGitStatus(cwd: string): Promise<GitStatus | undefined> {
  try {
    return parseGitStatus(await runCommand("git", [
      "-C",
      cwd,
      "status",
      "--porcelain=v2",
      "--branch",
      "--untracked-files=normal",
    ]));
  } catch {
    return undefined;
  }
}

async function readGithubAccount(): Promise<string | undefined> {
  try {
    return (await runCommand("gh", ["api", "user", "--jq", ".login"])).trim() || undefined;
  } catch {
    return undefined;
  }
}

function isDirty(status: GitStatus): boolean {
  return status.staged + status.modified + status.untracked + status.conflicted > 0;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

function quotaIcon(label: string): string {
  if (label === "5h") return ICONS.fiveHour;
  if (label.endsWith("d")) return ICONS.calendar;
  return ICONS.clock;
}

function formatCredits(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export default function registerWorkspaceStatus(pi: ExtensionAPI): (status?: WorkspaceProviderStatus) => void {
  let cwd = process.cwd();
  let gitStatus: GitStatus | undefined;
  let githubAccount: string | undefined;
  let githubAccountLoaded = false;
  let currentProvider = "no-provider";
  let providerStatus: WorkspaceProviderStatus = {};
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestRender: (() => void) | undefined;
  let disposed = true;
  let refreshing = false;
  let refreshQueued = false;

  async function refresh(): Promise<void> {
    if (disposed) return;
    if (refreshing) {
      refreshQueued = true;
      return;
    }

    refreshing = true;
    const runGeneration = generation;
    const refreshCwd = cwd;
    const shouldReadAccount = !githubAccountLoaded;
    try {
      const [nextGitStatus, nextGithubAccount] = await Promise.all([
        readGitStatus(refreshCwd),
        shouldReadAccount ? readGithubAccount() : Promise.resolve(githubAccount),
      ]);
      if (!disposed && generation === runGeneration) {
        gitStatus = nextGitStatus;
        if (shouldReadAccount) {
          githubAccount = nextGithubAccount;
          githubAccountLoaded = true;
        }
        requestRender?.();
      }
    } finally {
      refreshing = false;
      if (refreshQueued && !disposed) {
        refreshQueued = false;
        void refresh();
      }
    }
  }

  function scheduleRefresh(delayMs = 250): void {
    if (disposed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void refresh();
    }, delayMs);
    debounceTimer.unref?.();
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    generation += 1;
    disposed = false;
    cwd = ctx.cwd;
    gitStatus = undefined;
    githubAccount = undefined;
    githubAccountLoaded = false;
    currentProvider = ctx.model?.provider || "no-provider";
    providerStatus = {};

    ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
      requestRender = () => tui.requestRender();
      return {
        dispose() {
          requestRender = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          const separator = theme.fg("dim", " · ");
          const leftParts = [theme.fg("accent", `${ICONS.cwd}  ${basename(cwd) || cwd}`)];
          if (gitStatus) {
            const branch = `${gitStatus.branch}${isDirty(gitStatus) ? "*" : ""}`;
            leftParts.push(`${theme.fg("accent", ICONS.branch)} ${theme.fg("text", branch)}`);
          }
          if (githubAccount) leftParts.push(theme.fg("muted", githubAccount));

          const quotaParts = (providerStatus.quotas ?? []).map((quota) => {
            const percent = `${Math.round(quota.utilization * 100)}%`;
            const level = quota.utilization >= 0.95 ? "error" : quota.utilization >= 0.85 ? "warning" : "success";
            return `${theme.fg(level, percent)} ${theme.fg("accent", quotaIcon(quota.label))} ${theme.fg("muted", formatDuration(quota.resetsAt - Date.now()))}`;
          });
          const monthly = providerStatus.monthlyCredits;
          if (monthly && Number.isFinite(monthly.used) && Number.isFinite(monthly.limit) && monthly.limit > 0) {
            const utilization = monthly.used / monthly.limit;
            const level = utilization >= 0.95 ? "error" : utilization >= 0.85 ? "warning" : "success";
            quotaParts.push(theme.fg(level, `${formatCredits(monthly.used)}/${formatCredits(monthly.limit)} cr`));
          }
          if (providerStatus.balance) {
            quotaParts.push(
              `${theme.fg("accent", ICONS.money)} ${theme.fg(providerStatus.balanceLevel ?? "success", providerStatus.balance)}`,
            );
          }

          const providerLabel = providerStatus.subscription
            ? `${currentProvider} ${separator}${providerStatus.subscription}`
            : currentProvider;
          const rightGroups = [
            ...quotaParts,
            theme.fg("muted", providerLabel),
          ];

          let left = leftParts.join(separator);
          const right = rightGroups.join(separator);
          const rightWidth = visibleWidth(right);
          if (visibleWidth(left) + 2 + rightWidth > width) {
            left = truncateToWidth(left, Math.max(0, width - rightWidth - 2), "…");
          }
          const padding = " ".repeat(Math.max(2, width - visibleWidth(left) - rightWidth));
          return [truncateToWidth(left + padding + right, width, "")];
        },
      };
    }, { placement: "aboveEditor" });

    void refresh();
    timer = setInterval(() => void refresh(), INTERVAL_MS);
    timer.unref?.();
  });

  pi.on("model_select", (event) => {
    currentProvider = event.model.provider;
    providerStatus = {};
    requestRender?.();
  });

  pi.on("tool_result", () => scheduleRefresh());
  pi.on("agent_settled", () => scheduleRefresh(0));

  pi.on("session_shutdown", (_event, ctx) => {
    generation += 1;
    disposed = true;
    if (timer) clearInterval(timer);
    if (debounceTimer) clearTimeout(debounceTimer);
    timer = undefined;
    debounceTimer = undefined;
    requestRender = undefined;
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
  });

  return (status: WorkspaceProviderStatus = {}) => {
    providerStatus = status;
    requestRender?.();
  };
}
