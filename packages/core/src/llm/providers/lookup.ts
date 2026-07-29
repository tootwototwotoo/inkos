import type { InkosModel } from "./types.js";
import { getAllEndpoints, getEndpoint } from "./index.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * provider id 优先级。Layer 2 全局扫时同 id 多条匹配按这个顺序取第一条，
 * 保证结果确定性。白名单外的 provider 视同 999（排最后）。
 */
const PROVIDER_PRIORITY: readonly string[] = [
  "anthropic", "openai", "google", "deepseek", "bailian", "moonshot", "kimicode",
  "zhipu", "minimax", "xai",
  "siliconcloud",
  "openrouter", "aihubmix", "novita",
];

/**
 * 两层 lookup：
 * - Layer 1: 已知 provider 精确查（整串比较，不拆斜线）
 * - Layer 2: 全局扫所有 provider 的 models，按 provider id 优先级取第一条
 * - 都 miss: 返回 undefined，调用方走保守默认
 *
 * 不做斜线前缀拆分。lobe 的 processModelList 证实了"靠调用入口带 provider 消歧"
 * 是对的做法，斜线拆分对 PPIO / SiliconCloud 原生命名会误匹配。
 */
export function lookupModel(
  serviceId: string,
  modelId: string,
): InkosModel | undefined {
  const lowerId = modelId.toLowerCase();

  const provider = getEndpoint(serviceId);
  if (provider) {
    const hit = provider.models.find((m) => m.id.toLowerCase() === lowerId);
    if (hit) return hit;
  }

  const matches: Array<{ model: InkosModel; providerId: string }> = [];
  for (const p of getAllEndpoints()) {
    const hit = p.models.find((m) => m.id.toLowerCase() === lowerId);
    if (hit) matches.push({ model: hit, providerId: p.id });
  }
  if (matches.length === 0) return undefined;

  matches.sort((a, b) => {
    const ai = PROVIDER_PRIORITY.indexOf(a.providerId);
    const bi = PROVIDER_PRIORITY.indexOf(b.providerId);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return matches[0].model;
}

/** 某 service 下可用（enabled !== false）的模型列表 */
export function listEnabledModels(serviceId: string): InkosModel[] {
  const provider = getEndpoint(serviceId);
  if (!provider) return [];
  return provider.models.filter((m) => m.enabled !== false);
}

export function isActiveTextModel(model: InkosModel): boolean {
  if (model.enabled === false) return false;
  if (model.status === "disabled" || model.status === "deprecated" || model.status === "nonText") return false;
  if (model.capabilities?.text === false) return false;
  if (model.capabilities?.imageOutput === true && model.capabilities?.text !== true) return false;
  return true;
}

export function listActiveTextModels(serviceId: string): InkosModel[] {
  const provider = getEndpoint(serviceId);
  if (!provider) return [];
  return provider.models.filter(isActiveTextModel);
}

/**
 * 用户在 provider 配置界面为某模型填写的参数(上下文窗口 / 最大输出)。
 * 从 inkos.json 的 llm.services[<service>].models.extra[] 读取,
 * 与 studio 的 service key 匹配逻辑一致(custom:name 或 provider id)。
 *
 * 同步实现(readFileSync):config 读取很快,且避免把 createLLMClient 改成 async。
 * 读不到 / 文件不存在 / 解析失败时返回 undefined,调用方走默认回退。
 */
export function resolveUserModelCard(
  projectRoot: string | undefined,
  service: string,
  modelId: string,
): { contextWindowTokens?: number; maxOutput?: number } | undefined {
  if (!projectRoot) return undefined;
  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, "inkos.json"), "utf-8");
  } catch {
    return undefined;
  }
  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const llm = (config as Record<string, unknown> | null)?.llm as Record<string, unknown> | undefined;
  if (!llm || !Array.isArray(llm.services)) return undefined;

  const lowerId = modelId.toLowerCase();
  for (const entry of llm.services) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const sid = typeof e.service === "string" ? e.service : "";
    const name = typeof e.name === "string" ? e.name : "";
    // service key 匹配:custom:name 或 provider id
    const key = sid === "custom" ? `custom:${name || "Custom"}` : sid;
    if (key !== service && sid !== service) continue;

    const models = e.models as Record<string, unknown> | undefined;
    if (!models || !Array.isArray(models.extra)) continue;
    for (const ex of models.extra) {
      if (!ex || typeof ex !== "object") continue;
      const x = ex as Record<string, unknown>;
      if (typeof x.id !== "string" || x.id.toLowerCase() !== lowerId) continue;
      const result: { contextWindowTokens?: number; maxOutput?: number } = {};
      if (typeof x.contextWindowTokens === "number" && x.contextWindowTokens > 0) {
        result.contextWindowTokens = x.contextWindowTokens;
      }
      if (typeof x.maxOutput === "number" && x.maxOutput > 0) {
        result.maxOutput = x.maxOutput;
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }
  }
  return undefined;
}
