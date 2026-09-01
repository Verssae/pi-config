// Provider quota와 세션 사용량을 중복 없는 맞춤 footer로 통합한다.
// 다른 extension의 status는 두 번째 줄에 모두 보존한다.

import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { WorkspaceProviderStatus } from "./workspace.ts";

const BASE_URL = (process.env.MERIDIAN_BASE_URL || "http://127.0.0.1:3456").replace(/\/+$/, "");
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
const configuredInterval = Number(process.env.MERIDIAN_USAGE_INTERVAL_MS);
const INTERVAL_MS = Number.isFinite(configuredInterval) && configuredInterval >= 10_000
  ? configuredInterval
  : 60_000;
// Nerd Font glyphs (Stork Mono Nerd Font / Maple Mono Nerd Font compatible).
const ICONS = {
  cache: "",
  context: "",
  model: "󰧑",
  thinking: "",
  money: "",
} as const;

interface Bucket {
  type: string;
  utilization: number;
  resetsAt: number;
}

interface MeridianQuotaResponse {
  buckets?: Bucket[];
}

interface MeridianHealthResponse {
  auth?: {
    loggedIn?: boolean;
    subscriptionType?: string;
  };
}

interface CodexWindow {
  used_percent: number;
  limit_window_seconds: number;
  reset_at: number;
}

type NumericValue = string | number | null;

interface CodexIndividualLimit {
  limit?: NumericValue;
  used?: NumericValue;
  remaining?: NumericValue;
  remaining_percent?: NumericValue;
  reset_at?: NumericValue;
}

interface CodexSpendControl {
  individual_limit?: CodexIndividualLimit | null;
}

interface CodexUsageResponse {
  plan_type?: string;
  rate_limit?: {
    primary_window?: CodexWindow | null;
    secondary_window?: CodexWindow | null;
  };
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: NumericValue;
  };
  spend_control?: CodexSpendControl;
  usage?: { spend_control?: CodexSpendControl };
}

interface CodexMonthlyUsageResponse {
  current_month_usage?: NumericValue;
  effective_monthly_limit?: NumericValue | { limit?: NumericValue; reset_at?: NumericValue };
  reset_at?: NumericValue;
}

interface MonthlyCreditUsage {
  used: number;
  limit: number;
  resetsAt?: number;
}

interface CodexUsageResult {
  buckets: Bucket[];
  subscription?: string;
  creditBalance?: string;
  creditsUnlimited?: boolean;
  monthlyCredits?: MonthlyCreditUsage;
}

interface DeepseekBalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

interface DeepseekBalanceResponse {
  is_available?: boolean;
  balance_infos?: DeepseekBalanceInfo[];
}

interface OpenRouterCreditsResponse {
  data?: {
    total_credits?: NumericValue;
    total_usage?: NumericValue;
  };
}

interface OpenRouterCredits {
  remaining: number;
  total: number;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  JPY: "¥",
  KRW: "₩",
};

function isClaudeModel(model: ExtensionContext["model"]): boolean {
  return model?.provider === "anthropic" && model.id.toLowerCase().startsWith("claude-");
}

function isCodexModel(model: ExtensionContext["model"]): boolean {
  return model?.provider === "openai-codex";
}

function isDeepseekModel(model: ExtensionContext["model"]): boolean {
  return model?.provider === "deepseek";
}

function isOpenrouterModel(model: ExtensionContext["model"]): boolean {
  return model?.provider === "openrouter";
}

function isUsageModel(model: ExtensionContext["model"]): boolean {
  return isClaudeModel(model) || isCodexModel(model) || isDeepseekModel(model) || isOpenrouterModel(model);
}

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function formatWindowLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes === 300) return "5h";
  if (minutes === 1_440) return "1d";
  if (minutes === 10_080) return "7d";
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function colorContext(percent: number | null | undefined, text: string, ctx: ExtensionContext): string {
  if ((percent ?? 0) > 90) return ctx.ui.theme.fg("error", text);
  if ((percent ?? 0) > 70) return ctx.ui.theme.fg("warning", text);
  return ctx.ui.theme.fg("success", text);
}

function colorThinking(level: string, text: string, ctx: ExtensionContext): string {
  switch (level) {
    case "minimal": return ctx.ui.theme.fg("thinkingMinimal", text);
    case "low": return ctx.ui.theme.fg("thinkingLow", text);
    case "medium": return ctx.ui.theme.fg("thinkingMedium", text);
    case "high": return ctx.ui.theme.fg("thinkingHigh", text);
    case "xhigh": return ctx.ui.theme.fg("thinkingXhigh", text);
    case "max": return ctx.ui.theme.fg("thinkingMax", text);
    default: return ctx.ui.theme.fg("thinkingOff", text);
  }
}

function addUsage(totals: Usage, usage: Usage): void {
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.totalTokens += usage.totalTokens;
  totals.cost.input += usage.cost.input;
  totals.cost.output += usage.cost.output;
  totals.cost.cacheRead += usage.cost.cacheRead;
  totals.cost.cacheWrite += usage.cost.cacheWrite;
  totals.cost.total += usage.cost.total;
}

function getUsage(ctx: ExtensionContext): { totals: Usage; latestCacheHitRate?: number } {
  const totals: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  let latestCacheHitRate: number | undefined;

  for (const entry of ctx.sessionManager.getEntries()) {
    let usage: Usage | undefined;
    if (entry.type === "message" && entry.message.role === "assistant") {
      usage = entry.message.usage;
      const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
      latestCacheHitRate = promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
    } else if (entry.type === "message" && entry.message.role === "toolResult") {
      usage = entry.message.usage;
    } else if (entry.type === "branch_summary" || entry.type === "compaction") {
      usage = entry.usage;
    }
    if (usage) addUsage(totals, usage);
  }

  return { totals, latestCacheHitRate };
}

async function fetchMeridianUsage(signal: AbortSignal): Promise<MeridianQuotaResponse | undefined> {
  try {
    const response = await fetch(`${BASE_URL}/v1/usage/quota`, { signal });
    if (!response.ok) return undefined;
    return (await response.json()) as MeridianQuotaResponse;
  } catch {
    return undefined;
  }
}

function formatSubscription(value: string | undefined): string | undefined {
  const subscription = value?.trim();
  if (!subscription) return undefined;
  return subscription
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

async function fetchMeridianSubscription(signal: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(`${BASE_URL}/health`, { signal });
    if (!response.ok) return undefined;
    const data = (await response.json()) as MeridianHealthResponse;
    const subscription = data.auth?.loggedIn ? data.auth.subscriptionType : undefined;
    return formatSubscription(subscription);
  } catch {
    return undefined;
  }
}

function getCodexAccountId(accessToken: string): string | undefined {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return undefined;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

function finiteNumber(value: NumericValue | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function timestampMs(value: NumericValue | undefined): number | undefined {
  if (typeof value === "string" && /\D/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const number = finiteNumber(value);
  if (number === undefined) return undefined;
  return number < 10_000_000_000 ? number * 1_000 : number;
}

function parseIndividualLimit(limit: CodexIndividualLimit | null | undefined): MonthlyCreditUsage | undefined {
  const total = finiteNumber(limit?.limit);
  if (total === undefined || total <= 0) return undefined;

  let used = finiteNumber(limit?.used);
  const remaining = finiteNumber(limit?.remaining);
  const remainingPercent = finiteNumber(limit?.remaining_percent);
  if (used === undefined && remaining !== undefined) used = total - remaining;
  if (used === undefined && remainingPercent !== undefined) used = total * (1 - remainingPercent / 100);
  if (used === undefined) return undefined;

  return { used: Math.max(0, used), limit: total, resetsAt: timestampMs(limit?.reset_at) };
}

function parseMonthlyUsage(data: CodexMonthlyUsageResponse): MonthlyCreditUsage | undefined {
  const rawLimit = data.effective_monthly_limit;
  const limit = finiteNumber(typeof rawLimit === "object" && rawLimit !== null ? rawLimit.limit : rawLimit);
  const used = finiteNumber(data.current_month_usage);
  if (limit === undefined || limit <= 0 || used === undefined) return undefined;
  const reset = typeof rawLimit === "object" && rawLimit !== null ? rawLimit.reset_at : undefined;
  return { used: Math.max(0, used), limit, resetsAt: timestampMs(data.reset_at ?? reset) };
}

async function fetchDeepseekBalance(
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<DeepseekBalanceResponse | undefined> {
  try {
    const auth = await ctx.modelRegistry.getProviderAuth("deepseek");
    const apiKey = auth?.auth.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return undefined;

    const response = await fetch(`${DEEPSEEK_BASE_URL}/user/balance`, {
      signal,
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    });
    if (!response.ok) return undefined;
    return (await response.json()) as DeepseekBalanceResponse;
  } catch {
    return undefined;
  }
}

async function fetchOpenRouterCredits(
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<OpenRouterCredits | undefined> {
  try {
    const auth = await ctx.modelRegistry.getProviderAuth("openrouter");
    const apiKey = auth?.auth.apiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) return undefined;

    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      signal,
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as OpenRouterCreditsResponse;
    const total = finiteNumber(data.data?.total_credits);
    const used = finiteNumber(data.data?.total_usage);
    if (total === undefined || used === undefined) return undefined;
    return { remaining: Math.max(0, total - used), total };
  } catch {
    return undefined;
  }
}

async function fetchCodexUsage(
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<CodexUsageResult | undefined> {
  try {
    const auth = await ctx.modelRegistry.getProviderAuth("openai-codex");
    const accessToken = auth?.auth.apiKey;
    if (!accessToken) return undefined;
    const accountId = getCodexAccountId(accessToken);
    if (!accountId) return undefined;

    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      signal,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "chatgpt-account-id": accountId,
        accept: "application/json",
      },
    });
    if (!response.ok) return undefined;

    const data = (await response.json()) as CodexUsageResponse;
    const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window]
      .filter((window): window is CodexWindow => Boolean(window));
    const rawBalance = data.credits?.balance;
    const balance = rawBalance === null || rawBalance === undefined ? undefined : Number(rawBalance);
    let monthlyCredits = parseIndividualLimit(
      data.spend_control?.individual_limit ?? data.usage?.spend_control?.individual_limit,
    );

    if (!monthlyCredits) {
      const monthlyResponse = await fetch(
        `https://chatgpt.com/backend-api/accounts/${encodeURIComponent(accountId)}/spend-controls/current-user/monthly-usage`,
        { signal, headers: {
          authorization: `Bearer ${accessToken}`,
          "chatgpt-account-id": accountId,
          accept: "application/json",
        } },
      );
      if (monthlyResponse.ok) {
        monthlyCredits = parseMonthlyUsage(await monthlyResponse.json() as CodexMonthlyUsageResponse);
      }
    }

    return {
      buckets: windows.map((window) => ({
        type: formatWindowLabel(window.limit_window_seconds),
        utilization: window.used_percent / 100,
        resetsAt: window.reset_at * 1_000,
      })),
      subscription: formatSubscription(data.plan_type),
      creditBalance: data.credits?.has_credits && Number.isFinite(balance)
        ? `$${balance!.toFixed(2)}`
        : undefined,
      creditsUnlimited: data.credits?.has_credits && data.credits.unlimited === true,
      monthlyCredits,
    };
  } catch {
    return undefined;
  }
}

export default function (
  pi: ExtensionAPI,
  setWorkspaceProviderStatus: (status?: WorkspaceProviderStatus) => void = () => {},
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let generation = 0;
  let refreshController: AbortController | undefined;
  let meridianBuckets = new Map<string, Bucket>();
  let codexBuckets: Bucket[] = [];
  let codexCreditBalance: string | undefined;
  let codexCreditsUnlimited = false;
  let codexMonthlyCredits: MonthlyCreditUsage | undefined;
  let deepseekBalance: DeepseekBalanceResponse | undefined;
  let openRouterCredits: OpenRouterCredits | undefined;
  let currentModel: ExtensionContext["model"];
  let currentThinking = "off";
  let currentSubscription: string | undefined;
  let requestRender: (() => void) | undefined;

  function setSubscription(subscription?: string): void {
    currentSubscription = subscription;
    const status: WorkspaceProviderStatus = { subscription };

    if (isClaudeModel(currentModel)) {
      status.quotas = [
        { label: "5h", bucket: meridianBuckets.get("five_hour") },
        { label: "7d", bucket: meridianBuckets.get("seven_day") },
      ].filter((item): item is { label: string; bucket: Bucket } => (
        Boolean(item.bucket) && Number.isFinite(item.bucket?.utilization) && Number.isFinite(item.bucket?.resetsAt)
      )).map(({ label, bucket }) => ({ label, utilization: bucket.utilization, resetsAt: bucket.resetsAt }));
    } else if (isCodexModel(currentModel)) {
      status.quotas = codexBuckets
        .filter((bucket) => Number.isFinite(bucket.utilization) && Number.isFinite(bucket.resetsAt))
        .map((bucket) => ({
          label: bucket.type,
          utilization: bucket.utilization,
          resetsAt: bucket.resetsAt,
        }));
      status.monthlyCredits = codexMonthlyCredits;
      status.balance = codexCreditsUnlimited ? "$∞" : codexCreditBalance;
      if (status.balance) status.balanceLevel = "success";
    } else if (isOpenrouterModel(currentModel)) {
      if (openRouterCredits) {
        status.balance = `$${openRouterCredits.remaining.toFixed(2)}`;
        status.balanceLevel = openRouterCredits.remaining <= 0
          ? "error"
          : openRouterCredits.remaining < 5
          ? "warning"
          : "success";
      }
    } else if (isDeepseekModel(currentModel)) {
      const balances = (deepseekBalance?.balance_infos ?? [])
        .map((info) => ({ info, amount: Number(info.total_balance) }))
        .filter(({ amount }) => Number.isFinite(amount));
      if (balances.length > 0) {
        status.balance = balances.map(({ info, amount }) => {
          const symbol = CURRENCY_SYMBOLS[info.currency.toUpperCase()] || `${info.currency} `;
          return `${symbol}${amount.toFixed(2)}`;
        }).join(" · ");
        const minimum = Math.min(...balances.map(({ amount }) => amount));
        status.balanceLevel = minimum <= 0 ? "error" : minimum < 1 ? "warning" : "success";
      }
    }

    setWorkspaceProviderStatus(status);
  }

  async function refresh(ctx: ExtensionContext): Promise<void> {
    if (
      disposed || refreshController || !isUsageModel(currentModel)
    ) return;
    const runGeneration = generation;
    const controller = new AbortController();
    refreshController = controller;
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const isCurrent = () => !disposed && generation === runGeneration;
    try {
      if (isClaudeModel(currentModel)) {
        const [data, subscription] = await Promise.all([
          fetchMeridianUsage(controller.signal),
          fetchMeridianSubscription(controller.signal),
        ]);
        if (isCurrent()) {
          if (data?.buckets) meridianBuckets = new Map(data.buckets.map((bucket) => [bucket.type, bucket]));
          setSubscription(subscription);
          requestRender?.();
        }
      } else if (isCodexModel(currentModel)) {
        const data = await fetchCodexUsage(ctx, controller.signal);
        if (isCurrent() && data) {
          codexBuckets = data.buckets;
          codexCreditBalance = data.creditBalance;
          codexCreditsUnlimited = data.creditsUnlimited === true;
          codexMonthlyCredits = data.monthlyCredits;
          setSubscription(data.subscription);
          requestRender?.();
        }
      } else if (isOpenrouterModel(currentModel)) {
        const data = await fetchOpenRouterCredits(ctx, controller.signal);
        if (isCurrent()) {
          openRouterCredits = data;
          setSubscription(undefined);
          requestRender?.();
        }
      } else if (isDeepseekModel(currentModel)) {
        const data = await fetchDeepseekBalance(ctx, controller.signal);
        if (isCurrent() && data) {
          deepseekBalance = data;
          setSubscription(undefined);
          requestRender?.();
        }
      }
    } finally {
      clearTimeout(timeout);
      if (refreshController === controller) refreshController = undefined;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    generation += 1;
    refreshController?.abort();
    refreshController = undefined;
    disposed = false;
    currentModel = ctx.model;
    currentThinking = ctx.thinkingLevel || "off";
    meridianBuckets = new Map();
    codexBuckets = [];
    codexCreditBalance = undefined;
    codexCreditsUnlimited = false;
    codexMonthlyCredits = undefined;
    deepseekBalance = undefined;
    openRouterCredits = undefined;
    setSubscription(undefined);

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      return {
        dispose() {
          requestRender = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          const separator = theme.fg("dim", " · ");
          const { totals, latestCacheHitRate } = getUsage(ctx);
          const leftParts: string[] = [];

          if (totals.input) leftParts.push(`↑${formatTokens(totals.input)}`);
          if (totals.output) leftParts.push(`↓${formatTokens(totals.output)}`);
          if (totals.cacheRead) leftParts.push(`R${formatTokens(totals.cacheRead)}`);
          if (totals.cacheWrite) leftParts.push(`W${formatTokens(totals.cacheWrite)}`);
          if ((totals.cacheRead || totals.cacheWrite) && latestCacheHitRate !== undefined) {
            leftParts.push(`${theme.fg("accent", ICONS.cache)} ${theme.fg("success", `${latestCacheHitRate.toFixed(1)}%`)}`);
          }

          const context = ctx.getContextUsage();
          const contextWindow = context?.contextWindow ?? currentModel?.contextWindow ?? 0;
          const contextValue = context?.percent === null || context?.percent === undefined
            ? `?/${formatTokens(contextWindow)}`
            : `${context.percent.toFixed(1)}%/${formatTokens(contextWindow)}`;
          leftParts.push(`${theme.fg("accent", ICONS.context)} ${colorContext(context?.percent, contextValue, ctx)}`);

          let left = leftParts.join(separator);
          const modelName = currentModel?.id || "no-model";
          let right = `${theme.fg("accent", ICONS.model)} ${theme.fg("text", modelName)}`;
          if (currentModel?.reasoning) {
            const thinking = `${ICONS.thinking} ${currentThinking}`;
            right += `${separator}${colorThinking(currentThinking, thinking, ctx)}`;
          }

          const rightWidth = visibleWidth(right);
          if (visibleWidth(left) + 2 + rightWidth > width) {
            left = truncateToWidth(left, Math.max(0, width - rightWidth - 2), "...");
          }
          const padding = " ".repeat(Math.max(2, width - visibleWidth(left) - rightWidth));
          const lines = [truncateToWidth(left + padding + right, width, "")];

          const statuses = [...footerData.getExtensionStatuses().entries()]
            .filter(([, value]) => Boolean(value))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, value]) => sanitizeStatusText(value));
          if (statuses.length > 0) {
            lines.push(truncateToWidth(statuses.join(" "), width, theme.fg("dim", "...")));
          }
          return lines;
        },
      };
    });

    void refresh(ctx);
    timer = setInterval(() => void refresh(ctx), INTERVAL_MS);
    timer.unref?.();
  });

  pi.on("model_select", (event, ctx) => {
    currentModel = event.model;
    meridianBuckets = new Map();
    codexBuckets = [];
    codexCreditBalance = undefined;
    codexCreditsUnlimited = false;
    codexMonthlyCredits = undefined;
    deepseekBalance = undefined;
    openRouterCredits = undefined;
    setSubscription(undefined);
    requestRender?.();
    if (isUsageModel(currentModel)) {
      void refresh(ctx);
    }
  });

  pi.on("thinking_level_select", (event) => {
    currentThinking = event.level;
    requestRender?.();
  });

  pi.on("agent_settled", (_event, ctx) => {
    requestRender?.();
    if (
      ctx.mode === "tui" && isUsageModel(currentModel)
    ) {
      void refresh(ctx);
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    generation += 1;
    disposed = true;
    refreshController?.abort();
    refreshController = undefined;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    requestRender = undefined;
    setSubscription(undefined);
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
}
