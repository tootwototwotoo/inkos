import { ProxyAgent, setGlobalDispatcher, Agent } from "undici";

type ProxyEnv = Record<string, string | undefined>;
type FetchInitWithDispatcher = RequestInit & { dispatcher?: unknown };

export function resolveProxyUrl(explicitProxyUrl?: string, env: ProxyEnv = process.env): string | undefined {
  const candidate = [
    explicitProxyUrl,
    env.INKOS_LLM_PROXY_URL,
    env.HTTPS_PROXY,
    env.https_proxy,
    env.HTTP_PROXY,
    env.http_proxy,
  ].find((value) => typeof value === "string" && value.trim().length > 0)?.trim();

  if (!candidate) return undefined;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported proxy protocol: ${parsed.protocol}`);
  }
  return candidate;
}

export function buildProxyFetchInit(
  init: RequestInit = {},
  explicitProxyUrl?: string,
  env: ProxyEnv = process.env,
): FetchInitWithDispatcher {
  const proxyUrl = resolveProxyUrl(explicitProxyUrl, env);
  if (!proxyUrl) return init;
  return {
    ...init,
    dispatcher: new ProxyAgent(proxyUrl),
  };
}

export function fetchWithProxy(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  explicitProxyUrl?: string,
  env: ProxyEnv = process.env,
): ReturnType<typeof fetch> {
  return fetch(input, buildProxyFetchInit(init, explicitProxyUrl, env));
}

/**
 * 当前已生效的全局代理 URL。用模块级变量跟踪,避免重复 setGlobalDispatcher。
 * 设置全局 dispatcher 后,进程内所有 fetch(包括 pi-ai SDK 内部、封面生成的裸 fetch)
 * 都会自动走代理,无需逐个传 proxyUrl。
 */
let appliedProxyUrl: string | undefined;

/**
 * 设置全局代理 dispatcher。当 proxyUrl 有值时,所有 fetch 调用(包括 pi-ai SDK 内部
 * 的 fetch、封面生成的裸 fetch)都自动走代理。传 undefined/空值时恢复默认 dispatcher。
 *
 * 用 setGlobalDispatcher 而非逐个传参,是因为 pi-ai 的 StreamOptions 不支持 fetch/dispatcher
 * 覆盖,只能通过全局 dispatcher 影响 pi-ai SDK 内部的 fetch 调用。
 */
export function applyGlobalProxy(proxyUrl?: string): void {
  const resolved = resolveProxyUrl(proxyUrl);
  if (resolved === appliedProxyUrl) return;
  if (!resolved) {
    setGlobalDispatcher(new Agent());
    appliedProxyUrl = undefined;
    return;
  }
  setGlobalDispatcher(new ProxyAgent(resolved));
  appliedProxyUrl = resolved;
}
