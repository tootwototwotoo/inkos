import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Eye, EyeOff, Loader2, ArrowLeft, Trash2, X, Plus, RotateCcw, Pencil, Check } from "lucide-react";
import { ServiceQuickLinks } from "../components/ServiceQuickLinks";
import { tr } from "../lib/app-language";
import {
  deleteServiceConfig,
  matchServiceConfigEntryForDetail,
  probeServiceForDetail,
  rehydrateServiceConnectionStatus,
  saveModelOverrides,
  saveServiceConfig,
  type ServiceDetailConnectionStatus as ConnectionStatus,
  type ServiceDetailDetectedConfig as DetectedConfig,
  type ServiceDetailModelInfo as ModelInfo,
  type ServiceDetailVerifiedProbe as VerifiedProbe,
  type ServiceModelOverridesPayload,
} from "./service-detail-state";

interface Nav {
  toServices: () => void;
}

/** 格式化 tokens 数为简短显示(如 128000 -> "128K", 1000000 -> "1M")。 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 w-16 bg-muted rounded" />
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="space-y-2"><div className="h-3 w-16 bg-muted/60 rounded" /><div className="h-10 w-full bg-muted/40 rounded-lg" /></div>
      <div className="h-9 w-24 bg-muted/40 rounded-lg" />
    </div>
  );
}

interface EditableModel extends ModelInfo {
  readonly source?: "probed" | "extra";
}

/**
 * 可编辑的模型列表:每个模型可删除(×)和改名(铅笔),底部可添加自定义模型,
 * 顶部有"重置"按钮清除所有覆盖层。编辑后调 saveModelOverrides 持久化,
 * 保存成功后 onRefresh 触发父组件重新拉取应用了覆盖层的列表。
 */
function EditableModelList({
  serviceId,
  models,
  onRefresh,
}: {
  readonly serviceId: string;
  readonly models: ReadonlyArray<ModelInfo>;
  readonly onRefresh: () => void;
}) {
  const [disabled, setDisabled] = useState<ReadonlyArray<string>>([]);
  const [extra, setExtra] = useState<ReadonlyArray<{ id: string; name?: string; contextWindowTokens?: number; maxOutput?: number }>>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [addInput, setAddInput] = useState("");
  const [addName, setAddName] = useState("");
  const [addContext, setAddContext] = useState("");
  const [addMax, setAddMax] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // 加载已保存的覆盖层(从 GET /services/:service/models 之外,需要单独读)。
  // 这里复用 saveServiceConfig 用的 /services/config 拿到 services 数组,
  // 从中找到该 service 的 models 字段。
  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ services: Array<Record<string, unknown>> }>("/services/config")
      .then((data) => {
        if (cancelled) return;
        const matched = (data.services ?? []).find((s) => {
          const sid = typeof s.service === "string" ? s.service : "";
          const name = typeof s.name === "string" ? s.name : "";
          const key = sid === "custom" ? `custom:${name || "Custom"}` : sid;
          return key === serviceId || sid === serviceId;
        });
        if (!matched || !matched.models || typeof matched.models !== "object") return;
        const m = matched.models as Record<string, unknown>;
        if (Array.isArray(m.disabled)) {
          setDisabled(m.disabled.filter((s): s is string => typeof s === "string"));
        }
        if (Array.isArray(m.extra)) {
          setExtra(m.extra
            .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object" && typeof (e as { id?: unknown }).id === "string")
            .map((e) => {
              const obj = e as { id: string; name?: unknown; contextWindowTokens?: unknown; maxOutput?: unknown };
              const item: { id: string; name?: string; contextWindowTokens?: number; maxOutput?: number } = { id: obj.id };
              if (typeof obj.name === "string") item.name = obj.name;
              if (typeof obj.contextWindowTokens === "number" && obj.contextWindowTokens > 0) item.contextWindowTokens = obj.contextWindowTokens;
              if (typeof obj.maxOutput === "number" && obj.maxOutput > 0) item.maxOutput = obj.maxOutput;
              return item;
            }));
        }
        if (m.labels && typeof m.labels === "object") {
          setLabels(Object.fromEntries(
            Object.entries(m.labels as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string"),
          ) as Record<string, string>);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) {} });
    return () => { cancelled = true; };
  }, [serviceId]);

  // 当前展示的列表:基础 models + extra,减去 disabled,应用 labels。
  const displayed: ReadonlyArray<EditableModel> = [
    ...models.map((m) => ({ ...m, source: "probed" as const })),
    ...extra
      .filter((e) => !models.some((m) => m.id === e.id))
      .map((e) => ({
        id: e.id,
        name: labels[e.id] ?? e.name ?? e.id,
        source: "extra" as const,
        ...(e.contextWindowTokens ? { contextWindow: e.contextWindowTokens } : {}),
        ...(e.maxOutput ? { maxOutput: e.maxOutput } : {}),
      })),
  ].filter((m) => !disabled.includes(m.id));

  const persist = async (next: ServiceModelOverridesPayload) => {
    setSaving(true);
    try {
      await saveModelOverrides(serviceId, next);
      onRefresh();
    } catch (err) {
      alert(tr("保存失败：", "Save failed: ") + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    const nextDisabled = disabled.includes(id) ? disabled : [...disabled, id];
    setDisabled(nextDisabled);
    void persist({ disabled: nextDisabled, extra, labels });
  };

  const handleAdd = () => {
    const id = addInput.trim();
    if (!id) return;
    // 去重检查用 displayed(当前实际显示的列表),而不是原始 models。
    // 因为清空后原始模型仍在 models 里但被 disabled,用户可能想重新添加。
    if (displayed.some((m) => m.id === id)) {
      alert(tr("该模型已存在", "Model already exists"));
      return;
    }
    const name = addName.trim() || undefined;
    const ctx = addContext.trim() ? parseInt(addContext.trim(), 10) : undefined;
    const max = addMax.trim() ? parseInt(addMax.trim(), 10) : undefined;
    const item: { id: string; name?: string; contextWindowTokens?: number; maxOutput?: number } = { id };
    if (name) item.name = name;
    if (ctx && ctx > 0) item.contextWindowTokens = ctx;
    if (max && max > 0) item.maxOutput = max;
    const nextExtra = [...extra, item];
    // 如果该 id 之前被 disabled 了,现在重新添加,从 disabled 里移除。
    const nextDisabled = disabled.filter((d) => d !== id);
    setExtra(nextExtra);
    setDisabled(nextDisabled);
    setAddInput("");
    setAddName("");
    setAddContext("");
    setAddMax("");
    setShowAdd(false);
    void persist({ disabled: nextDisabled, extra: nextExtra, labels });
  };

  const handleStartEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingLabel(currentName);
  };

  const handleSaveEdit = (id: string) => {
    const trimmed = editingLabel.trim();
    const nextLabels = { ...labels };
    if (trimmed && trimmed !== id) {
      nextLabels[id] = trimmed;
    } else {
      delete nextLabels[id];
    }
    setLabels(nextLabels);
    setEditingId(null);
    void persist({ disabled, extra, labels: nextLabels });
  };

  const handleReset = () => {
    setDisabled([]);
    setExtra([]);
    setLabels({});
    void persist({});
  };

  const handleClearAll = () => {
    // 把所有模型(bank + extra)都加入 disabled,使列表清空。
    // 与"重置"相反:重置是清除覆盖层恢复原始列表,清空是删掉全部模型。
    const allIds = [
      ...models.map((m) => m.id),
      ...extra.map((e) => e.id),
    ];
    const nextDisabled = Array.from(new Set([...disabled, ...allIds]));
    setDisabled(nextDisabled);
    setExtra([]);
    setLabels({});
    void persist({ disabled: nextDisabled, extra: [], labels: {} });
  };

  const hasOverrides = disabled.length > 0 || extra.length > 0 || Object.keys(labels).length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
          {tr(`可用模型（${displayed.length}）`, `Available models (${displayed.length})`)}
        </p>
        <div className="flex items-center gap-2">
          {hasOverrides && (
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
              title={tr("清除所有编辑，恢复原始列表", "Clear all edits, restore original list")}
            >
              <RotateCcw size={11} />
              {tr("重置", "Reset")}
            </button>
          )}
          {displayed.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              disabled={saving}
              className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-destructive transition-colors"
              title={tr("清空所有模型，从空白开始添加", "Clear all models, start from empty")}
            >
              <Trash2 size={11} />
              {tr("清空", "Clear")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            disabled={saving}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <Plus size={11} />
            {tr("添加", "Add")}
          </button>
        </div>
      </div>

      {displayed.length > 0 ? (
        <div className="flex gap-1.5 flex-wrap">
          {displayed.map((m) => (
            <div
              key={m.id}
              className="group flex items-center gap-1 text-[11px] px-2.5 py-1 pr-1.5 rounded-md bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400 border border-emerald-500/15"
            >
              {editingId === m.id ? (
                <>
                  <input
                    autoFocus
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(m.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="bg-transparent border-b border-emerald-500/30 outline-none w-28 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveEdit(m.id)}
                    className="hover:text-foreground"
                  >
                    <Check size={11} />
                  </button>
                </>
              ) : (
                <>
                  <span
                    onDoubleClick={() => handleStartEdit(m.id, m.name ?? m.id)}
                    title={m.id === (m.name ?? m.id) ? tr("双击改名", "Double-click to rename") : m.id}
                  >
                    {m.name ?? m.id}
                  </span>
                  {m.contextWindow && m.contextWindow > 0 && (
                    <span
                      className="text-[10px] text-muted-foreground/60 px-1 rounded bg-muted/40"
                      title={tr("上下文窗口", "Context window")}
                    >
                      {formatTokens(m.contextWindow)}
                    </span>
                  )}
                  {m.maxOutput && m.maxOutput > 0 && (
                    <span
                      className="text-[10px] text-muted-foreground/60 px-1 rounded bg-muted/40"
                      title={tr("最大输出", "Max output")}
                    >
                      {formatTokens(m.maxOutput)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleStartEdit(m.id, m.name ?? m.id)}
                    className="opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
                    title={tr("改名", "Rename")}
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(m.id)}
                    disabled={saving}
                    className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                    title={tr("移除", "Remove")}
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/60">{tr("点击“测试连接”查看可用模型", "Click “Test connection” to list available models")}</p>
      )}

      {showAdd && (
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-md bg-muted/30 border border-border/30">
          <input
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder={tr("模型 ID（如 gpt-4o）", "Model ID (e.g. gpt-4o)")}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            className="flex-1 min-w-[160px] bg-background text-xs px-2 py-1 rounded border border-border/40 outline-none focus:border-primary/40"
          />
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder={tr("显示名（可选）", "Display name (optional)")}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            className="flex-1 min-w-[120px] bg-background text-xs px-2 py-1 rounded border border-border/40 outline-none focus:border-primary/40"
          />
          <input
            value={addContext}
            onChange={(e) => setAddContext(e.target.value)}
            placeholder={tr("上下文窗口（可选）", "Context window (optional)")}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            type="number"
            min="1"
            className="w-[130px] bg-background text-xs px-2 py-1 rounded border border-border/40 outline-none focus:border-primary/40"
            title={tr("上下文窗口大小（tokens）", "Context window size (tokens)")}
          />
          <input
            value={addMax}
            onChange={(e) => setAddMax(e.target.value)}
            placeholder={tr("最大输出（可选）", "Max output (optional)")}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            type="number"
            min="1"
            className="w-[110px] bg-background text-xs px-2 py-1 rounded border border-border/40 outline-none focus:border-primary/40"
            title={tr("最大输出 tokens", "Max output tokens")}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !addInput.trim()}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            {tr("添加", "Add")}
          </button>
        </div>
      )}

      {saving && (
        <p className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
          <Loader2 size={11} className="animate-spin" />
          {tr("保存中…", "Saving…")}
        </p>
      )}
    </div>
  );
}

export function ServiceDetailPage({ serviceId, nav }: { serviceId: string; nav: Nav }) {
  // -- Service store --
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const setStoreModels = useServiceStore((s) => s.setLiveModels);
  const clearStoreModels = useServiceStore((s) => s.clearModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom" || serviceId.startsWith("custom:");
  const persistedCustomName = serviceId.startsWith("custom:") ? decodeURIComponent(serviceId.slice("custom:".length)) : "";

  // -- Local form state --
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [apiFormat, setApiFormat] = useState<"chat" | "responses">("chat");
  const [stream, setStream] = useState(true);
  const [detectedModel, setDetectedModel] = useState<string>("");
  const [detectedConfig, setDetectedConfig] = useState<DetectedConfig | null>(null);
  const [verifiedProbe, setVerifiedProbe] = useState<VerifiedProbe | null>(null);

  // -- Global proxy state --
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxySaving, setProxySaving] = useState(false);

  // -- Unified connection status --
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ services: Array<Record<string, unknown>> }>("/services/config")
      .then((data) => {
        if (cancelled) return;
        const matched = matchServiceConfigEntryForDetail(data.services ?? [], serviceId);
        if (!matched) return;
        if (isCustom) {
          setCustomName(String(matched.name ?? persistedCustomName));
          setBaseUrl(String(matched.baseUrl ?? ""));
        }
        if (typeof matched.temperature === "number") setTemperature(String(matched.temperature));
        if (matched.apiFormat === "chat" || matched.apiFormat === "responses") setApiFormat(matched.apiFormat);
        if (typeof matched.stream === "boolean") setStream(matched.stream);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCustom, persistedCustomName, serviceId]);

  // 加载全局代理配置
  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ proxyUrl?: string }>("/proxy")
      .then((data) => { if (!cancelled) setProxyUrl(data.proxyUrl ?? ""); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleSaveProxy = async () => {
    setProxySaving(true);
    try {
      await fetchJson("/proxy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl: proxyUrl.trim() }),
      });
    } catch {
      // 静默忽略保存失败
    } finally {
      setProxySaving(false);
    }
  };

  const resolvedCustomName = persistedCustomName || customName.trim() || "Custom";
  const effectiveServiceId = isCustom ? `custom:${resolvedCustomName}` : serviceId;
  const label = isCustom ? (customName || persistedCustomName || tr("自定义服务", "Custom service")) : (svc?.label ?? serviceId);
  const storeModels = useServiceStore((s) => s.modelsByService[effectiveServiceId]);

  useEffect(() => {
    let cancelled = false;
    void rehydrateServiceConnectionStatus({
      effectiveServiceId,
      shouldVerify: Boolean(svc?.connected),
      isCustom,
      baseUrl,
      apiFormat,
      stream,
    })
      .then((result) => {
        if (cancelled) return;
        setApiKey(result.apiKey);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStatus(result.status);
        if (result.status.state === "connected") {
          setStoreModels(effectiveServiceId, result.status.models);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ state: "idle" });
      });
    return () => { cancelled = true; };
  }, [
    apiFormat,
    baseUrl,
    effectiveServiceId,
    isCustom,
    setStoreModels,
    stream,
    svc?.connected,
  ]);

  if (loading) return <DetailSkeleton />;

  // -- Derived state --
  const isConnected = Boolean(svc?.connected);
  const models = status.state === "connected" ? status.models : (storeModels ?? []);
  const isBusy = status.state === "testing" || status.state === "saving";

  // -- Handlers --

  // 保存模型覆盖层后,重新拉取应用了覆盖层的模型列表(?refresh=1 绕过缓存)。
  const handleRefreshModels = async () => {
    try {
      const data = await fetchJson<{ models: ModelInfo[] }>(
        `/services/${encodeURIComponent(effectiveServiceId)}/models?refresh=1`,
      );
      const refreshed = data.models ?? [];
      setStoreModels(effectiveServiceId, refreshed);
      setStatus((prev) => prev.state === "connected" ? { state: "connected", models: refreshed } : prev);
    } catch {
      // 刷新失败不影响已保存的覆盖层,静默忽略
    }
  };

  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey && !isCustom) {
      setStatus({ state: "error", message: tr("请先输入 API Key", "Enter an API key first") });
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: tr("请先填写 Base URL", "Enter a base URL first") });
      return;
    }
    setApiKey(trimmedKey);
    setStatus({ state: "testing" });
    try {
      const result = await probeServiceForDetail(effectiveServiceId, {
        apiKey: trimmedKey,
        apiFormat,
        stream,
        ...(isCustom ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (result.ok) {
        const models = result.models ?? [];
        const verifiedApiFormat = result.detected?.apiFormat ?? apiFormat;
        const verifiedStream = typeof result.detected?.stream === "boolean" ? result.detected.stream : stream;
        const verifiedBaseUrl = isCustom ? (result.detected?.baseUrl ?? baseUrl.trim()) : "";
        if (result.detected?.apiFormat) setApiFormat(result.detected.apiFormat);
        if (typeof result.detected?.stream === "boolean") setStream(result.detected.stream);
        if (isCustom && result.detected?.baseUrl) setBaseUrl(result.detected.baseUrl);
        setDetectedModel(result.selectedModel ?? "");
        setDetectedConfig(result.detected ?? null);
        setVerifiedProbe({
          apiKey: trimmedKey,
          baseUrl: verifiedBaseUrl,
          apiFormat: verifiedApiFormat,
          stream: verifiedStream,
          models,
          selectedModel: result.selectedModel,
          detected: result.detected,
        });
        setStatus({ state: "connected", models });
        setStoreModels(effectiveServiceId, models); // Write to global store
      } else {
        setVerifiedProbe(null);
        setStatus({ state: "error", message: result.error ?? tr("连接失败", "Connection failed") });
        clearStoreModels(effectiveServiceId);
      }
    } catch (e) {
      setVerifiedProbe(null);
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("连接失败", "Connection failed") });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(tr(`删除“${label}”的配置和密钥？`, `Delete the config and key for “${label}”?`))) return;
    setStatus({ state: "saving" });
    try {
      await deleteServiceConfig(effectiveServiceId);
      clearStoreModels(effectiveServiceId);
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("删除失败", "Delete failed") });
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: tr("请先填写 Base URL", "Enter a base URL first") });
      return;
    }
    setStatus({ state: "saving" });
    try {
      const result = await saveServiceConfig({
        effectiveServiceId,
        serviceId,
        isCustom,
        resolvedCustomName,
        apiKey: trimmedKey,
        baseUrl,
        apiFormat,
        stream,
        temperature,
        detectedModel,
        verifiedProbe,
      });
      if (result.status.state === "connected") {
        if (result.detectedConfig?.apiFormat) setApiFormat(result.detectedConfig.apiFormat);
        if (typeof result.detectedConfig?.stream === "boolean") setStream(result.detectedConfig.stream);
        if (isCustom && result.detectedConfig?.baseUrl) setBaseUrl(result.detectedConfig.baseUrl);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStoreModels(effectiveServiceId, result.status.models);
        setStatus(result.status);
      } else {
        setStatus(result.status);
        if (result.status.state === "error") return;
      }
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("保存失败", "Save failed") });
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={nav.toServices}
        className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors"
      >
        <ArrowLeft size={14} />
        {tr("返回服务商管理", "Back to providers")}
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{label}</h1>
        {isConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
            {tr("已连接", "Connected")}
          </span>
        )}
      </div>
      <ServiceQuickLinks serviceId={serviceId} />

      <div className="space-y-5">
        {/* Custom fields */}
        {isCustom && (
        <div className="grid grid-cols-2 gap-4">
            <Field label={tr("服务名称", "Service name")}>
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder={tr("例如：本地 Ollama", "e.g. local Ollama")} className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Base URL">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
            </Field>
          </div>
        )}

        {/* API Key */}
        <Field label="API Key">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"} value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..."
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        {/* Actions + feedback */}
        <div className="flex items-center gap-2">
          <button onClick={handleTest} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50">
            {status.state === "testing" && <Loader2 size={12} className="animate-spin" />}
            {tr("测试连接", "Test connection")}
          </button>
          <button onClick={handleSave} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            {status.state === "saving" && <Loader2 size={12} className="animate-spin" />}
            {tr("保存", "Save")}
          </button>
          {(isConnected || isCustom) && (
            <button onClick={handleDelete} disabled={isBusy}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
              <Trash2 size={12} />
              {tr("删除配置", "Delete config")}
            </button>
          )}
          {/* Status feedback */}
          {status.state === "connected" && (
            <span className="text-xs text-emerald-500">
              {tr(`连接成功，${models.length} 个模型`, `Connected, ${models.length} models`)}
              {detectedModel
                ? tr(
                    `，已自动匹配 ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "responses" ? "Responses" : "Chat"} / ${detectedConfig.stream ? "流式" : "非流式"}` : ""}`,
                    `, auto-matched ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "responses" ? "Responses" : "Chat"} / ${detectedConfig.stream ? "streaming" : "non-streaming"}` : ""}`,
                  )
                : ""}
            </span>
          )}
          {status.state === "error" && (
            <span className="text-xs text-destructive">{status.message}</span>
          )}
          {status.state === "saved" && (
            <span className="text-xs text-emerald-500">{tr("已保存", "Saved")}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={tr("协议类型", "Protocol")}>
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as "chat" | "responses")}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="chat">Chat / Completions</option>
              <option value="responses">Responses</option>
            </select>
          </Field>

          <Field label={tr("流式响应", "Streaming")}>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />
              <span>{stream ? tr("开启", "On") : tr("关闭", "Off")}</span>
            </label>
          </Field>
        </div>

        {/* Models (editable: add / remove / rename / reset) */}
        {isConnected && (
          <EditableModelList
            serviceId={effectiveServiceId}
            models={models}
            onRefresh={handleRefreshModels}
          />
        )}

        {/* Advanced params */}
        <details className="group pt-2 border-t border-border/20">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2">
            {tr("高级参数", "Advanced")}
          </summary>
          <div className="space-y-4 pt-2">
            <Field label="temperature">
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="2" step="0.05" value={temperature}
                  onChange={(e) => setTemperature(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)}
                  min="0" max="2" step="0.05" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
            </Field>
          </div>
        </details>

        {/* 全局代理配置 */}
        <details className="group pt-2 border-t border-border/20">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2">
            {tr("代理配置", "Proxy")}
          </summary>
          <div className="space-y-3 pt-2">
            <p className="text-[11px] text-muted-foreground/50">
              {tr(
                "配置 HTTP/HTTPS 代理后,所有 LLM 调用(包括模型请求和封面生成)都会通过代理发出。留空则不使用代理。",
                "When an HTTP/HTTPS proxy is configured, all LLM calls (including model requests and cover generation) go through the proxy. Leave empty to disable.",
              )}
            </p>
            <Field label={tr("代理 URL", "Proxy URL")}>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  placeholder={tr("http://127.0.0.1:7890", "http://127.0.0.1:7890")}
                  className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={handleSaveProxy}
                  disabled={proxySaving}
                  className="flex items-center gap-1 text-xs px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 shrink-0"
                >
                  {proxySaving ? <Loader2 size={12} className="animate-spin" /> : null}
                  {tr("保存", "Save")}
                </button>
              </div>
            </Field>
          </div>
        </details>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-muted-foreground/70 font-medium">{label}</label>
      {children}
    </div>
  );
}
