import { cjk } from "@streamdown/cjk";
import { Streamdown } from "streamdown";
import { ArrowLeft, BookCopy, Hash, Languages, ScrollText } from "lucide-react";
import { buildApiUrl, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { tr } from "../lib/app-language";

interface ShortSummary {
  readonly storyId: string;
  readonly title: string;
  readonly chapterCount: number | null;
  readonly language: string | null;
  readonly hasCover: boolean;
  readonly createdAt: number | null;
}

interface ShortsListPayload {
  readonly shorts: ReadonlyArray<ShortSummary>;
}

interface ArtifactPayload {
  readonly path: string;
  readonly content: string;
  readonly contentType: string;
  readonly size: number;
}

interface Nav {
  toDashboard: () => void;
}

const streamdownPlugins = { cjk };

const LANGUAGE_LABELS: ReadonlyArray<[string, string]> = [
  ["zh", "中文"],
  ["en", "English"],
];

function languageLabel(code: string | null): string | null {
  if (!code) return null;
  const hit = LANGUAGE_LABELS.find(([c]) => c === code);
  return hit ? hit[1] : code;
}

export function ShortReader({ storyId, nav, theme, t }: {
  storyId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  void theme; // 保留与其它页面一致的签名;当前主题色由 CSS 变量驱动
  void t;

  // 列表拉一次,用于标题/章节数/封面等元数据(缺失时回退到 storyId)。
  const { data: shortsData } = useApi<ShortsListPayload>("/shorts");
  const short = shortsData?.shorts.find((s) => s.storyId === storyId) ?? null;
  const title = short?.title ?? storyId;

  // 正文:复用已有的 artifacts 端点(允许 shorts/ + .md)。
  const artifactPath = `/project/artifacts/shorts/${encodeURIComponent(storyId)}/final/full.md`;
  const { data, loading, error } = useApi<ArtifactPayload>(artifactPath);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-4">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">{tr("正在打开短篇…", "Opening short fiction…")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">
        {tr("加载失败：", "Failed to load: ")}{error}
      </div>
    );
  }

  if (!data) return null;

  const coverUrl = short?.hasCover
    ? buildApiUrl(`/project/files/shorts/${encodeURIComponent(storyId)}/final/cover.png`)
    : null;

  return (
    <div className="max-w-4xl mx-auto space-y-8 fade-in">
      {/* 面包屑 / 返回 */}
      <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <button
          type="button"
          onClick={nav.toDashboard}
          className="hover:text-primary transition-colors flex items-center gap-1"
        >
          <ArrowLeft size={14} />
          {tr("返回", "Back")}
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground flex items-center gap-1">
          <ScrollText size={12} />
          <span className="truncate max-w-[260px]">{title}</span>
        </span>
      </nav>

      {/* 标题 + 元信息 */}
      <header className="space-y-3">
        <h1 className="text-2xl font-bold text-foreground leading-tight">{title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {short?.chapterCount != null && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/60">
              <Hash size={11} />
              {short.chapterCount} {tr("章", "chapters")}
            </span>
          )}
          {short?.language && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/60">
              <Languages size={11} />
              {languageLabel(short.language) ?? short.language}
            </span>
          )}
          {short?.hasCover && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/60">
              <BookCopy size={11} />
              {tr("含封面", "Cover")}
            </span>
          )}
        </div>
      </header>

      {/* 封面 */}
      {coverUrl && (
        <img
          src={coverUrl}
          alt={title}
          className="rounded-xl border border-border/50 max-h-[420px] w-auto shadow-sm"
        />
      )}

      {/* 正文 */}
      <article className="prose prose-neutral dark:prose-invert max-w-none text-[16px] leading-8 prose-headings:font-semibold prose-h1:text-[26px] prose-h2:text-[22px] prose-h3:text-[19px] prose-p:my-4 prose-li:my-1 prose-pre:whitespace-pre-wrap">
        <Streamdown plugins={streamdownPlugins} mode="static">
          {data.content}
        </Streamdown>
      </article>
    </div>
  );
}
