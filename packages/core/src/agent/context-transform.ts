import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { UserMessage } from "@mariozechner/pi-ai";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isNewLayoutBook } from "../utils/outline-paths.js";
import type { ContextCompressionCallback } from "../models/context-compression.js";
/** Files read in this order; anything else in story/ comes after, sorted alphabetically. */
const PRIORITY_FILES = [
  "outline/story_frame.md",
  "outline/volume_map.md",
  "story_bible.md",
  "volume_outline.md",
  "book_rules.md",
  "author_intent.md",
  "current_focus.md",
  "current_state.md",
];

const FULL_INLINE_CHAR_LIMIT = 6000;
const MAX_INDEX_HEADINGS_PER_FILE = 80;
const MAX_INDEX_HEADING_CHARS = 220;

const UPGRADE_HINT =
  "[提示] 当前这本书的架构稿是旧的条目式格式（story_bible.md / volume_outline.md / character_matrix.md）。" +
  "如果作者有意愿升级成段落式架构稿 + 一人一卡的角色目录（outline/story_frame.md + outline/volume_map.md + roles/），" +
  "可以调用 `sub_agent(architect, { revise: true, bookId, feedback: \"把架构稿从条目式升级成段落式架构稿，并把角色矩阵拆成 roles 目录一人一卡\" })`。" +
  "升级只改架构稿，不动已写的章节。在作者没明确同意前不要主动触发。";

export function createBookContextTransform(
  bookId: string | null,
  projectRoot: string,
  options: { readonly onContextCompression?: ContextCompressionCallback } = {},
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  if (bookId === null) {
    return async (messages) => messages;
  }

  const bookDir = join(projectRoot, "books", bookId);
  const storyDir = join(bookDir, "story");

  return async (messages) => {
    const sections = await readTruthFiles(storyDir);
    if (sections.length === 0) return messages;

    const isNew = await isNewLayoutBook(bookDir);
    const hintBlock = isNew ? "" : `\n\n${UPGRADE_HINT}`;
    const compactedSources = sections
      .filter((section) => section.content.length > FULL_INLINE_CHAR_LIMIT)
      .map((section) => section.name);

    if (compactedSources.length > 0) {
      options.onContextCompression?.({
        category: "session_context",
        phase: "start",
        sources: compactedSources,
      });
    }

    const body =
      "[以下是当前书籍的上下文压缩包，每次对话时自动从磁盘读取生成。请基于这些内容进行创作和判断；需要完整原文时再按文件读取。]" +
      hintBlock + "\n\n" +
      sections.map(renderContextSection).join("\n\n");

    if (compactedSources.length > 0) {
      options.onContextCompression?.({
        category: "session_context",
        phase: "end",
        sources: compactedSources,
      });
    }

    const injected: UserMessage = {
      role: "user",
      content: body,
      timestamp: Date.now(),
    };

    return [injected, ...messages];
  };
}

/**
 * 短篇继续编辑会话的上下文注入:读取 shorts/<storyId>/final/ 下的正文与元数据,
 * 注入为 user message,让 AI 在修改前知道当前短篇内容。格式与 book 的上下文压缩包一致。
 *
 * 与 book 不同:短篇没有 story/ 目录,真相文件集中在 final/。正文(final/full.md)
 * 是首要内容;超长时只注入章节标题索引,正文按需用 read 读取。
 */
export function createShortContextTransform(
  storyId: string,
  projectRoot: string,
  options: { readonly onContextCompression?: ContextCompressionCallback } = {},
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  const shortDir = join(projectRoot, "shorts", storyId);
  const finalDir = join(shortDir, "final");

  return async (messages) => {
    const sections: TruthFileSection[] = [];

    // 元数据(short-story.json 解析出标题/章节标题列表)
    let storyTitle = storyId;
    let chapterTitles: string[] = [];
    try {
      const raw = await readFile(join(finalDir, "short-story.json"), "utf-8");
      const parsed = JSON.parse(raw) as { storyTitle?: unknown; chapters?: unknown };
      if (typeof parsed.storyTitle === "string" && parsed.storyTitle.trim()) {
        storyTitle = parsed.storyTitle.trim();
      }
      if (Array.isArray(parsed.chapters)) {
        chapterTitles = parsed.chapters
          .map((c) => (c && typeof c === "object" && "title" in c && typeof (c as { title: unknown }).title === "string" ? (c as { title: string }).title : null))
          .filter((t): t is string => Boolean(t));
      }
    } catch {
      // short-story.json 缺失,回退到 storyId
    }

    // 正文(final/full.md):超长则只注入章节标题索引
    const fullMdPath = join(finalDir, "full.md");
    try {
      const content = await readFile(fullMdPath, "utf-8");
      if (content.length <= FULL_INLINE_CHAR_LIMIT) {
        sections.push({ name: "final/full.md", content });
      } else {
        const index = buildMarkdownFileIndex(content);
        sections.push({
          name: "final/full.md",
          content: [
            `[未全文注入：原文件 ${content.length} 字符 / ${index.totalLines} 行。以下为 Markdown 目录索引；需要正文时用 read 读取 final/full.md 或 final/chapters/NNNN.md。]`,
            index.lines.length > 0 ? index.lines.join("\n") : "[未检测到 Markdown 标题。]",
            index.omittedHeadings > 0 ? `[未注入标题数：${index.omittedHeadings}。]` : "",
          ].filter(Boolean).join("\n"),
        });
        options.onContextCompression?.({
          category: "session_context",
          phase: "start",
          sources: ["final/full.md"],
        });
        options.onContextCompression?.({
          category: "session_context",
          phase: "end",
          sources: ["final/full.md"],
        });
      }
    } catch {
      // full.md 缺失,短篇可能未完成;注入章节标题列表作为替代
      if (chapterTitles.length > 0) {
        sections.push({
          name: "final/short-story.json (chapters)",
          content: chapterTitles.map((t, i) => `${String(i + 1).padStart(4, "0")}. ${t}`).join("\n"),
        });
      }
    }

    if (sections.length === 0) return messages;

    const body =
      `[以下是当前短篇《${storyTitle}》(${storyId})的上下文压缩包，每次对话时自动从磁盘读取生成。` +
      `请基于这些内容进行修改和判断；需要完整原文时按文件读取。短篇产物在 shorts/${storyId}/。]\n\n` +
      sections.map(renderContextSection).join("\n\n");

    const injected: UserMessage = {
      role: "user",
      content: body,
      timestamp: Date.now(),
    };

    return [injected, ...messages];
  };
}

interface TruthFileSection {
  name: string;
  content: string;
}

function renderContextSection(section: TruthFileSection): string {
  if (section.content.length <= FULL_INLINE_CHAR_LIMIT) {
    return `=== ${section.name} ===\n${section.content}`;
  }

  const index = buildMarkdownFileIndex(section.content);
  return [
    `=== ${section.name} ===`,
    `[未全文注入：原文件 ${section.content.length} 字符 / ${index.totalLines} 行。以下为 Markdown 目录索引；避免让旧设定原文淹没当前用户指令。]`,
    index.lines.length > 0
      ? index.lines.join("\n")
      : "[未检测到 Markdown 标题；需要内容时按文件读取完整内容。]",
    index.omittedHeadings > 0 ? `[未注入标题数：${index.omittedHeadings}。]` : "",
  ].filter(Boolean).join("\n");
}

function buildMarkdownFileIndex(content: string): { readonly lines: ReadonlyArray<string>; readonly omittedHeadings: number; readonly totalLines: number } {
  const lines = content.split(/\r?\n/);
  const selected: string[] = [];
  let headingCount = 0;

  for (const rawLine of lines) {
    const heading = normalizeMarkdownHeading(rawLine);
    if (!heading) continue;
    headingCount += 1;
    if (selected.length < MAX_INDEX_HEADINGS_PER_FILE) selected.push(heading);
  }

  return {
    lines: selected,
    omittedHeadings: Math.max(0, headingCount - selected.length),
    totalLines: lines.length,
  };
}

function normalizeMarkdownHeading(line: string): string | null {
  const trimmed = line.trimStart();
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(trimmed);
  if (!match) return null;
  const marker = match[1]!;
  const title = match[2]!;
  return `${marker} ${title.length > MAX_INDEX_HEADING_CHARS ? `${title.slice(0, MAX_INDEX_HEADING_CHARS - 1)}…` : title}`;
}

async function readTruthFiles(storyDir: string): Promise<TruthFileSection[]> {
  let files: string[];
  try {
    files = await listTruthMarkdownFiles(storyDir);
  } catch {
    return [];
  }

  if (files.length === 0) return [];

  const prioritySet = new Set(PRIORITY_FILES);
  const prioritized = PRIORITY_FILES.filter((f) => files.includes(f));
  const rest = files.filter((f) => !prioritySet.has(f)).sort();
  const ordered = [...prioritized, ...rest];

  const sections: TruthFileSection[] = [];
  for (const fileName of ordered) {
    try {
      const content = await readFile(join(storyDir, fileName), "utf-8");
      sections.push({ name: fileName, content });
    } catch {
      // skip unreadable files
    }
  }
  return sections;
}

async function listTruthMarkdownFiles(storyDir: string): Promise<string[]> {
  const topEntries = await readdir(storyDir, { withFileTypes: true });
  const files = topEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);

  for (const dirName of ["outline", "roles"]) {
    files.push(...await listNestedMarkdownFiles(storyDir, dirName));
  }

  return files;
}

async function listNestedMarkdownFiles(storyDir: string, relativeDir: string): Promise<string[]> {
  const dirPath = join(storyDir, relativeDir);
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const child = `${relativeDir}/${entry.name}`;
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(child);
    } else if (entry.isDirectory()) {
      files.push(...await listNestedMarkdownFiles(storyDir, child));
    }
  }
  return files;
}
