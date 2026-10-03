import { createHash } from "node:crypto";

/** 归一化：CRLF 转 LF、去掉行尾空白与末尾空行 */
export function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd();
}

/** 内容指纹：归一化后取 sha256 前 16 位，用于跨目录去重与漂移检测 */
export function hashContent(content: string): string {
  return createHash("sha256").update(normalizeContent(content)).digest("hex").slice(0, 16);
}
