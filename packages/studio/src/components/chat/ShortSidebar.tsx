import { useState, useCallback, useRef } from "react";
import { PanelRightClose, PanelRightOpen, Loader2, ScrollText, BookOpen, ImageIcon, FileText } from "lucide-react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useApi, buildApiUrl } from "../../hooks/use-api";
import { useChatStore } from "../../store/chat";
import { tr } from "../../lib/app-language";
import { SidebarCard } from "../sidebar/SidebarCard";

export interface ShortSidebarProps {
  readonly storyId: string;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

interface ShortChapter {
  readonly number: number;
  readonly title: string;
  readonly charCount: number | null;
  readonly filePath: string;
}

interface ShortDetail {
  readonly storyId: string;
  readonly title: string;
  readonly language: string | null;
  readonly hasCover: boolean;
  readonly createdAt: number | null;
  readonly chapters: ReadonlyArray<ShortChapter>;
}

const SIDEBAR_RATIO = 0.4;
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 700;

function defaultSidebarWidth(): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(window.innerWidth * SIDEBAR_RATIO)));
}

function formatCharCount(n: number | null, isZh: boolean): string {
  if (n == null) return "";
  return isZh ? `${n} 字` : `${n} words`;
}

function PanelView({ storyId, t }: { readonly storyId: string; readonly t: TFunction }) {
  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";
  const { data, loading } = useApi<{ short: ShortDetail }>(`/shorts/${encodeURIComponent(storyId)}`);
  const openProjectArtifact = useChatStore((s) => s.openProjectArtifact);
  const short = data?.short;

  const openChapter = (filePath: string) => {
    openProjectArtifact(filePath);
  };

  const coverUrl = short?.hasCover
    ? buildApiUrl(`/project/files/shorts/${encodeURIComponent(storyId)}/final/cover.png`)
    : null;

  return (
    <div className="flex flex-col gap-2 p-3">
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={16} className="text-muted-foreground animate-spin" />
        </div>
      )}

      {!loading && short && (
        <>
          {/* 封面 */}
          {coverUrl && (
            <SidebarCard title={isZh ? "封面" : "Cover"} defaultOpen={false}>
              <div className="px-2 pb-2">
                <img
                  src={coverUrl}
                  alt={short.title}
                  className="w-full rounded-lg border border-border/40"
                />
              </div>
            </SidebarCard>
          )}

          {/* 章节列表 */}
          <SidebarCard title={isZh ? "章节" : "Chapters"}>
            <div className="px-1 pb-1">
              {short.chapters.length === 0 ? (
                <p className="text-[14px] leading-6 text-muted-foreground/60 italic px-2 py-2">
                  {isZh ? "未找到章节文件。" : "No chapter files found."}
                </p>
              ) : (
                <div className="space-y-0.5">
                  {short.chapters.map((ch) => (
                    <button
                      key={ch.number}
                      type="button"
                      onClick={() => openChapter(ch.filePath)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-secondary/40 transition-colors group"
                    >
                      <span className="shrink-0 text-[12px] text-muted-foreground/50 font-mono w-7">
                        {String(ch.number).padStart(2, "0")}
                      </span>
                      <span className="truncate flex-1 text-[14px] leading-5 text-foreground/90 group-hover:text-foreground">
                        {ch.title}
                      </span>
                      {ch.charCount != null && (
                        <span className="shrink-0 text-[11px] text-muted-foreground/40">
                          {formatCharCount(ch.charCount, isZh)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </SidebarCard>

          {/* 完整正文 */}
          <SidebarCard title={isZh ? "完整正文" : "Full Manuscript"} defaultOpen={false}>
            <div className="px-1 pb-1">
              <button
                type="button"
                onClick={() => openProjectArtifact(`shorts/${encodeURIComponent(storyId)}/final/full.md`)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-secondary/40 transition-colors group"
              >
                <BookOpen size={13} className="shrink-0 text-muted-foreground/60" />
                <span className="truncate flex-1 text-[14px] leading-5 text-foreground/90 group-hover:text-foreground">
                  final/full.md
                </span>
              </button>
            </div>
          </SidebarCard>

          {/* 简介卖点 */}
          <SidebarCard title={isZh ? "简介与卖点" : "Synopsis & Selling Points"} defaultOpen={false}>
            <div className="px-1 pb-1 space-y-0.5">
              <button
                type="button"
                onClick={() => openProjectArtifact(`shorts/${encodeURIComponent(storyId)}/final/sales-package.md`)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-secondary/40 transition-colors group"
              >
                <FileText size={13} className="shrink-0 text-muted-foreground/60" />
                <span className="truncate flex-1 text-[14px] leading-5 text-foreground/90 group-hover:text-foreground">
                  sales-package.md
                </span>
              </button>
              <button
                type="button"
                onClick={() => openProjectArtifact(`shorts/${encodeURIComponent(storyId)}/final/cover-prompt.md`)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-secondary/40 transition-colors group"
              >
                <ImageIcon size={13} className="shrink-0 text-muted-foreground/60" />
                <span className="truncate flex-1 text-[14px] leading-5 text-foreground/90 group-hover:text-foreground">
                  cover-prompt.md
                </span>
              </button>
            </div>
          </SidebarCard>
        </>
      )}

      {!loading && !short && (
        <div className="px-3 py-6 text-xs text-muted-foreground/50 italic text-center">
          {tr("短篇不存在或未完成", "Short fiction not found or incomplete")}
        </div>
      )}
    </div>
  );
}

export function ShortSidebar({ storyId, theme: _theme, t, sse: _sse }: ShortSidebarProps) {
  void _theme;
  void _sse;
  const [width, setWidth] = useState(defaultSidebarWidth);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX - ev.clientX;
      setWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [width]);

  return (
    <aside
      className="hidden lg:flex shrink-0 flex-col bg-background/30 backdrop-blur-sm overflow-y-auto relative"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
      />
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/20 shrink-0">
        <ScrollText size={14} className="text-muted-foreground/70" />
        <span className="text-[15px] leading-6 font-medium text-foreground">{tr("短篇", "Short")}</span>
      </div>
      <PanelView storyId={storyId} t={t} />
    </aside>
  );
}

export function ShortSidebarToggle({ storyId, theme, t, sse }: ShortSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed right-3 top-[72px] z-20 lg:hidden w-8 h-8 rounded-lg bg-card border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      >
        <PanelRightOpen size={14} />
      </button>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <aside
            className="absolute right-0 top-0 h-full w-[420px] max-w-[85vw] bg-background border-l border-border/20 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
              <span className="text-[15px] leading-6 font-medium text-muted-foreground">{tr("短篇信息", "Short Info")}</span>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <PanelRightClose size={14} />
              </button>
            </div>
            <PanelView storyId={storyId} t={t} />
          </aside>
        </div>
      )}
    </>
  );
}
