import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeChildPath } from "../utils/path-safety.js";

/**
 * 短篇继续编辑工具集。
 *
 * 短篇产物落盘于 shorts/<storyId>/,章节文件命名是 NNNN.md(纯数字),
 * 与长篇 books/<bookId>/chapters/NNNN_Title.md 不同,因此不能复用
 * patch_chapter_text / replace_chapter_text(它们依赖 findChapterPath
 * 的 NNNN_ 前缀匹配)。这里提供限定在 shorts/<storyId>/ 下的通用文件
 * 编辑工具,供 short 继续编辑会话使用。
 */

function textResult(text: string): AgentToolResult<undefined>;
function textResult<T>(text: string, details: T): AgentToolResult<T>;
function textResult<T = undefined>(text: string, details?: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details: details as T };
}

const EditShortFileParams = Type.Object({
  filePath: Type.String({
    description:
      "File path relative to shorts/<storyId>/, e.g. 'final/full.md', 'final/chapters/0003.md', 'final/sales-package.md'. " +
      "Must be a .md/.txt/.json file under the short's directory.",
  }),
  oldString: Type.String({
    description: "The exact text to replace. Must appear exactly once in the file. Copy enough context to be unique.",
  }),
  newString: Type.String({
    description: "The replacement text.",
  }),
});

type EditShortFileParamsType = Static<typeof EditShortFileParams>;

const WriteShortFileParams = Type.Object({
  filePath: Type.String({
    description:
      "File path relative to shorts/<storyId>/, e.g. 'final/full.md', 'final/chapters/0003.md'. " +
      "Use this to replace a whole chapter or the full manuscript; for small local edits prefer edit_short_file.",
  }),
  content: Type.String({
    description: "Full file content to write. Existing content is overwritten.",
  }),
});

type WriteShortFileParamsType = Static<typeof WriteShortFileParams>;

const ALLOWED_TEXT_EXTENSIONS = /\.(md|txt|json)$/i;

/**
 * 编辑 shorts/<storyId>/ 下的文本文件:精确字符串替换(单次匹配)。
 * 用于短篇继续编辑会话中定点修改正文、章节、简介等。
 */
export function createEditShortFileTool(
  projectRoot: string,
  storyId: string,
): AgentTool<typeof EditShortFileParams> {
  const shortRoot = join(projectRoot, "shorts", storyId);

  return {
    name: "edit_short_file",
    description:
      "Edit a text file under the active short fiction (shorts/<storyId>/) via exact string replacement. " +
      "oldString must appear exactly once. Use for local edits to the manuscript (final/full.md), a single chapter (final/chapters/NNNN.md), or sales package. " +
      "After editing final/chapters/NNNN.md, also update final/full.md if the chapter text should stay in sync.",
    label: "Edit Short File",
    parameters: EditShortFileParams,
    async execute(
      _toolCallId: string,
      params: EditShortFileParamsType,
    ): Promise<AgentToolResult<undefined>> {
      try {
        if (!ALLOWED_TEXT_EXTENSIONS.test(params.filePath)) {
          return textResult(`Only .md/.txt/.json files can be edited (got: ${params.filePath}).`);
        }
        const filePath = safeChildPath(shortRoot, params.filePath);
        const content = await readFile(filePath, "utf-8");
        const idx = content.indexOf(params.oldString);
        if (idx === -1) {
          return textResult(`oldString not found in "${params.filePath}".`);
        }
        if (content.indexOf(params.oldString, idx + 1) !== -1) {
          return textResult(`oldString appears more than once in "${params.filePath}". Provide a more specific match.`);
        }
        const updated = content.slice(0, idx) + params.newString + content.slice(idx + params.oldString.length);
        await writeFile(filePath, updated, "utf-8");
        return textResult(`File "${params.filePath}" updated successfully.`);
      } catch (err: any) {
        return textResult(`Failed to edit "${params.filePath}": ${err?.message ?? String(err)}`);
      }
    },
  };
}

/**
 * 整文件覆盖写入 shorts/<storyId>/ 下的文本文件。
 * 用于大段重写(如整章替换、整篇重排)。父目录自动创建。
 */
export function createWriteShortFileTool(
  projectRoot: string,
  storyId: string,
): AgentTool<typeof WriteShortFileParams> {
  const shortRoot = join(projectRoot, "shorts", storyId);

  return {
    name: "write_short_file",
    description:
      "Create or fully replace a text file under the active short fiction (shorts/<storyId>/). " +
      "Parent directories are created automatically. Existing content is overwritten. " +
      "Use for whole-chapter rewrites (final/chapters/NNNN.md) or regenerating final/full.md from chapters. " +
      "For small local edits prefer edit_short_file.",
    label: "Write Short File",
    parameters: WriteShortFileParams,
    async execute(
      _toolCallId: string,
      params: WriteShortFileParamsType,
    ): Promise<AgentToolResult<undefined>> {
      try {
        if (!ALLOWED_TEXT_EXTENSIONS.test(params.filePath)) {
          return textResult(`Only .md/.txt/.json files can be written (got: ${params.filePath}).`);
        }
        const filePath = safeChildPath(shortRoot, params.filePath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, params.content, "utf-8");
        return textResult(`File "${params.filePath}" written successfully.`);
      } catch (err: any) {
        return textResult(`Failed to write "${params.filePath}": ${err?.message ?? String(err)}`);
      }
    },
  };
}
