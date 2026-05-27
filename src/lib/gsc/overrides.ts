// 页面类型"人工修正"持久化层。
//
// 为什么单独存：pageType 是 inferPageType(URL) 自动推断后落库的，每次 GSC 同步都会
// 重新推断并写新 batch —— 若直接改 gsc_pages 行，下次同步必被覆盖。这里把"人工修正"
// 存成独立的、按 fullUrl（跨批次稳定）映射的文件，同步流程不碰它；由 loader 在重建
// 页面后套用覆盖（见 loader.applyPageTypeOverrides），从而让修正长期生效。
//
// 与 store.ts 的 snapshot 文件同属"当前一期：本地文件持久化"方案，简单稳。

import { promises as fs } from "node:fs";
import path from "node:path";

// fullUrl -> 修正后的 pageType
export type PageTypeOverrides = Record<string, string>;

const OVERRIDES_PATH = path.join(process.cwd(), "data", "page-type-overrides.json");

export async function loadPageTypeOverrides(): Promise<PageTypeOverrides> {
  try {
    const raw = await fs.readFile(OVERRIDES_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PageTypeOverrides;
    }
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    // 损坏文件不应让页面崩 —— 视作"无覆盖"
    console.error("[gsc/overrides] load failed:", err);
    return {};
  }
}

/** upsert 单条修正并原子落盘。pageType 传空串则删除该 url 的修正（恢复自动推断）。 */
export async function savePageTypeOverride(fullUrl: string, pageType: string): Promise<void> {
  const overrides = await loadPageTypeOverrides();
  if (pageType) {
    overrides[fullUrl] = pageType;
  } else {
    delete overrides[fullUrl];
  }
  const dir = path.dirname(OVERRIDES_PATH);
  await fs.mkdir(dir, { recursive: true });
  // 原子写入：先写临时文件再 rename，避免并发读到半个文件
  const tmp = OVERRIDES_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(overrides, null, 2), "utf-8");
  await fs.rename(tmp, OVERRIDES_PATH);
}
