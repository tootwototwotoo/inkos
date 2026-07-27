/**
 * 火山方舟 Agent Plan (豆包编程订阅 - Plan 入口)
 *
 * - 官网：https://www.volcengine.com/product/ark
 * - 订阅入口：https://www.volcengine.com/docs/82379/1925114
 * - Anthropic 协议 baseUrl：https://ark.cn-beijing.volces.com/api/plan
 *
 * 与 volcengineCodingPlan(/api/coding) 同属火山 Coding Plan 订阅，
 * 但走 /api/plan 入口。订阅包内解锁多家主力编程模型（豆包 / MiniMax /
 * GLM / DeepSeek / Kimi），走 Anthropic 兼容协议。
 */
import type { InkosEndpoint } from "../types.js";

export const VOLCENGINE_AGENT_PLAN: InkosEndpoint = {
  id: "volcengineAgentPlan",
  label: "火山 Agent Plan",
  group: "codingPlan",
  api: "anthropic-messages",
  baseUrl: "https://ark.cn-beijing.volces.com/api/plan",
  checkModel: "auto",
  temperatureRange: [0, 1],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    // --- Doubao-Seed-2.0 主力（2026-02-14 发布） ---
    { id: "doubao-seed-2.0-code", maxOutput: 128000, contextWindowTokens: 256000, enabled: true, releasedAt: "2026-02-15" },
    { id: "doubao-seed-2.0-pro", maxOutput: 128000, contextWindowTokens: 256000, enabled: true, releasedAt: "2026-02-15" },
    { id: "doubao-seed-2.0-lite", maxOutput: 128000, contextWindowTokens: 256000, enabled: true, releasedAt: "2026-02-15" },
    // --- 老版 ---
    { id: "doubao-seed-code", maxOutput: 32000, contextWindowTokens: 256000, releasedAt: "2025-11-01" },
    // --- 订阅包里的第三方模型 ---
    { id: "minimax-m2.5", maxOutput: 131072, contextWindowTokens: 204800, enabled: true },
    { id: "glm-4.7", maxOutput: 131072, contextWindowTokens: 200000, enabled: true },
    { id: "deepseek-v3.2", maxOutput: 65536, contextWindowTokens: 262144, enabled: true },
    { id: "kimi-k2.5", maxOutput: 32768, contextWindowTokens: 262144, enabled: true, temperature: 1 },
  ],
};
