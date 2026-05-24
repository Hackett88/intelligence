// POST /api/indexing/sync
//
// 流程：
//   1. 校验登录态
//   2. 通过 puppeteer-core 连本地 Chrome (CDP 127.0.0.1:9222)
//   3. 在 GSC Performance > Pages 视图抓页面级 4 指标
//   4. 转换为 PageRow[] + IndexingStats
//   5. 写到 data/gsc-snapshot.json（原子写入）
//   6. revalidatePath('/app/indexing') 让 RSC 重新读取
//   7. 返回统计摘要 + 抓取耗时

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { fetchGscSnapshot } from "@/lib/gsc/fetcher";
import { transformGscSnapshot } from "@/lib/gsc/transform";
import { saveSnapshot, type IndexingSnapshotFile } from "@/lib/gsc/store";
import { saveBatch, recordError, type RealPageRecord } from "@/lib/gsc/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PROPERTY = "sc-domain:weslamic.com";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录" },
      { status: 401 }
    );
  }

  // 允许从 body 传入自定义 property（多站点时用得上）
  let resourceId = DEFAULT_PROPERTY;
  try {
    const body = (await req.json()) as { resourceId?: string };
    if (typeof body?.resourceId === "string" && body.resourceId.trim()) {
      resourceId = body.resourceId.trim();
    }
  } catch {
    // 没 body 也行
  }

  const startedAt = Date.now();
  let pgBatchId: number | null = null;
  let pgError: string | null = null;

  try {
    const snapshot = await fetchGscSnapshot({ resourceId });
    const { pages, stats } = transformGscSnapshot(snapshot);

    // PG 写入：只存"真实页"（不含合成节点）；transaction 内开 batch + 批量插页
    const realRows: RealPageRecord[] = pages
      .filter((p) => !p.isSynthetic)
      .map((p) => ({
        url: p.url,
        fullUrl: p.fullUrl,
        market: p.market,
        pageType: p.pageType,
        cluster: p.cluster,
        topQuery: p.topQuery,
        clicks: p.clicks,
        impressions: p.impressions,
        ctr: p.ctr,
        position: p.position,
        indexState: p.indexState,
        trend12m: p.trend12m,
        isPillar: !!p.isPillar,
        sortOrder: p.sortOrder,
      }));
    try {
      pgBatchId = await saveBatch(
        {
          property: snapshot.propertyResourceId,
          freshnessText: snapshot.summary.freshnessText || undefined,
          totalPages: stats.totalPages,
          totalClicks: stats.totalClicks,
          totalImpressions: stats.totalImpressions,
          avgCtr: stats.avgCtr,
          avgPosition: stats.avgPosition,
          top10Pages: stats.top10Pages,
        },
        realRows
      );
    } catch (e) {
      // PG 写失败不阻断：JSON 兜底依然落地，前端会收到 degraded 标记
      pgError = e instanceof Error ? e.message : String(e);
      console.error("[sync/route] PG saveBatch failed (continuing with JSON fallback):", pgError);
    }

    // JSON 兜底（永远写）：保留与原逻辑一致的格式
    const file: IndexingSnapshotFile = {
      version: 1,
      fetchedAt: snapshot.fetchedAt,
      propertyResourceId: snapshot.propertyResourceId,
      freshnessText: snapshot.summary.freshnessText || undefined,
      stats,
      pages,
    };
    await saveSnapshot(file);

    // 让 /app/indexing 的 RSC 在下次请求时重新跑（loader 优先 PG，degraded 时降级 JSON）
    revalidatePath("/app/indexing");

    return NextResponse.json({
      ok: true,
      property: snapshot.propertyResourceId,
      fetchedAt: snapshot.fetchedAt,
      durationMs: Date.now() - startedAt,
      pgBatchId,
      degraded: pgError ? { reason: "PG_WRITE_FAILED", message: pgError } : undefined,
      stats: {
        totalPages: stats.totalPages,
        totalClicks: stats.totalClicks,
        totalImpressions: stats.totalImpressions,
        avgCtr: stats.avgCtr,
        avgPosition: stats.avgPosition,
        top10Pages: stats.top10Pages,
      },
      freshnessText: snapshot.summary.freshnessText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    const isCdpConnRefused = /ECONNREFUSED|connect ENOENT|failed to connect/i.test(
      message
    );

    // 记录失败到 sync_log（不阻断响应；PG 不可用就放弃记录）
    try {
      await recordError({
        code: isCdpConnRefused ? "CDP_UNAVAILABLE" : "SYNC_FAILED",
        message,
        property: resourceId,
      });
    } catch (e) {
      console.warn("[sync/route] recordError to PG failed:", (e as Error).message);
    }

    return NextResponse.json(
      {
        ok: false,
        code: isCdpConnRefused ? "CDP_UNAVAILABLE" : "SYNC_FAILED",
        message,
        hint: isCdpConnRefused
          ? "无法连接本地 Chrome 调试端口 (127.0.0.1:9222)。请确认 Chrome 已以 --remote-debugging-port=9222 启动，并已登录 Search Console。"
          : "GSC 抓取失败。请确认浏览器已登录 weslamic.com 的 Search Console 资源。",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 }
    );
  }
}
