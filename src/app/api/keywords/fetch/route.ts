import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq, gt, asc, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { n8nCallbackEvents, keywords } from "@/db/schema";
import { N8nCallbackEventSchema } from "@/contracts/n8n-callback";
import { invalidateKeywordsCache } from "@/lib/keywords-cache";
import {
  triggerW01PhraseThese,
  triggerW02PhraseThis,
  triggerW03PhraseOrganic,
  triggerW04PhraseQuestions,
  triggerW05PhraseRelated,
  triggerW06PhraseFullsearch,
  triggerW07PhraseAll,
  triggerW08DomainAdwords,
  triggerW09DomainAdwordsHistorical,
  triggerW10DomainDomains,
  buildBatchId,
  buildW02BatchId,
  buildW03BatchId,
  buildW04BatchId,
  buildW05BatchId,
  buildW06BatchId,
  buildW07BatchId,
  buildW08BatchId,
  buildW09BatchId,
  buildW10BatchId,
  getStagingRowsByBatch,
  getW03StagingRowsByBatch,
  getW04StagingRowsByBatch,
  getW05StagingRowsByBatch,
  getW06StagingRowsByBatch,
  getW07StagingRowsByBatch,
  getW08StagingRowsByBatch,
  getW09StagingRowsByBatch,
  getW10StagingRowsByBatch,
  patchKeywordsPoolRow,
  type W01Market,
  type StagingRow,
  type W03StagingRow,
  type W04StagingRow,
  type W05StagingRow,
  type W06StagingRow,
  type W07StagingRow,
  type W08StagingRow,
  type W09StagingRow,
  type W10StagingRow,
} from "@/lib/n8n-trigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const ALLOWED_MARKETS: W01Market[] = [
  "sa", "id", "my", "ae", "uk", "fr", "de", "es", "us",
];

// 终态节点：进入这些节点之一即代表该 batch 流程结束（成功或失败）
const TERMINAL_NODES = new Set([
  "Callback Failed Validation",
  "Callback Failed Semrush",
  "Callback Nothing Found",
  "Callback Empty",
  "Callback Succeeded Write",
]);

const POLL_INTERVAL_MS = 1000;
const HARD_TIMEOUT_MS = 120_000;
const HEARTBEAT_MS = 20_000;

function isMockEnabled(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get("mock") === "1") return true;
  return process.env.USE_MOCK === "1";
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });

  const demo = req.nextUrl.searchParams.get("demo");
  if (demo === "hello-world") return helloWorldStream(req);

  const endpoint = req.nextUrl.searchParams.get("endpoint");
  if (!endpoint) {
    return new Response("missing endpoint or demo param\n", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const ep = endpoint.toUpperCase();
  if (
    ep !== "W01" && ep !== "W02" && ep !== "W03" &&
    ep !== "W04" && ep !== "W05" && ep !== "W06" && ep !== "W07" && ep !== "W08" && ep !== "W09" && ep !== "W10"
  ) {
    return new Response(`endpoint ${endpoint} not implemented\n`, {
      status: 501,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (ep === "W02") {
    const keyword = (req.nextUrl.searchParams.get("keyword") ?? "")
      .trim()
      .toLowerCase();
    const marketsRaw = req.nextUrl.searchParams.get("markets") ?? "";
    const markets = marketsRaw
      .split(",")
      .map((s) => s.trim().toLowerCase() as W01Market)
      .filter((m) => ALLOWED_MARKETS.includes(m));

    if (!keyword) {
      return new Response("keyword required\n", { status: 400 });
    }
    if (markets.length === 0) {
      return new Response("at least one market required\n", { status: 400 });
    }

    if (isMockEnabled(req)) {
      return mockEndpointStream(req, "W02");
    }

    return realW02Stream(req, keyword, markets);
  }

  if (ep === "W07") {
    const keyword = (req.nextUrl.searchParams.get("keyword") ?? "")
      .trim()
      .toLowerCase();
    const displayLimitRaw = req.nextUrl.searchParams.get("display_limit") ?? "9";
    const displayLimit = Math.max(1, Math.min(50, Number(displayLimitRaw) || 9));

    if (!keyword) {
      return new Response("keyword required\n", { status: 400 });
    }

    if (isMockEnabled(req)) {
      return mockEndpointStream(req, "W07");
    }

    return realW07Stream(req, keyword, displayLimit);
  }

  if (ep === "W04") {
    const seedKeyword = (req.nextUrl.searchParams.get("seed_keyword") ?? "")
      .trim()
      .toLowerCase();
    const marketsRaw = req.nextUrl.searchParams.get("markets") ?? "";
    const markets = marketsRaw
      .split(",")
      .map((s) => s.toLowerCase().trim())
      .filter((s): s is W01Market => ALLOWED_MARKETS.includes(s as W01Market));
    const displayLimitRaw = req.nextUrl.searchParams.get("display_limit") ?? "25";
    const displayLimit = Math.max(1, Math.min(100, Number(displayLimitRaw) || 25));

    if (!seedKeyword) {
      return new Response("seed_keyword required\n", { status: 400 });
    }
    if (markets.length === 0) {
      return new Response("at least one market required\n", { status: 400 });
    }

    if (isMockEnabled(req)) {
      return mockEndpointStream(req, "W04");
    }

    return realW04Stream(req, seedKeyword, markets, displayLimit);
  }

  if (ep === "W05") {
    const seedKeyword = (req.nextUrl.searchParams.get("seed_keyword") ?? "")
      .trim()
      .toLowerCase();
    const marketsRaw = req.nextUrl.searchParams.get("markets") ?? "";
    const markets = marketsRaw
      .split(",")
      .map((s) => s.toLowerCase().trim())
      .filter((s): s is W01Market => ALLOWED_MARKETS.includes(s as W01Market));
    const displayLimitRaw = req.nextUrl.searchParams.get("display_limit") ?? "25";
    const displayLimit = Math.max(1, Math.min(100, Number(displayLimitRaw) || 25));

    if (!seedKeyword) {
      return new Response("seed_keyword required\n", { status: 400 });
    }
    if (markets.length === 0) {
      return new Response("at least one market required\n", { status: 400 });
    }

    if (isMockEnabled(req)) {
      return mockEndpointStream(req, "W05");
    }

    return realW05Stream(req, seedKeyword, markets, displayLimit);
  }

  if (ep === "W06") {
    const seedKeyword = (req.nextUrl.searchParams.get("seed_keyword") ?? "")
      .trim()
      .toLowerCase();
    const marketsRaw = req.nextUrl.searchParams.get("markets") ?? "";
    const markets = marketsRaw
      .split(",")
      .map((s) => s.toLowerCase().trim())
      .filter((s): s is W01Market => ALLOWED_MARKETS.includes(s as W01Market));
    const displayLimitRaw = req.nextUrl.searchParams.get("display_limit") ?? "25";
    const displayLimit = Math.max(1, Math.min(100, Number(displayLimitRaw) || 25));

    if (!seedKeyword) {
      return new Response("seed_keyword required\n", { status: 400 });
    }
    if (markets.length === 0) {
      return new Response("at least one market required\n", { status: 400 });
    }

    if (isMockEnabled(req)) {
      return mockEndpointStream(req, "W06");
    }

    return realW06Stream(req, seedKeyword, markets, displayLimit);
  }

  if (ep === "W08") {
    const advertiserDomain = (req.nextUrl.searchParams.get("advertiser_domain") ?? "")
      .trim()
      .toLowerCase();
    const marketsRaw = req.nextUrl.searchParams.get("markets") ?? "";
    const markets = marketsRaw
      .split(",")
      .map((s) => s.toLowerCase().trim())
      .filter((s): s is W01Market => ALLOWED_MARKETS.includes(s as W01Market));
    const displayLimitRaw = req.nextUrl.searchParams.get("display_limit") ?? "25";
    const displayLimit = Math.max(1, Math.min(100, Number(displayLimitRaw) || 25));

    if (!advertiserDomain) {
      return new Response("advertiser_domain required\n", { status: 400 });
    }
    if (advertiserDomain.includes("/") || advertiserDomain.includes(" ") || !advertiserDomain.includes(".")) {
      return new Response("advertiser_domain must be a bare domain (e.g. amazon.com)\n", { status: 400 });
    }
    if (markets.length === 0) {
      return new Response("at least one market required\n", { status: 400 });
    }

    if (isMockEnabled(req)) {
      return mockEndpointStream(req, "W08");
    }

    return realW08Stream(req, advertiserDomain, markets, displayLimit);
  }

  if (ep === "W09") {
    const advertiserDomain = (req.nextUrl.searchParams.get("advertiser_domain") ?? "")
      .trim()
      .toLowerCase();
    const marketsRaw = req.nextUrl.searchParams.get("markets") ?? "";
    const markets = marketsRaw
      .split(",")
      .map((s) => s.toLowerCase().trim())
      .filter((s): s is W01Market => ALLOWED_MARKETS.includes(s as W01Market));
    const displayLimitRaw = req.nextUrl.searchParams.get("display_limit") ?? "12";
    const displayLimit = Math.max(1, Math.min(12, Number(displayLimitRaw) || 12));

    if (!advertiserDomain) {
      return new Response("advertiser_domain required\n", { status: 400 });
    }
    if (advertiserDomain.includes("/") || advertiserDomain.includes(" ") || !advertiserDomain.includes(".")) {
      return new Response("advertiser_domain must be a bare domain (e.g. amazon.com)\n", { status: 400 });
    }
    if (markets.length === 0) {
      return new Response("at least one market required\n", { status: 400 });
    }

    if (isMockEnabled(req)) {
      return mockEndpointStream(req, "W09");
    }

    return realW09Stream(req, advertiserDomain, markets, displayLimit);
  }

  if (ep === "W10") {
    const ourDomain = (req.nextUrl.searchParams.get("our_domain") ?? "")
      .trim()
      .toLowerCase();
    const competitorDomainsRaw = req.nextUrl.searchParams.get("competitor_domains") ?? "";
    const competitorDomains = competitorDomainsRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const gapTypesRaw = req.nextUrl.searchParams.get("gap_types") ?? "";
    const gapTypes = gapTypesRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const marketsRaw = req.nextUrl.searchParams.get("markets") ?? "";
    const markets = marketsRaw
      .split(",")
      .map((s) => s.toLowerCase().trim())
      .filter((s): s is W01Market => ALLOWED_MARKETS.includes(s as W01Market));
    const displayLimitRaw = req.nextUrl.searchParams.get("display_limit") ?? "25";
    const displayLimit = Math.max(1, Math.min(100, Number(displayLimitRaw) || 25));

    if (!ourDomain) {
      return new Response("our_domain required\n", { status: 400 });
    }
    if (ourDomain.includes("/") || ourDomain.includes(" ") || !ourDomain.includes(".")) {
      return new Response("our_domain must be a bare domain (e.g. weslamic.com)\n", { status: 400 });
    }
    if (competitorDomains.length === 0) {
      return new Response("at least one competitor_domain required\n", { status: 400 });
    }
    if (competitorDomains.length > 4) {
      return new Response("competitor_domains max 4\n", { status: 400 });
    }
    if (gapTypes.length === 0) {
      return new Response("at least one gap_type required\n", { status: 400 });
    }
    if (gapTypes.includes("untapped") && competitorDomains.length < 2) {
      return new Response("gap_type 'untapped' requires at least 2 competitor_domains\n", { status: 400 });
    }
    if (markets.length === 0) {
      return new Response("at least one market required\n", { status: 400 });
    }

    if (isMockEnabled(req)) {
      return mockEndpointStream(req, "W10");
    }

    return realW10Stream(req, ourDomain, competitorDomains, gapTypes, markets, displayLimit);
  }

  if (ep === "W03") {
    const keyword = (req.nextUrl.searchParams.get("keyword") ?? "")
      .trim()
      .toLowerCase();
    const marketsRaw = req.nextUrl.searchParams.get("markets") ?? "";
    const markets = marketsRaw
      .split(",")
      .map((s) => s.toLowerCase().trim())
      .filter((s): s is W01Market => ALLOWED_MARKETS.includes(s as W01Market));
    const displayLimitRaw = req.nextUrl.searchParams.get("display_limit") ?? "3";
    const displayLimit = Math.max(1, Math.min(10, Number(displayLimitRaw) || 3));
    const seedKeyword =
      (req.nextUrl.searchParams.get("seed_keyword") ?? "").trim().toLowerCase() ||
      undefined;

    if (!keyword) {
      return new Response("keyword required\n", { status: 400 });
    }
    if (markets.length === 0) {
      return new Response("at least one market required\n", { status: 400 });
    }

    const refreshPool = req.nextUrl.searchParams.get("refresh_pool") === "1";
    const rowKey = req.nextUrl.searchParams.get("row_key");
    if (refreshPool && !rowKey) {
      return new Response("row_key required when refresh_pool=1\n", { status: 400 });
    }

    if (isMockEnabled(req)) {
      return mockEndpointStream(req, "W03");
    }

    return realW03Stream(
      req,
      keyword,
      markets,
      displayLimit,
      seedKeyword,
      refreshPool,
      refreshPool ? rowKey : null
    );
  }

  const keywordsRaw = req.nextUrl.searchParams.get("keywords") ?? "";
  const marketsRaw = req.nextUrl.searchParams.get("markets") ?? "";
  const keywords = keywordsRaw
    .split("\n")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const markets = marketsRaw
    .split(",")
    .map((s) => s.trim().toLowerCase() as W01Market)
    .filter((m) => ALLOWED_MARKETS.includes(m));

  if (keywords.length === 0) {
    return new Response("keywords required\n", { status: 400 });
  }
  if (markets.length === 0) {
    return new Response("at least one market required\n", { status: 400 });
  }

  if (isMockEnabled(req)) {
    return mockEndpointStream(req, "W01");
  }

  return realW01Stream(req, keywords, markets);
}

function realW01Stream(
  req: NextRequest,
  keywords: string[],
  markets: W01Market[]
): Response {
  const encoder = new TextEncoder();

  // 笛卡尔积词×市场：每个市场一个独立 batch_id，并发 M 次 webhook
  const batches = markets.map((m) => ({ batchId: buildBatchId(m), market: m }));

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const enqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        enqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        close();
      });

      // banner 事件：标记本次为真模式 + 暴露所有子 batch_id
      enqueue(
        `event: banner\ndata: ${JSON.stringify({
          mock: false,
          batches,
          keywords_count: keywords.length,
          markets_count: markets.length,
        })}\n\n`
      );

      // 触发 M 个 webhook（并发）
      const triggerResults = await Promise.allSettled(
        batches.map((b) =>
          triggerW01PhraseThese({
            batchId: b.batchId,
            keywords,
            market: b.market,
          })
        )
      );

      // 触发失败的 batch 直接标记完成（避免轮询永远等不到事件）
      const finishedBatches = new Set<string>();
      const triggerErrors: Record<string, string> = {};
      triggerResults.forEach((r, i) => {
        const batchId = batches[i].batchId;
        if (r.status === "rejected") {
          finishedBatches.add(batchId);
          triggerErrors[batchId] =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
        } else if (!r.value.webhookOk) {
          finishedBatches.add(batchId);
          triggerErrors[batchId] = `webhook ${r.value.webhookStatus}`;
        }
      });

      // 把触发失败的合成事件推给前端
      for (const [batchId, errMsg] of Object.entries(triggerErrors)) {
        const market = batches.find((b) => b.batchId === batchId)?.market ?? "";
        const evt = {
          version: "2025-01" as const,
          event_id: `${batchId}-trigger-failed`,
          seq: 0,
          ts: new Date().toISOString(),
          batch_id: batchId,
          workflow_id: "W01",
          execution_id: "trigger",
          node_name: "Trigger Failed",
          node_status: "failed" as const,
          payload: { error: { code: "WEBHOOK_TRIGGER_FAILED", message: errMsg, market } },
        };
        enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      // 轮询每个 batch 的 callback 事件，按 seq 推进
      const lastSeqByBatch: Record<string, number> = {};
      for (const b of batches) lastSeqByBatch[b.batchId] = -1;

      const startedAt = Date.now();
      while (!cancelled && finishedBatches.size < batches.length) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          // 超时：把还没完成的 batch 标记成 timeout
          for (const b of batches) {
            if (finishedBatches.has(b.batchId)) continue;
            finishedBatches.add(b.batchId);
            const evt = {
              version: "2025-01" as const,
              event_id: `${b.batchId}-timeout`,
              seq: 90,
              ts: new Date().toISOString(),
              batch_id: b.batchId,
              workflow_id: "W01",
              execution_id: "timeout",
              node_name: "Stream Timeout",
              node_status: "failed" as const,
              payload: { error: { code: "STREAM_TIMEOUT", message: `> ${HARD_TIMEOUT_MS}ms` } },
            };
            enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
          }
          break;
        }

        for (const b of batches) {
          if (finishedBatches.has(b.batchId)) continue;
          let newEvents: typeof n8nCallbackEvents.$inferSelect[] = [];
          try {
            newEvents = await db
              .select()
              .from(n8nCallbackEvents)
              .where(
                and(
                  eq(n8nCallbackEvents.batchId, b.batchId),
                  gt(n8nCallbackEvents.seq, lastSeqByBatch[b.batchId])
                )
              )
              .orderBy(asc(n8nCallbackEvents.seq));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({ error: `db poll failed: ${msg}` })}\n\n`
            );
            continue;
          }
          for (const ev of newEvents) {
            const evt = {
              version: "2025-01" as const,
              event_id: ev.eventId,
              seq: ev.seq,
              ts: ev.ts.toISOString(),
              batch_id: ev.batchId,
              workflow_id: ev.workflowId,
              execution_id: ev.executionId,
              node_name: ev.nodeName,
              node_status: ev.nodeStatus as
                | "started" | "running" | "progress" | "succeeded" | "failed" | "warning",
              payload: ev.payload as Record<string, unknown> | null | undefined,
            };
            // schema 校验失败也不阻断，原样推
            const parsed = N8nCallbackEventSchema.safeParse(evt);
            const data = parsed.success ? parsed.data : evt;
            enqueue(`id: ${ev.eventId}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeqByBatch[b.batchId] = ev.seq;
            if (TERMINAL_NODES.has(ev.nodeName)) {
              finishedBatches.add(b.batchId);
              break;
            }
          }
        }
        if (finishedBatches.size >= batches.length) break;
        await sleep(POLL_INTERVAL_MS);
      }

      // 拉 staging table 中各 batch 的数据行
      const allRows: StagingRow[] = [];
      for (const b of batches) {
        if (triggerErrors[b.batchId]) continue;
        try {
          const rows = await getStagingRowsByBatch(b.batchId);
          allRows.push(...rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `staging fetch failed for ${b.batchId}: ${msg}`,
            })}\n\n`
          );
        }
      }

      // 推 rows 事件（前端用此事件渲染结果表）
      enqueue(`event: rows\ndata: ${JSON.stringify({ rows: allRows })}\n\n`);

      // 合成 _done 终态事件，触发前端关流
      const failed = Object.keys(triggerErrors).length > 0;
      const doneEvt = {
        version: "2025-01" as const,
        event_id: `_done-${randomUUID().slice(0, 8)}`,
        seq: 99,
        ts: new Date().toISOString(),
        batch_id: batches[0]?.batchId ?? "unknown",
        workflow_id: "W01",
        execution_id: "_done",
        node_name: "_done",
        node_status: failed && allRows.length === 0 ? "failed" as const : "succeeded" as const,
        payload: {
          rows_new: allRows.length,
          total_batches: batches.length,
          failed_batches: Object.keys(triggerErrors).length,
          // phrase_these: 10u/row (Semrush official). Use actual row count from staging,
          // not keywords × markets estimate (upper-bound before submit).
          units_actual: allRows.length * 10,
        },
      };
      enqueue(`data: ${JSON.stringify(doneEvt)}\n\n`);

      clearInterval(heartbeat);
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function realW02Stream(
  req: NextRequest,
  keyword: string,
  markets: W01Market[]
): Response {
  const encoder = new TextEncoder();
  const batches = markets.map((m) => ({ batchId: buildW02BatchId(m), market: m }));

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const enqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        enqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        close();
      });

      enqueue(
        `event: banner\ndata: ${JSON.stringify({
          mock: false,
          batches,
          keyword,
          markets_count: markets.length,
        })}\n\n`
      );

      const triggerResults = await Promise.allSettled(
        batches.map((b) =>
          triggerW02PhraseThis({
            batchId: b.batchId,
            keyword,
            market: b.market,
          })
        )
      );

      const finishedBatches = new Set<string>();
      const triggerErrors: Record<string, string> = {};
      triggerResults.forEach((r, i) => {
        const batchId = batches[i].batchId;
        if (r.status === "rejected") {
          finishedBatches.add(batchId);
          triggerErrors[batchId] =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
        } else if (!r.value.webhookOk) {
          finishedBatches.add(batchId);
          triggerErrors[batchId] = `webhook ${r.value.webhookStatus}`;
        }
      });

      for (const [batchId, errMsg] of Object.entries(triggerErrors)) {
        const market = batches.find((b) => b.batchId === batchId)?.market ?? "";
        const evt = {
          version: "2025-01" as const,
          event_id: `${batchId}-trigger-failed`,
          seq: 0,
          ts: new Date().toISOString(),
          batch_id: batchId,
          workflow_id: "W02",
          execution_id: "trigger",
          node_name: "Trigger Failed",
          node_status: "failed" as const,
          payload: { error: { code: "WEBHOOK_TRIGGER_FAILED", message: errMsg, market } },
        };
        enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      const lastSeqByBatch: Record<string, number> = {};
      for (const b of batches) lastSeqByBatch[b.batchId] = -1;

      const startedAt = Date.now();
      while (!cancelled && finishedBatches.size < batches.length) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          for (const b of batches) {
            if (finishedBatches.has(b.batchId)) continue;
            finishedBatches.add(b.batchId);
            const evt = {
              version: "2025-01" as const,
              event_id: `${b.batchId}-timeout`,
              seq: 90,
              ts: new Date().toISOString(),
              batch_id: b.batchId,
              workflow_id: "W02",
              execution_id: "timeout",
              node_name: "Stream Timeout",
              node_status: "failed" as const,
              payload: { error: { code: "STREAM_TIMEOUT", message: `> ${HARD_TIMEOUT_MS}ms` } },
            };
            enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
          }
          break;
        }

        for (const b of batches) {
          if (finishedBatches.has(b.batchId)) continue;
          let newEvents: typeof n8nCallbackEvents.$inferSelect[] = [];
          try {
            newEvents = await db
              .select()
              .from(n8nCallbackEvents)
              .where(
                and(
                  eq(n8nCallbackEvents.batchId, b.batchId),
                  gt(n8nCallbackEvents.seq, lastSeqByBatch[b.batchId])
                )
              )
              .orderBy(asc(n8nCallbackEvents.seq));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({ error: `db poll failed: ${msg}` })}\n\n`
            );
            continue;
          }
          for (const ev of newEvents) {
            const evt = {
              version: "2025-01" as const,
              event_id: ev.eventId,
              seq: ev.seq,
              ts: ev.ts.toISOString(),
              batch_id: ev.batchId,
              workflow_id: ev.workflowId,
              execution_id: ev.executionId,
              node_name: ev.nodeName,
              node_status: ev.nodeStatus as
                | "started" | "running" | "progress" | "succeeded" | "failed" | "warning",
              payload: ev.payload as Record<string, unknown> | null | undefined,
            };
            const parsed = N8nCallbackEventSchema.safeParse(evt);
            const data = parsed.success ? parsed.data : evt;
            enqueue(`id: ${ev.eventId}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeqByBatch[b.batchId] = ev.seq;
            if (TERMINAL_NODES.has(ev.nodeName)) {
              finishedBatches.add(b.batchId);
              break;
            }
          }
        }
        if (finishedBatches.size >= batches.length) break;
        await sleep(POLL_INTERVAL_MS);
      }

      const allRows: StagingRow[] = [];
      for (const b of batches) {
        if (triggerErrors[b.batchId]) continue;
        try {
          const rows = await getStagingRowsByBatch(b.batchId);
          allRows.push(...rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `staging fetch failed for ${b.batchId}: ${msg}`,
            })}\n\n`
          );
        }
      }

      enqueue(`event: rows\ndata: ${JSON.stringify({ rows: allRows })}\n\n`);

      const failed = Object.keys(triggerErrors).length > 0;
      const doneEvt = {
        version: "2025-01" as const,
        event_id: `_done-${randomUUID().slice(0, 8)}`,
        seq: 99,
        ts: new Date().toISOString(),
        batch_id: batches[0]?.batchId ?? "unknown",
        workflow_id: "W02",
        execution_id: "_done",
        node_name: "_done",
        node_status: failed && allRows.length === 0 ? "failed" as const : "succeeded" as const,
        payload: {
          rows_new: allRows.length,
          total_batches: batches.length,
          failed_batches: Object.keys(triggerErrors).length,
          // phrase_this: 10u/row (Semrush official). Use actual row count from staging,
          // not markets count estimate (upper-bound before submit).
          units_actual: allRows.length * 10,
        },
      };
      enqueue(`data: ${JSON.stringify(doneEvt)}\n\n`);

      clearInterval(heartbeat);
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function realW03Stream(
  req: NextRequest,
  keyword: string,
  markets: W01Market[],
  displayLimit: number,
  seedKeyword: string | undefined,
  refreshPool: boolean,
  rowKey: string | null
): Response {
  const encoder = new TextEncoder();
  const batches = markets.map((m) => ({ batchId: buildW03BatchId(m), market: m }));

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const enqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        enqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        close();
      });

      enqueue(
        `event: banner\ndata: ${JSON.stringify({
          mock: false,
          batches,
          keyword,
          markets_count: markets.length,
          display_limit: displayLimit,
        })}\n\n`
      );

      const triggerResults = await Promise.allSettled(
        batches.map((b) =>
          triggerW03PhraseOrganic({
            batchId: b.batchId,
            keyword,
            market: b.market,
            seedKeyword,
            displayLimit,
          })
        )
      );

      const finishedBatches = new Set<string>();
      const triggerErrors: Record<string, string> = {};
      triggerResults.forEach((r, i) => {
        const batchId = batches[i].batchId;
        if (r.status === "rejected") {
          finishedBatches.add(batchId);
          triggerErrors[batchId] =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
        } else if (!r.value.webhookOk) {
          finishedBatches.add(batchId);
          triggerErrors[batchId] = `webhook ${r.value.webhookStatus}`;
        }
      });

      for (const [batchId, errMsg] of Object.entries(triggerErrors)) {
        const market = batches.find((b) => b.batchId === batchId)?.market ?? "";
        const evt = {
          version: "2025-01" as const,
          event_id: `${batchId}-trigger-failed`,
          seq: 0,
          ts: new Date().toISOString(),
          batch_id: batchId,
          workflow_id: "W03",
          execution_id: "trigger",
          node_name: "Trigger Failed",
          node_status: "failed" as const,
          payload: { error: { code: "WEBHOOK_TRIGGER_FAILED", message: errMsg, market } },
        };
        enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      const lastSeqByBatch: Record<string, number> = {};
      for (const b of batches) lastSeqByBatch[b.batchId] = -1;

      const startedAt = Date.now();
      while (!cancelled && finishedBatches.size < batches.length) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          for (const b of batches) {
            if (finishedBatches.has(b.batchId)) continue;
            finishedBatches.add(b.batchId);
            const evt = {
              version: "2025-01" as const,
              event_id: `${b.batchId}-timeout`,
              seq: 90,
              ts: new Date().toISOString(),
              batch_id: b.batchId,
              workflow_id: "W03",
              execution_id: "timeout",
              node_name: "Stream Timeout",
              node_status: "failed" as const,
              payload: { error: { code: "STREAM_TIMEOUT", message: `> ${HARD_TIMEOUT_MS}ms` } },
            };
            enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
          }
          break;
        }

        for (const b of batches) {
          if (finishedBatches.has(b.batchId)) continue;
          let newEvents: typeof n8nCallbackEvents.$inferSelect[] = [];
          try {
            newEvents = await db
              .select()
              .from(n8nCallbackEvents)
              .where(
                and(
                  eq(n8nCallbackEvents.batchId, b.batchId),
                  gt(n8nCallbackEvents.seq, lastSeqByBatch[b.batchId])
                )
              )
              .orderBy(asc(n8nCallbackEvents.seq));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({ error: `db poll failed: ${msg}` })}\n\n`
            );
            continue;
          }
          for (const ev of newEvents) {
            const evt = {
              version: "2025-01" as const,
              event_id: ev.eventId,
              seq: ev.seq,
              ts: ev.ts.toISOString(),
              batch_id: ev.batchId,
              workflow_id: ev.workflowId,
              execution_id: ev.executionId,
              node_name: ev.nodeName,
              node_status: ev.nodeStatus as
                | "started" | "running" | "progress" | "succeeded" | "failed" | "warning",
              payload: ev.payload as Record<string, unknown> | null | undefined,
            };
            const parsed = N8nCallbackEventSchema.safeParse(evt);
            const data = parsed.success ? parsed.data : evt;
            enqueue(`id: ${ev.eventId}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeqByBatch[b.batchId] = ev.seq;
            if (TERMINAL_NODES.has(ev.nodeName)) {
              finishedBatches.add(b.batchId);
              break;
            }
          }
        }
        if (finishedBatches.size >= batches.length) break;
        await sleep(POLL_INTERVAL_MS);
      }

      const allRows: W03StagingRow[] = [];
      for (const b of batches) {
        if (triggerErrors[b.batchId]) continue;
        try {
          const rows = await getW03StagingRowsByBatch(b.batchId);
          allRows.push(...rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `staging fetch failed for ${b.batchId}: ${msg}`,
            })}\n\n`
          );
        }
      }

      enqueue(`event: rows\ndata: ${JSON.stringify({ rows: allRows })}\n\n`);

      // ---- refresh_pool=1: dual-write SERP features back to N8N pool + local PG ----
      // 触发口径：query 参数 refresh_pool=1 + row_key=<rowKey>。
      // 配额已在用户点击时消耗——本地 PG 的 last_manual_w03_at 无条件刷成 NOW()，
      // 与 N8N PATCH 是否成功、staging 是否拿到 codes 都解耦。
      // 仅当 W03 拿到 keyword_serp_features_codes 时，才同步 serp_features_keyword 列。
      if (refreshPool && rowKey) {
        const rawCodes = allRows[0]?.keyword_serp_features_codes;
        const codes: string | null =
          rawCodes && rawCodes !== "" ? rawCodes : null;

        let pgUpdated = false;
        let n8nUpdated = false;

        // 1) 本地 PG：无条件 UPDATE last_manual_w03_at；codes 非空时一并写 serp_features_keyword。
        try {
          const updateValues: Record<string, unknown> = {
            lastManualW03At: sql`NOW()`,
          };
          if (codes !== null) {
            updateValues.serpFeaturesKeyword = codes;
          }
          await db
            .update(keywords)
            .set(updateValues)
            .where(eq(keywords.rowKey, rowKey));
          pgUpdated = true;
          invalidateKeywordsCache(); // 手动刷新写了 keywords 表 → 失效列表/统计缓存
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `refresh_pool local pg update failed: ${msg}`,
            })}\n\n`
          );
        }

        // 2) N8N keywords_pool：仅当 codes 非空时 PATCH serp_features_keyword。
        //    注意：last_manual_w03_at 仅存在于本地 PG，绝对不要 PATCH 到 N8N。
        if (codes !== null) {
          try {
            const { rowsAffected } = await patchKeywordsPoolRow(rowKey, {
              serp_features_keyword: codes,
            });
            n8nUpdated = rowsAffected > 0;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({
                error: `refresh_pool n8n patch failed: ${msg}`,
              })}\n\n`
            );
          }
        }

        // 3) 发一条 Refresh Pool 节点事件，让前端能看到双写结果。
        //    任一目标失败 → warning；都成功（或都跳过）→ succeeded。
        const refreshFailed =
          !pgUpdated || (codes !== null && !n8nUpdated);
        const refreshEvt = {
          version: "2025-01" as const,
          event_id: `${batches[0]?.batchId ?? "unknown"}-refresh-pool`,
          seq: 95,
          ts: new Date().toISOString(),
          batch_id: batches[0]?.batchId ?? "unknown",
          workflow_id: "W03",
          execution_id: "refresh_pool",
          node_name: "Refresh Pool",
          node_status: (refreshFailed ? "warning" : "succeeded") as
            | "succeeded"
            | "warning",
          payload: {
            codes,
            pg_updated: pgUpdated,
            n8n_updated: n8nUpdated,
            row_key: rowKey,
          },
        };
        enqueue(
          `id: ${refreshEvt.event_id}\ndata: ${JSON.stringify(refreshEvt)}\n\n`
        );
      }

      const failed = Object.keys(triggerErrors).length > 0;
      const doneEvt = {
        version: "2025-01" as const,
        event_id: `_done-${randomUUID().slice(0, 8)}`,
        seq: 99,
        ts: new Date().toISOString(),
        batch_id: batches[0]?.batchId ?? "unknown",
        workflow_id: "W03",
        execution_id: "_done",
        node_name: "_done",
        node_status: failed && allRows.length === 0 ? "failed" as const : "succeeded" as const,
        payload: {
          rows_new: allRows.length,
          total_batches: batches.length,
          failed_batches: Object.keys(triggerErrors).length,
          // phrase_organic: 10u/row (Semrush official). Use actual row count from staging,
          // not displayLimit × markets estimate (upper-bound before submit).
          units_actual: allRows.length * 10,
        },
      };
      enqueue(`data: ${JSON.stringify(doneEvt)}\n\n`);

      clearInterval(heartbeat);
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function realW07Stream(
  req: NextRequest,
  keyword: string,
  displayLimit: number
): Response {
  const encoder = new TextEncoder();
  const batchId = buildW07BatchId();
  const batches = [{ batchId }];

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const enqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        enqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        close();
      });

      enqueue(
        `event: banner\ndata: ${JSON.stringify({
          mock: false,
          batches,
          keyword,
          display_limit: displayLimit,
        })}\n\n`
      );

      const triggerErrors: Record<string, string> = {};
      try {
        const r = await triggerW07PhraseAll({
          batchId,
          keyword,
          displayLimit,
        });
        if (!r.webhookOk) {
          triggerErrors[batchId] = `webhook ${r.webhookStatus}`;
        }
      } catch (err) {
        triggerErrors[batchId] =
          err instanceof Error ? err.message : String(err);
      }

      const finishedBatches = new Set<string>();
      if (triggerErrors[batchId]) {
        finishedBatches.add(batchId);
        const evt = {
          version: "2025-01" as const,
          event_id: `${batchId}-trigger-failed`,
          seq: 0,
          ts: new Date().toISOString(),
          batch_id: batchId,
          workflow_id: "W07",
          execution_id: "trigger",
          node_name: "Trigger Failed",
          node_status: "failed" as const,
          payload: {
            error: {
              code: "WEBHOOK_TRIGGER_FAILED",
              message: triggerErrors[batchId],
            },
          },
        };
        enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      const lastSeqByBatch: Record<string, number> = { [batchId]: -1 };
      const startedAt = Date.now();
      while (!cancelled && finishedBatches.size < batches.length) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          for (const b of batches) {
            if (finishedBatches.has(b.batchId)) continue;
            finishedBatches.add(b.batchId);
            const evt = {
              version: "2025-01" as const,
              event_id: `${b.batchId}-timeout`,
              seq: 90,
              ts: new Date().toISOString(),
              batch_id: b.batchId,
              workflow_id: "W07",
              execution_id: "timeout",
              node_name: "Stream Timeout",
              node_status: "failed" as const,
              payload: { error: { code: "STREAM_TIMEOUT", message: `> ${HARD_TIMEOUT_MS}ms` } },
            };
            enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
          }
          break;
        }

        for (const b of batches) {
          if (finishedBatches.has(b.batchId)) continue;
          let newEvents: typeof n8nCallbackEvents.$inferSelect[] = [];
          try {
            newEvents = await db
              .select()
              .from(n8nCallbackEvents)
              .where(
                and(
                  eq(n8nCallbackEvents.batchId, b.batchId),
                  gt(n8nCallbackEvents.seq, lastSeqByBatch[b.batchId])
                )
              )
              .orderBy(asc(n8nCallbackEvents.seq));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({ error: `db poll failed: ${msg}` })}\n\n`
            );
            continue;
          }
          for (const ev of newEvents) {
            const evt = {
              version: "2025-01" as const,
              event_id: ev.eventId,
              seq: ev.seq,
              ts: ev.ts.toISOString(),
              batch_id: ev.batchId,
              workflow_id: ev.workflowId,
              execution_id: ev.executionId,
              node_name: ev.nodeName,
              node_status: ev.nodeStatus as
                | "started" | "running" | "progress" | "succeeded" | "failed" | "warning",
              payload: ev.payload as Record<string, unknown> | null | undefined,
            };
            const parsed = N8nCallbackEventSchema.safeParse(evt);
            const data = parsed.success ? parsed.data : evt;
            enqueue(`id: ${ev.eventId}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeqByBatch[b.batchId] = ev.seq;
            if (TERMINAL_NODES.has(ev.nodeName)) {
              finishedBatches.add(b.batchId);
              break;
            }
          }
        }
        if (finishedBatches.size >= batches.length) break;
        await sleep(POLL_INTERVAL_MS);
      }

      const allRows: W07StagingRow[] = [];
      if (!triggerErrors[batchId]) {
        try {
          const rows = await getW07StagingRowsByBatch(batchId);
          allRows.push(...rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `staging fetch failed for ${batchId}: ${msg}`,
            })}\n\n`
          );
        }
      }

      enqueue(`event: rows\ndata: ${JSON.stringify({ rows: allRows })}\n\n`);

      const failed = Object.keys(triggerErrors).length > 0;
      const doneEvt = {
        version: "2025-01" as const,
        event_id: `_done-${randomUUID().slice(0, 8)}`,
        seq: 99,
        ts: new Date().toISOString(),
        batch_id: batchId,
        workflow_id: "W07",
        execution_id: "_done",
        node_name: "_done",
        node_status: failed && allRows.length === 0 ? "failed" as const : "succeeded" as const,
        payload: {
          rows_new: allRows.length,
          total_batches: batches.length,
          failed_batches: Object.keys(triggerErrors).length,
          // phrase_all: 10u/row (Semrush official). Use actual row count from staging,
          // not displayLimit × 11 (the 11-market estimate is unreliable and was
          // verified wrong: display_limit=1 returned 121 rows in production).
          units_actual: allRows.length * 10,
        },
      };
      enqueue(`data: ${JSON.stringify(doneEvt)}\n\n`);

      clearInterval(heartbeat);
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function realW04Stream(
  req: NextRequest,
  seedKeyword: string,
  markets: W01Market[],
  displayLimit: number
): Response {
  const encoder = new TextEncoder();
  const batches = markets.map((m) => ({ batchId: buildW04BatchId(m), market: m }));

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const enqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        enqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        close();
      });

      enqueue(
        `event: banner\ndata: ${JSON.stringify({
          mock: false,
          batches,
          seed_keyword: seedKeyword,
          markets_count: markets.length,
          display_limit: displayLimit,
        })}\n\n`
      );

      const triggerResults = await Promise.allSettled(
        batches.map((b) =>
          triggerW04PhraseQuestions({
            batchId: b.batchId,
            seedKeyword,
            market: b.market,
            displayLimit,
          })
        )
      );

      const finishedBatches = new Set<string>();
      const triggerErrors: Record<string, string> = {};
      triggerResults.forEach((r, i) => {
        const batchId = batches[i].batchId;
        if (r.status === "rejected") {
          finishedBatches.add(batchId);
          triggerErrors[batchId] =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
        } else if (!r.value.webhookOk) {
          finishedBatches.add(batchId);
          triggerErrors[batchId] = `webhook ${r.value.webhookStatus}`;
        }
      });

      for (const [batchId, errMsg] of Object.entries(triggerErrors)) {
        const market = batches.find((b) => b.batchId === batchId)?.market ?? "";
        const evt = {
          version: "2025-01" as const,
          event_id: `${batchId}-trigger-failed`,
          seq: 0,
          ts: new Date().toISOString(),
          batch_id: batchId,
          workflow_id: "W04",
          execution_id: "trigger",
          node_name: "Trigger Failed",
          node_status: "failed" as const,
          payload: { error: { code: "WEBHOOK_TRIGGER_FAILED", message: errMsg, market } },
        };
        enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      const lastSeqByBatch: Record<string, number> = {};
      for (const b of batches) lastSeqByBatch[b.batchId] = -1;

      const startedAt = Date.now();
      while (!cancelled && finishedBatches.size < batches.length) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          for (const b of batches) {
            if (finishedBatches.has(b.batchId)) continue;
            finishedBatches.add(b.batchId);
            const evt = {
              version: "2025-01" as const,
              event_id: `${b.batchId}-timeout`,
              seq: 90,
              ts: new Date().toISOString(),
              batch_id: b.batchId,
              workflow_id: "W04",
              execution_id: "timeout",
              node_name: "Stream Timeout",
              node_status: "failed" as const,
              payload: { error: { code: "STREAM_TIMEOUT", message: `> ${HARD_TIMEOUT_MS}ms` } },
            };
            enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
          }
          break;
        }

        for (const b of batches) {
          if (finishedBatches.has(b.batchId)) continue;
          let newEvents: typeof n8nCallbackEvents.$inferSelect[] = [];
          try {
            newEvents = await db
              .select()
              .from(n8nCallbackEvents)
              .where(
                and(
                  eq(n8nCallbackEvents.batchId, b.batchId),
                  gt(n8nCallbackEvents.seq, lastSeqByBatch[b.batchId])
                )
              )
              .orderBy(asc(n8nCallbackEvents.seq));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({ error: `db poll failed: ${msg}` })}\n\n`
            );
            continue;
          }
          for (const ev of newEvents) {
            const evt = {
              version: "2025-01" as const,
              event_id: ev.eventId,
              seq: ev.seq,
              ts: ev.ts.toISOString(),
              batch_id: ev.batchId,
              workflow_id: ev.workflowId,
              execution_id: ev.executionId,
              node_name: ev.nodeName,
              node_status: ev.nodeStatus as
                | "started" | "running" | "progress" | "succeeded" | "failed" | "warning",
              payload: ev.payload as Record<string, unknown> | null | undefined,
            };
            const parsed = N8nCallbackEventSchema.safeParse(evt);
            const data = parsed.success ? parsed.data : evt;
            enqueue(`id: ${ev.eventId}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeqByBatch[b.batchId] = ev.seq;
            if (TERMINAL_NODES.has(ev.nodeName)) {
              finishedBatches.add(b.batchId);
              break;
            }
          }
        }
        if (finishedBatches.size >= batches.length) break;
        await sleep(POLL_INTERVAL_MS);
      }

      const allRows: W04StagingRow[] = [];
      for (const b of batches) {
        if (triggerErrors[b.batchId]) continue;
        try {
          const rows = await getW04StagingRowsByBatch(b.batchId);
          allRows.push(...rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `staging fetch failed for ${b.batchId}: ${msg}`,
            })}\n\n`
          );
        }
      }

      enqueue(`event: rows\ndata: ${JSON.stringify({ rows: allRows })}\n\n`);

      const failed = Object.keys(triggerErrors).length > 0;
      const doneEvt = {
        version: "2025-01" as const,
        event_id: `_done-${randomUUID().slice(0, 8)}`,
        seq: 99,
        ts: new Date().toISOString(),
        batch_id: batches[0]?.batchId ?? "unknown",
        workflow_id: "W04",
        execution_id: "_done",
        node_name: "_done",
        node_status: failed && allRows.length === 0 ? "failed" as const : "succeeded" as const,
        payload: {
          rows_new: allRows.length,
          total_batches: batches.length,
          failed_batches: Object.keys(triggerErrors).length,
          // phrase_questions: 40u/row (Semrush official). Use actual row count from staging,
          // not displayLimit × markets estimate (upper-bound before submit).
          units_actual: allRows.length * 40,
        },
      };
      enqueue(`data: ${JSON.stringify(doneEvt)}\n\n`);

      clearInterval(heartbeat);
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function realW05Stream(
  req: NextRequest,
  seedKeyword: string,
  markets: W01Market[],
  displayLimit: number
): Response {
  const encoder = new TextEncoder();
  const batches = markets.map((m) => ({ batchId: buildW05BatchId(m), market: m }));

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const enqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        enqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        close();
      });

      enqueue(
        `event: banner\ndata: ${JSON.stringify({
          mock: false,
          batches,
          seed_keyword: seedKeyword,
          markets_count: markets.length,
          display_limit: displayLimit,
        })}\n\n`
      );

      const triggerResults = await Promise.allSettled(
        batches.map((b) =>
          triggerW05PhraseRelated({
            batchId: b.batchId,
            seedKeyword,
            market: b.market,
            displayLimit,
          })
        )
      );

      const finishedBatches = new Set<string>();
      const triggerErrors: Record<string, string> = {};
      triggerResults.forEach((r, i) => {
        const batchId = batches[i].batchId;
        if (r.status === "rejected") {
          finishedBatches.add(batchId);
          triggerErrors[batchId] =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
        } else if (!r.value.webhookOk) {
          finishedBatches.add(batchId);
          triggerErrors[batchId] = `webhook ${r.value.webhookStatus}`;
        }
      });

      for (const [batchId, errMsg] of Object.entries(triggerErrors)) {
        const market = batches.find((b) => b.batchId === batchId)?.market ?? "";
        const evt = {
          version: "2025-01" as const,
          event_id: `${batchId}-trigger-failed`,
          seq: 0,
          ts: new Date().toISOString(),
          batch_id: batchId,
          workflow_id: "W05",
          execution_id: "trigger",
          node_name: "Trigger Failed",
          node_status: "failed" as const,
          payload: { error: { code: "WEBHOOK_TRIGGER_FAILED", message: errMsg, market } },
        };
        enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      const lastSeqByBatch: Record<string, number> = {};
      for (const b of batches) lastSeqByBatch[b.batchId] = -1;

      const startedAt = Date.now();
      while (!cancelled && finishedBatches.size < batches.length) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          for (const b of batches) {
            if (finishedBatches.has(b.batchId)) continue;
            finishedBatches.add(b.batchId);
            const evt = {
              version: "2025-01" as const,
              event_id: `${b.batchId}-timeout`,
              seq: 90,
              ts: new Date().toISOString(),
              batch_id: b.batchId,
              workflow_id: "W05",
              execution_id: "timeout",
              node_name: "Stream Timeout",
              node_status: "failed" as const,
              payload: { error: { code: "STREAM_TIMEOUT", message: `> ${HARD_TIMEOUT_MS}ms` } },
            };
            enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
          }
          break;
        }

        for (const b of batches) {
          if (finishedBatches.has(b.batchId)) continue;
          let newEvents: typeof n8nCallbackEvents.$inferSelect[] = [];
          try {
            newEvents = await db
              .select()
              .from(n8nCallbackEvents)
              .where(
                and(
                  eq(n8nCallbackEvents.batchId, b.batchId),
                  gt(n8nCallbackEvents.seq, lastSeqByBatch[b.batchId])
                )
              )
              .orderBy(asc(n8nCallbackEvents.seq));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({ error: `db poll failed: ${msg}` })}\n\n`
            );
            continue;
          }
          for (const ev of newEvents) {
            const evt = {
              version: "2025-01" as const,
              event_id: ev.eventId,
              seq: ev.seq,
              ts: ev.ts.toISOString(),
              batch_id: ev.batchId,
              workflow_id: ev.workflowId,
              execution_id: ev.executionId,
              node_name: ev.nodeName,
              node_status: ev.nodeStatus as
                | "started" | "running" | "progress" | "succeeded" | "failed" | "warning",
              payload: ev.payload as Record<string, unknown> | null | undefined,
            };
            const parsed = N8nCallbackEventSchema.safeParse(evt);
            const data = parsed.success ? parsed.data : evt;
            enqueue(`id: ${ev.eventId}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeqByBatch[b.batchId] = ev.seq;
            if (TERMINAL_NODES.has(ev.nodeName)) {
              finishedBatches.add(b.batchId);
              break;
            }
          }
        }
        if (finishedBatches.size >= batches.length) break;
        await sleep(POLL_INTERVAL_MS);
      }

      const allRows: W05StagingRow[] = [];
      for (const b of batches) {
        if (triggerErrors[b.batchId]) continue;
        try {
          const rows = await getW05StagingRowsByBatch(b.batchId);
          allRows.push(...rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `staging fetch failed for ${b.batchId}: ${msg}`,
            })}\n\n`
          );
        }
      }

      enqueue(`event: rows\ndata: ${JSON.stringify({ rows: allRows })}\n\n`);

      const failed = Object.keys(triggerErrors).length > 0;
      const doneEvt = {
        version: "2025-01" as const,
        event_id: `_done-${randomUUID().slice(0, 8)}`,
        seq: 99,
        ts: new Date().toISOString(),
        batch_id: batches[0]?.batchId ?? "unknown",
        workflow_id: "W05",
        execution_id: "_done",
        node_name: "_done",
        node_status: failed && allRows.length === 0 ? "failed" as const : "succeeded" as const,
        payload: {
          rows_new: allRows.length,
          total_batches: batches.length,
          failed_batches: Object.keys(triggerErrors).length,
          // phrase_related: 40u/row (Semrush official). Use actual row count from staging,
          // not displayLimit × markets estimate (upper-bound before submit).
          units_actual: allRows.length * 40,
        },
      };
      enqueue(`data: ${JSON.stringify(doneEvt)}\n\n`);

      clearInterval(heartbeat);
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function realW06Stream(
  req: NextRequest,
  seedKeyword: string,
  markets: W01Market[],
  displayLimit: number
): Response {
  const encoder = new TextEncoder();
  const batches = markets.map((m) => ({ batchId: buildW06BatchId(m), market: m }));

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const enqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        enqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        close();
      });

      enqueue(
        `event: banner\ndata: ${JSON.stringify({
          mock: false,
          batches,
          seed_keyword: seedKeyword,
          markets_count: markets.length,
          display_limit: displayLimit,
        })}\n\n`
      );

      const triggerResults = await Promise.allSettled(
        batches.map((b) =>
          triggerW06PhraseFullsearch({
            batchId: b.batchId,
            seedKeyword,
            market: b.market,
            displayLimit,
          })
        )
      );

      const finishedBatches = new Set<string>();
      const triggerErrors: Record<string, string> = {};
      triggerResults.forEach((r, i) => {
        const batchId = batches[i].batchId;
        if (r.status === "rejected") {
          finishedBatches.add(batchId);
          triggerErrors[batchId] =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
        } else if (!r.value.webhookOk) {
          finishedBatches.add(batchId);
          triggerErrors[batchId] = `webhook ${r.value.webhookStatus}`;
        }
      });

      for (const [batchId, errMsg] of Object.entries(triggerErrors)) {
        const market = batches.find((b) => b.batchId === batchId)?.market ?? "";
        const evt = {
          version: "2025-01" as const,
          event_id: `${batchId}-trigger-failed`,
          seq: 0,
          ts: new Date().toISOString(),
          batch_id: batchId,
          workflow_id: "W06",
          execution_id: "trigger",
          node_name: "Trigger Failed",
          node_status: "failed" as const,
          payload: { error: { code: "WEBHOOK_TRIGGER_FAILED", message: errMsg, market } },
        };
        enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      const lastSeqByBatch: Record<string, number> = {};
      for (const b of batches) lastSeqByBatch[b.batchId] = -1;

      const startedAt = Date.now();
      while (!cancelled && finishedBatches.size < batches.length) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          for (const b of batches) {
            if (finishedBatches.has(b.batchId)) continue;
            finishedBatches.add(b.batchId);
            const evt = {
              version: "2025-01" as const,
              event_id: `${b.batchId}-timeout`,
              seq: 90,
              ts: new Date().toISOString(),
              batch_id: b.batchId,
              workflow_id: "W06",
              execution_id: "timeout",
              node_name: "Stream Timeout",
              node_status: "failed" as const,
              payload: { error: { code: "STREAM_TIMEOUT", message: `> ${HARD_TIMEOUT_MS}ms` } },
            };
            enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
          }
          break;
        }

        for (const b of batches) {
          if (finishedBatches.has(b.batchId)) continue;
          let newEvents: typeof n8nCallbackEvents.$inferSelect[] = [];
          try {
            newEvents = await db
              .select()
              .from(n8nCallbackEvents)
              .where(
                and(
                  eq(n8nCallbackEvents.batchId, b.batchId),
                  gt(n8nCallbackEvents.seq, lastSeqByBatch[b.batchId])
                )
              )
              .orderBy(asc(n8nCallbackEvents.seq));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({ error: `db poll failed: ${msg}` })}\n\n`
            );
            continue;
          }
          for (const ev of newEvents) {
            const evt = {
              version: "2025-01" as const,
              event_id: ev.eventId,
              seq: ev.seq,
              ts: ev.ts.toISOString(),
              batch_id: ev.batchId,
              workflow_id: ev.workflowId,
              execution_id: ev.executionId,
              node_name: ev.nodeName,
              node_status: ev.nodeStatus as
                | "started" | "running" | "progress" | "succeeded" | "failed" | "warning",
              payload: ev.payload as Record<string, unknown> | null | undefined,
            };
            const parsed = N8nCallbackEventSchema.safeParse(evt);
            const data = parsed.success ? parsed.data : evt;
            enqueue(`id: ${ev.eventId}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeqByBatch[b.batchId] = ev.seq;
            if (TERMINAL_NODES.has(ev.nodeName)) {
              finishedBatches.add(b.batchId);
              break;
            }
          }
        }
        if (finishedBatches.size >= batches.length) break;
        await sleep(POLL_INTERVAL_MS);
      }

      const allRows: W06StagingRow[] = [];
      for (const b of batches) {
        if (triggerErrors[b.batchId]) continue;
        try {
          const rows = await getW06StagingRowsByBatch(b.batchId);
          allRows.push(...rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `staging fetch failed for ${b.batchId}: ${msg}`,
            })}\n\n`
          );
        }
      }

      enqueue(`event: rows\ndata: ${JSON.stringify({ rows: allRows })}\n\n`);

      const failed = Object.keys(triggerErrors).length > 0;
      const doneEvt = {
        version: "2025-01" as const,
        event_id: `_done-${randomUUID().slice(0, 8)}`,
        seq: 99,
        ts: new Date().toISOString(),
        batch_id: batches[0]?.batchId ?? "unknown",
        workflow_id: "W06",
        execution_id: "_done",
        node_name: "_done",
        node_status: failed && allRows.length === 0 ? "failed" as const : "succeeded" as const,
        payload: {
          rows_new: allRows.length,
          total_batches: batches.length,
          failed_batches: Object.keys(triggerErrors).length,
          // phrase_fullsearch: 20u/row (Semrush official). Use actual row count from staging,
          // not displayLimit × markets estimate (upper-bound before submit).
          units_actual: allRows.length * 20,
        },
      };
      enqueue(`data: ${JSON.stringify(doneEvt)}\n\n`);

      clearInterval(heartbeat);
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function realW08Stream(
  req: NextRequest,
  advertiserDomain: string,
  markets: W01Market[],
  displayLimit: number
): Response {
  const encoder = new TextEncoder();
  const batches = markets.map((m) => ({ batchId: buildW08BatchId(m), market: m }));

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const enqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        enqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        close();
      });

      enqueue(
        `event: banner\ndata: ${JSON.stringify({
          mock: false,
          batches,
          advertiser_domain: advertiserDomain,
          markets_count: markets.length,
          display_limit: displayLimit,
        })}\n\n`
      );

      const triggerResults = await Promise.allSettled(
        batches.map((b) =>
          triggerW08DomainAdwords({
            batchId: b.batchId,
            advertiserDomain,
            market: b.market,
            displayLimit,
          })
        )
      );

      const finishedBatches = new Set<string>();
      const triggerErrors: Record<string, string> = {};
      triggerResults.forEach((r, i) => {
        const batchId = batches[i].batchId;
        if (r.status === "rejected") {
          finishedBatches.add(batchId);
          triggerErrors[batchId] =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
        } else if (!r.value.webhookOk) {
          finishedBatches.add(batchId);
          triggerErrors[batchId] = `webhook ${r.value.webhookStatus}`;
        }
      });

      for (const [batchId, errMsg] of Object.entries(triggerErrors)) {
        const market = batches.find((b) => b.batchId === batchId)?.market ?? "";
        const evt = {
          version: "2025-01" as const,
          event_id: `${batchId}-trigger-failed`,
          seq: 0,
          ts: new Date().toISOString(),
          batch_id: batchId,
          workflow_id: "W08",
          execution_id: "trigger",
          node_name: "Trigger Failed",
          node_status: "failed" as const,
          payload: { error: { code: "WEBHOOK_TRIGGER_FAILED", message: errMsg, market } },
        };
        enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      const lastSeqByBatch: Record<string, number> = {};
      for (const b of batches) lastSeqByBatch[b.batchId] = -1;

      const startedAt = Date.now();
      while (!cancelled && finishedBatches.size < batches.length) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          for (const b of batches) {
            if (finishedBatches.has(b.batchId)) continue;
            finishedBatches.add(b.batchId);
            const evt = {
              version: "2025-01" as const,
              event_id: `${b.batchId}-timeout`,
              seq: 90,
              ts: new Date().toISOString(),
              batch_id: b.batchId,
              workflow_id: "W08",
              execution_id: "timeout",
              node_name: "Stream Timeout",
              node_status: "failed" as const,
              payload: { error: { code: "STREAM_TIMEOUT", message: `> ${HARD_TIMEOUT_MS}ms` } },
            };
            enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
          }
          break;
        }

        for (const b of batches) {
          if (finishedBatches.has(b.batchId)) continue;
          let newEvents: typeof n8nCallbackEvents.$inferSelect[] = [];
          try {
            newEvents = await db
              .select()
              .from(n8nCallbackEvents)
              .where(
                and(
                  eq(n8nCallbackEvents.batchId, b.batchId),
                  gt(n8nCallbackEvents.seq, lastSeqByBatch[b.batchId])
                )
              )
              .orderBy(asc(n8nCallbackEvents.seq));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({ error: `db poll failed: ${msg}` })}\n\n`
            );
            continue;
          }
          for (const ev of newEvents) {
            const evt = {
              version: "2025-01" as const,
              event_id: ev.eventId,
              seq: ev.seq,
              ts: ev.ts.toISOString(),
              batch_id: ev.batchId,
              workflow_id: ev.workflowId,
              execution_id: ev.executionId,
              node_name: ev.nodeName,
              node_status: ev.nodeStatus as
                | "started" | "running" | "progress" | "succeeded" | "failed" | "warning",
              payload: ev.payload as Record<string, unknown> | null | undefined,
            };
            const parsed = N8nCallbackEventSchema.safeParse(evt);
            const data = parsed.success ? parsed.data : evt;
            enqueue(`id: ${ev.eventId}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeqByBatch[b.batchId] = ev.seq;
            if (TERMINAL_NODES.has(ev.nodeName)) {
              finishedBatches.add(b.batchId);
              break;
            }
          }
        }
        if (finishedBatches.size >= batches.length) break;
        await sleep(POLL_INTERVAL_MS);
      }

      const allRows: W08StagingRow[] = [];
      for (const b of batches) {
        if (triggerErrors[b.batchId]) continue;
        try {
          const rows = await getW08StagingRowsByBatch(b.batchId);
          allRows.push(...rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `staging fetch failed for ${b.batchId}: ${msg}`,
            })}\n\n`
          );
        }
      }

      enqueue(`event: rows\ndata: ${JSON.stringify({ rows: allRows })}\n\n`);

      const failed = Object.keys(triggerErrors).length > 0;
      const doneEvt = {
        version: "2025-01" as const,
        event_id: `_done-${randomUUID().slice(0, 8)}`,
        seq: 99,
        ts: new Date().toISOString(),
        batch_id: batches[0]?.batchId ?? "unknown",
        workflow_id: "W08",
        execution_id: "_done",
        node_name: "_done",
        node_status: failed && allRows.length === 0 ? "failed" as const : "succeeded" as const,
        payload: {
          rows_new: allRows.length,
          total_batches: batches.length,
          failed_batches: Object.keys(triggerErrors).length,
          // domain_adwords: 20u/row. Use actual staging row count,
          // not displayLimit × markets estimate (over-counts on NOTHING_FOUND).
          units_actual: allRows.length * 20,
        },
      };
      enqueue(`data: ${JSON.stringify(doneEvt)}\n\n`);

      clearInterval(heartbeat);
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function realW09Stream(
  req: NextRequest,
  advertiserDomain: string,
  markets: W01Market[],
  displayLimit: number
): Response {
  const encoder = new TextEncoder();
  const batches = markets.map((m) => ({ batchId: buildW09BatchId(m), market: m }));

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const enqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        enqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        close();
      });

      enqueue(
        `event: banner\ndata: ${JSON.stringify({
          mock: false,
          batches,
          advertiser_domain: advertiserDomain,
          markets_count: markets.length,
          display_limit: displayLimit,
        })}\n\n`
      );

      const triggerResults = await Promise.allSettled(
        batches.map((b) =>
          triggerW09DomainAdwordsHistorical({
            batchId: b.batchId,
            advertiserDomain,
            market: b.market,
            displayLimit,
          })
        )
      );

      const finishedBatches = new Set<string>();
      const triggerErrors: Record<string, string> = {};
      triggerResults.forEach((r, i) => {
        const batchId = batches[i].batchId;
        if (r.status === "rejected") {
          finishedBatches.add(batchId);
          triggerErrors[batchId] =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
        } else if (!r.value.webhookOk) {
          finishedBatches.add(batchId);
          triggerErrors[batchId] = `webhook ${r.value.webhookStatus}`;
        }
      });

      for (const [batchId, errMsg] of Object.entries(triggerErrors)) {
        const market = batches.find((b) => b.batchId === batchId)?.market ?? "";
        const evt = {
          version: "2025-01" as const,
          event_id: `${batchId}-trigger-failed`,
          seq: 0,
          ts: new Date().toISOString(),
          batch_id: batchId,
          workflow_id: "W09",
          execution_id: "trigger",
          node_name: "Trigger Failed",
          node_status: "failed" as const,
          payload: { error: { code: "WEBHOOK_TRIGGER_FAILED", message: errMsg, market } },
        };
        enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      const lastSeqByBatch: Record<string, number> = {};
      for (const b of batches) lastSeqByBatch[b.batchId] = -1;

      const startedAt = Date.now();
      while (!cancelled && finishedBatches.size < batches.length) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          for (const b of batches) {
            if (finishedBatches.has(b.batchId)) continue;
            finishedBatches.add(b.batchId);
            const evt = {
              version: "2025-01" as const,
              event_id: `${b.batchId}-timeout`,
              seq: 90,
              ts: new Date().toISOString(),
              batch_id: b.batchId,
              workflow_id: "W09",
              execution_id: "timeout",
              node_name: "Stream Timeout",
              node_status: "failed" as const,
              payload: { error: { code: "STREAM_TIMEOUT", message: `> ${HARD_TIMEOUT_MS}ms` } },
            };
            enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
          }
          break;
        }

        for (const b of batches) {
          if (finishedBatches.has(b.batchId)) continue;
          let newEvents: typeof n8nCallbackEvents.$inferSelect[] = [];
          try {
            newEvents = await db
              .select()
              .from(n8nCallbackEvents)
              .where(
                and(
                  eq(n8nCallbackEvents.batchId, b.batchId),
                  gt(n8nCallbackEvents.seq, lastSeqByBatch[b.batchId])
                )
              )
              .orderBy(asc(n8nCallbackEvents.seq));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({ error: `db poll failed: ${msg}` })}\n\n`
            );
            continue;
          }
          for (const ev of newEvents) {
            const evt = {
              version: "2025-01" as const,
              event_id: ev.eventId,
              seq: ev.seq,
              ts: ev.ts.toISOString(),
              batch_id: ev.batchId,
              workflow_id: ev.workflowId,
              execution_id: ev.executionId,
              node_name: ev.nodeName,
              node_status: ev.nodeStatus as
                | "started" | "running" | "progress" | "succeeded" | "failed" | "warning",
              payload: ev.payload as Record<string, unknown> | null | undefined,
            };
            const parsed = N8nCallbackEventSchema.safeParse(evt);
            const data = parsed.success ? parsed.data : evt;
            enqueue(`id: ${ev.eventId}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeqByBatch[b.batchId] = ev.seq;
            if (TERMINAL_NODES.has(ev.nodeName)) {
              finishedBatches.add(b.batchId);
              break;
            }
          }
        }
        if (finishedBatches.size >= batches.length) break;
        await sleep(POLL_INTERVAL_MS);
      }

      const allRows: W09StagingRow[] = [];
      for (const b of batches) {
        if (triggerErrors[b.batchId]) continue;
        try {
          const rows = await getW09StagingRowsByBatch(b.batchId);
          allRows.push(...rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `staging fetch failed for ${b.batchId}: ${msg}`,
            })}\n\n`
          );
        }
      }

      enqueue(`event: rows\ndata: ${JSON.stringify({ rows: allRows })}\n\n`);

      const failed = Object.keys(triggerErrors).length > 0;
      const doneEvt = {
        version: "2025-01" as const,
        event_id: `_done-${randomUUID().slice(0, 8)}`,
        seq: 99,
        ts: new Date().toISOString(),
        batch_id: batches[0]?.batchId ?? "unknown",
        workflow_id: "W09",
        execution_id: "_done",
        node_name: "_done",
        node_status: failed && allRows.length === 0 ? "failed" as const : "succeeded" as const,
        payload: {
          rows_new: allRows.length,
          total_batches: batches.length,
          failed_batches: Object.keys(triggerErrors).length,
          // domain_adwords_historical: 100u/row (Semrush official). Use actual staging row count,
          // not displayLimit × markets estimate (over-counts on NOTHING_FOUND).
          units_actual: allRows.length * 100,
        },
      };
      enqueue(`data: ${JSON.stringify(doneEvt)}\n\n`);

      clearInterval(heartbeat);
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function realW10Stream(
  req: NextRequest,
  ourDomain: string,
  competitorDomains: string[],
  gapTypes: string[],
  markets: W01Market[],
  displayLimit: number
): Response {
  const encoder = new TextEncoder();
  const batches = markets.map((m) => ({ batchId: buildW10BatchId(m), market: m }));

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const enqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        enqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        close();
      });

      enqueue(
        `event: banner\ndata: ${JSON.stringify({
          mock: false,
          batches,
          our_domain: ourDomain,
          competitor_domains: competitorDomains,
          gap_types: gapTypes,
          markets_count: markets.length,
          display_limit: displayLimit,
        })}\n\n`
      );

      const triggerResults = await Promise.allSettled(
        batches.map((b) =>
          triggerW10DomainDomains({
            batchId: b.batchId,
            ourDomain,
            competitorDomains,
            gapTypes,
            market: b.market,
            displayLimit,
          })
        )
      );

      const finishedBatches = new Set<string>();
      const triggerErrors: Record<string, string> = {};
      triggerResults.forEach((r, i) => {
        const batchId = batches[i].batchId;
        if (r.status === "rejected") {
          finishedBatches.add(batchId);
          triggerErrors[batchId] =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
        } else if (!r.value.webhookOk) {
          finishedBatches.add(batchId);
          triggerErrors[batchId] = `webhook ${r.value.webhookStatus}`;
        }
      });

      for (const [batchId, errMsg] of Object.entries(triggerErrors)) {
        const market = batches.find((b) => b.batchId === batchId)?.market ?? "";
        const evt = {
          version: "2025-01" as const,
          event_id: `${batchId}-trigger-failed`,
          seq: 0,
          ts: new Date().toISOString(),
          batch_id: batchId,
          workflow_id: "W10",
          execution_id: "trigger",
          node_name: "Trigger Failed",
          node_status: "failed" as const,
          payload: { error: { code: "WEBHOOK_TRIGGER_FAILED", message: errMsg, market } },
        };
        enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      const lastSeqByBatch: Record<string, number> = {};
      for (const b of batches) lastSeqByBatch[b.batchId] = -1;

      const startedAt = Date.now();
      while (!cancelled && finishedBatches.size < batches.length) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          for (const b of batches) {
            if (finishedBatches.has(b.batchId)) continue;
            finishedBatches.add(b.batchId);
            const evt = {
              version: "2025-01" as const,
              event_id: `${b.batchId}-timeout`,
              seq: 90,
              ts: new Date().toISOString(),
              batch_id: b.batchId,
              workflow_id: "W10",
              execution_id: "timeout",
              node_name: "Stream Timeout",
              node_status: "failed" as const,
              payload: { error: { code: "STREAM_TIMEOUT", message: `> ${HARD_TIMEOUT_MS}ms` } },
            };
            enqueue(`id: ${evt.event_id}\ndata: ${JSON.stringify(evt)}\n\n`);
          }
          break;
        }

        for (const b of batches) {
          if (finishedBatches.has(b.batchId)) continue;
          let newEvents: typeof n8nCallbackEvents.$inferSelect[] = [];
          try {
            newEvents = await db
              .select()
              .from(n8nCallbackEvents)
              .where(
                and(
                  eq(n8nCallbackEvents.batchId, b.batchId),
                  gt(n8nCallbackEvents.seq, lastSeqByBatch[b.batchId])
                )
              )
              .orderBy(asc(n8nCallbackEvents.seq));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            enqueue(
              `event: error\ndata: ${JSON.stringify({ error: `db poll failed: ${msg}` })}\n\n`
            );
            continue;
          }
          for (const ev of newEvents) {
            const evt = {
              version: "2025-01" as const,
              event_id: ev.eventId,
              seq: ev.seq,
              ts: ev.ts.toISOString(),
              batch_id: ev.batchId,
              workflow_id: ev.workflowId,
              execution_id: ev.executionId,
              node_name: ev.nodeName,
              node_status: ev.nodeStatus as
                | "started" | "running" | "progress" | "succeeded" | "failed" | "warning",
              payload: ev.payload as Record<string, unknown> | null | undefined,
            };
            const parsed = N8nCallbackEventSchema.safeParse(evt);
            const data = parsed.success ? parsed.data : evt;
            enqueue(`id: ${ev.eventId}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeqByBatch[b.batchId] = ev.seq;
            if (TERMINAL_NODES.has(ev.nodeName)) {
              finishedBatches.add(b.batchId);
              break;
            }
          }
        }
        if (finishedBatches.size >= batches.length) break;
        await sleep(POLL_INTERVAL_MS);
      }

      const allRows: W10StagingRow[] = [];
      for (const b of batches) {
        if (triggerErrors[b.batchId]) continue;
        try {
          const rows = await getW10StagingRowsByBatch(b.batchId);
          allRows.push(...rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue(
            `event: error\ndata: ${JSON.stringify({
              error: `staging fetch failed for ${b.batchId}: ${msg}`,
            })}\n\n`
          );
        }
      }

      enqueue(`event: rows\ndata: ${JSON.stringify({ rows: allRows })}\n\n`);

      const failed = Object.keys(triggerErrors).length > 0;
      const nonWeakCount = gapTypes.filter((t) => t !== "weak").length;
      const doneEvt = {
        version: "2025-01" as const,
        event_id: `_done-${randomUUID().slice(0, 8)}`,
        seq: 99,
        ts: new Date().toISOString(),
        batch_id: batches[0]?.batchId ?? "unknown",
        workflow_id: "W10",
        execution_id: "_done",
        node_name: "_done",
        node_status: failed && allRows.length === 0 ? "failed" as const : "succeeded" as const,
        payload: {
          rows_new: allRows.length,
          total_batches: batches.length,
          failed_batches: Object.keys(triggerErrors).length,
          // domain_domains: 80u/row (Semrush official). No overhead or base charge exists.
          // Use actual staging row count for precision — the formula estimate assumes Semrush
          // fills displayLimit rows per (competitor × gapType × market) combination,
          // which is often false. The old +200 buffer was fabricated and has been removed.
          units_actual: allRows.length * 80,
        },
      };
      enqueue(`data: ${JSON.stringify(doneEvt)}\n\n`);

      clearInterval(heartbeat);
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function helloWorldStream(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const heartbeat = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          /* */
        }
      }, 20_000);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* */
        }
      });

      try {
        for (let i = 0; i < 10; i++) {
          if (cancelled) return;
          const payload = JSON.stringify({ seq: i, ts: new Date().toISOString() });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* */
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function mockEndpointStream(req: NextRequest, endpoint: string) {
  const encoder = new TextEncoder();
  const batchId = randomUUID();
  const executionId = `mock-exec-${Date.now()}`;
  const workflowId = `mock-${endpoint.toLowerCase()}`;
  const baseTs = Date.now();

  // Parse markets for multi-market mock row generation
  const mockMarketsRaw = req.nextUrl.searchParams.get("markets") ?? "";
  const mockMarkets = mockMarketsRaw
    .split(",")
    .map((s) => s.toLowerCase().trim())
    .filter((s): s is W01Market => ALLOWED_MARKETS.includes(s as W01Market));
  const mockMarketList = mockMarkets.length > 0 ? mockMarkets : (["us"] as W01Market[]);

  const rawEvents: Array<Record<string, unknown>> = [
    {
      version: "2025-01", event_id: `${executionId}-0-trigger`, seq: 0,
      ts: new Date(baseTs).toISOString(), batch_id: batchId, workflow_id: workflowId,
      execution_id: executionId, node_name: "trigger", node_status: "started",
    },
    {
      version: "2025-01", event_id: `${executionId}-1-fetch_phrase_these`, seq: 1,
      ts: new Date(baseTs + 1000).toISOString(), batch_id: batchId, workflow_id: workflowId,
      execution_id: executionId, node_name: "fetch_phrase_these", node_status: "running",
    },
    {
      version: "2025-01", event_id: `${executionId}-2-fetch_phrase_these-progress`, seq: 2,
      ts: new Date(baseTs + 2000).toISOString(), batch_id: batchId, workflow_id: workflowId,
      execution_id: executionId, node_name: "fetch_phrase_these", node_status: "progress",
      payload: { processed: 0.5 },
    },
    {
      version: "2025-01", event_id: `${executionId}-3-write_staging`, seq: 3,
      ts: new Date(baseTs + 3000).toISOString(), batch_id: batchId, workflow_id: workflowId,
      execution_id: executionId, node_name: "write_staging", node_status: "running",
    },
    {
      version: "2025-01", event_id: `${executionId}-4-write_staging-done`, seq: 4,
      ts: new Date(baseTs + 4000).toISOString(), batch_id: batchId, workflow_id: workflowId,
      execution_id: executionId, node_name: "write_staging", node_status: "succeeded",
      payload: { rows_new: 42, rows_cached: 8, units_actual: 50 },
    },
    {
      version: "2025-01", event_id: `${executionId}-5-done`, seq: 5,
      ts: new Date(baseTs + 5000).toISOString(), batch_id: batchId, workflow_id: workflowId,
      execution_id: executionId, node_name: "_done", node_status: "succeeded",
    },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const heartbeat = setInterval(() => {
        if (cancelled) return;
        try { controller.enqueue(encoder.encode(`: heartbeat\n\n`)); } catch { /* */ }
      }, 20_000);

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* */ }
      });

      try {
        controller.enqueue(
          encoder.encode(
            `event: banner\ndata: ${JSON.stringify({ mock: true, batch_id: batchId, endpoint })}\n\n`
          )
        );

        for (const raw of rawEvents) {
          if (cancelled) return;
          const validated = N8nCallbackEventSchema.parse(raw);
          // _done 之前先推一个 mock rows，让前端表格有内容
          if (validated.node_name === "_done") {
            const ep = endpoint.toUpperCase();
            const mockRows =
              ep === "W03"
                ? mockMarketList.flatMap((mkt) => [
                    { keyword: "zikr ring", market: mkt, position: 1, position_type: "Organic", domain: "weslamic.com",          url: "https://weslamic.com/products/zikr-ring",                  keyword_serp_features_codes: "1,2,14",  domain_serp_features_codes: "1,14"  },
                    { keyword: "zikr ring", market: mkt, position: 2, position_type: "Organic", domain: "amazon.com",            url: "https://www.amazon.com/zikr-ring",                         keyword_serp_features_codes: "1,2,14",  domain_serp_features_codes: "1,2"   },
                    { keyword: "zikr ring", market: mkt, position: 3, position_type: "Organic", domain: "muslimfootprints.com",  url: "https://muslimfootprints.com/blog/best-zikr-ring",         keyword_serp_features_codes: "1,2,14",  domain_serp_features_codes: ""      },
                  ])
              : ep === "W07"
                ? [
                    { keyword: "zikr ring", market: "us", search_volume: 4400,  keyword_difficulty: 28, cpc: 0.92, competition: 0.51, number_of_results: 412000, trends: null, intent: "Commercial" },
                    { keyword: "zikr ring", market: "uk", search_volume: 1900,  keyword_difficulty: 24, cpc: 0.71, competition: 0.42, number_of_results: 188000, trends: null, intent: "Commercial" },
                    { keyword: "zikr ring", market: "ca", search_volume: 880,   keyword_difficulty: 19, cpc: 0.55, competition: 0.31, number_of_results: 92000,  trends: null, intent: "Commercial" },
                    { keyword: "zikr ring", market: "au", search_volume: 720,   keyword_difficulty: 21, cpc: 0.61, competition: 0.34, number_of_results: 81000,  trends: null, intent: "Commercial" },
                    { keyword: "zikr ring", market: "de", search_volume: 590,   keyword_difficulty: 18, cpc: 0.47, competition: 0.28, number_of_results: 67000,  trends: null, intent: "Commercial" },
                    { keyword: "zikr ring", market: "fr", search_volume: 480,   keyword_difficulty: 16, cpc: 0.42, competition: 0.25, number_of_results: 54000,  trends: null, intent: "Commercial" },
                    { keyword: "zikr ring", market: "it", search_volume: 320,   keyword_difficulty: 14, cpc: 0.38, competition: 0.21, number_of_results: 42000,  trends: null, intent: "Commercial" },
                    { keyword: "zikr ring", market: "nl", search_volume: 260,   keyword_difficulty: 13, cpc: 0.34, competition: 0.18, number_of_results: 31000,  trends: null, intent: "Commercial" },
                    { keyword: "zikr ring", market: "be", search_volume: 170,   keyword_difficulty: 11, cpc: 0.28, competition: 0.15, number_of_results: 22000,  trends: null, intent: "Commercial" },
                    { keyword: "zikr ring", market: "br", search_volume: 390,   keyword_difficulty: 17, cpc: 0.31, competition: 0.22, number_of_results: 47000,  trends: null, intent: "Commercial" },
                    { keyword: "zikr ring", market: "tr", search_volume: 210,   keyword_difficulty: 12, cpc: 0.24, competition: 0.16, number_of_results: 28000,  trends: null, intent: "Commercial" },
                  ]
              : ep === "W04"
                ? mockMarketList.flatMap((mkt) => [
                    { keyword: "what is a zikr ring",            market: mkt, search_volume: 2400,  keyword_difficulty: 18, cpc: 0.42, competition: 0.21, number_of_results: 134000,  trends: "0.4,0.5,0.6,0.7,0.8,0.9,1.0,1.0,1.0,0.9,0.9,1.0", intent: "Informational", question_type: "what" },
                    { keyword: "how to use zikr ring",           market: mkt, search_volume: 1900,  keyword_difficulty: 22, cpc: 0.55, competition: 0.34, number_of_results: 98000,   trends: "0.5,0.6,0.6,0.7,0.8,0.9,0.9,1.0,1.0,1.0,1.0,1.0", intent: "Informational", question_type: "how" },
                    { keyword: "why muslims wear zikr ring",     market: mkt, search_volume: 880,   keyword_difficulty: 14, cpc: 0.28, competition: 0.15, number_of_results: 56000,   trends: "0.6,0.6,0.7,0.7,0.8,0.9,0.9,0.9,1.0,1.0,1.0,1.0", intent: "Informational", question_type: "why" },
                    { keyword: "where to buy zikr ring",         market: mkt, search_volume: 1600,  keyword_difficulty: 31, cpc: 0.94, competition: 0.62, number_of_results: 211000,  trends: "0.4,0.5,0.5,0.6,0.7,0.8,0.9,1.0,1.0,1.0,1.0,1.0", intent: "Commercial",    question_type: "where" },
                    { keyword: "when to use zikr ring",          market: mkt, search_volume: 320,   keyword_difficulty: 12, cpc: 0.21, competition: 0.10, number_of_results: 24000,   trends: "0.5,0.6,0.6,0.7,0.7,0.8,0.9,0.9,1.0,1.0,1.0,1.0", intent: "Informational", question_type: "when" },
                    { keyword: "who invented zikr ring",         market: mkt, search_volume: 210,   keyword_difficulty: 9,  cpc: 0.15, competition: 0.08, number_of_results: 12000,   trends: "0.6,0.6,0.7,0.7,0.8,0.8,0.9,0.9,1.0,1.0,1.0,1.0", intent: "Informational", question_type: "who" },
                    { keyword: "which zikr ring is best",        market: mkt, search_volume: 590,   keyword_difficulty: 28, cpc: 0.78, competition: 0.51, number_of_results: 87000,   trends: "0.5,0.6,0.7,0.7,0.8,0.9,0.9,1.0,1.0,1.0,1.0,1.0", intent: "Commercial",    question_type: "which" },
                    { keyword: "can zikr ring be wet",           market: mkt, search_volume: 480,   keyword_difficulty: 11, cpc: 0.18, competition: 0.09, number_of_results: 31000,   trends: "0.6,0.7,0.7,0.8,0.8,0.9,0.9,1.0,1.0,1.0,1.0,1.0", intent: "Informational", question_type: "can" },
                    { keyword: "is zikr ring waterproof",        market: mkt, search_volume: 720,   keyword_difficulty: 19, cpc: 0.31, competition: 0.18, number_of_results: 47000,   trends: "0.5,0.6,0.7,0.8,0.8,0.9,0.9,1.0,1.0,1.0,1.0,1.0", intent: "Informational", question_type: "is" },
                    { keyword: "are zikr rings halal",           market: mkt, search_volume: 390,   keyword_difficulty: 7,  cpc: 0.12, competition: 0.05, number_of_results: 19000,   trends: "0.7,0.7,0.8,0.8,0.9,0.9,1.0,1.0,1.0,1.0,1.0,1.0", intent: "Informational", question_type: "are" },
                    { keyword: "do zikr rings need charging",    market: mkt, search_volume: 260,   keyword_difficulty: 16, cpc: 0.27, competition: 0.14, number_of_results: 22000,   trends: "0.5,0.6,0.6,0.7,0.7,0.8,0.9,0.9,1.0,1.0,1.0,1.0", intent: "Informational", question_type: "do" },
                    { keyword: "does zikr ring vibrate",         market: mkt, search_volume: 170,   keyword_difficulty: 10, cpc: 0.19, competition: 0.07, number_of_results: 15000,   trends: "0.6,0.6,0.7,0.7,0.8,0.8,0.9,0.9,1.0,1.0,1.0,1.0", intent: "Informational", question_type: "does" },
                  ])
              : ep === "W05"
                ? mockMarketList.flatMap((mkt) => [
                    { keyword: "muslim digital tasbih",      market: mkt, search_volume: 8100,  keyword_difficulty: 22, cpc: 0.88, competition: 0.45, number_of_results: 312000,  trends: "0.5,0.6,0.7,0.8,0.9,1.0,1.0,1.0,1.0,1.0,1.0,1.0", intent: "Commercial",    relevance_rate: 0.95 },
                    { keyword: "smart prayer counter",       market: mkt, search_volume: 6600,  keyword_difficulty: 19, cpc: 0.72, competition: 0.38, number_of_results: 241000,  trends: "0.4,0.5,0.6,0.7,0.8,0.9,0.9,1.0,1.0,1.0,1.0,1.0", intent: "Commercial",    relevance_rate: 0.88 },
                    { keyword: "electronic dhikr device",   market: mkt, search_volume: 4400,  keyword_difficulty: 17, cpc: 0.61, competition: 0.31, number_of_results: 178000,  trends: "0.5,0.5,0.6,0.7,0.8,0.9,0.9,0.9,1.0,1.0,1.0,1.0", intent: "Commercial",    relevance_rate: 0.79 },
                    { keyword: "wireless tasbih ring",       market: mkt, search_volume: 2900,  keyword_difficulty: 14, cpc: 0.54, competition: 0.27, number_of_results: 132000,  trends: "0.4,0.5,0.6,0.6,0.7,0.8,0.9,1.0,1.0,1.0,1.0,1.0", intent: "Commercial",    relevance_rate: 0.71 },
                    { keyword: "smart islamic ring",         market: mkt, search_volume: 1900,  keyword_difficulty: 12, cpc: 0.47, competition: 0.22, number_of_results: 97000,   trends: "0.5,0.6,0.6,0.7,0.8,0.9,0.9,1.0,1.0,1.0,1.0,1.0", intent: "Commercial",    relevance_rate: 0.62 },
                    { keyword: "muslim wearable",            market: mkt, search_volume: 1300,  keyword_difficulty: 28, cpc: 0.83, competition: 0.51, number_of_results: 214000,  trends: "0.6,0.7,0.7,0.8,0.9,1.0,1.0,1.0,1.0,1.0,1.0,1.0", intent: "Informational", relevance_rate: 0.55 },
                    { keyword: "digital prayer beads",       market: mkt, search_volume: 880,   keyword_difficulty: 9,  cpc: 0.31, competition: 0.16, number_of_results: 58000,   trends: "0.4,0.5,0.5,0.6,0.7,0.8,0.8,0.9,1.0,1.0,1.0,1.0", intent: "Commercial",    relevance_rate: 0.48 },
                    { keyword: "islamic smart jewelry",      market: mkt, search_volume: 480,   keyword_difficulty: 6,  cpc: 0.24, competition: 0.11, number_of_results: 34000,   trends: "0.5,0.5,0.6,0.6,0.7,0.8,0.8,0.9,0.9,1.0,1.0,1.0", intent: "Commercial",    relevance_rate: 0.40 },
                  ])
              : ep === "W06"
                ? mockMarketList.flatMap((mkt) => [
                    { keyword: "best zikr ring 2026",       market: mkt, search_volume: 4400, keyword_difficulty: 24, cpc: 0.95, competition: 0.52, number_of_results: 312000, trends: "0.6,0.7,0.8,0.8,0.9,1.0,1.0,1.0,1.0,1.0,1.0,1.0", intent: "Commercial",    relevance_rate: 0.95 },
                    { keyword: "zikr ring review",          market: mkt, search_volume: 2900, keyword_difficulty: 19, cpc: 0.71, competition: 0.41, number_of_results: 188000, trends: "0.5,0.6,0.7,0.8,0.9,0.9,1.0,1.0,1.0,1.0,1.0,1.0", intent: "Informational", relevance_rate: 0.88 },
                    { keyword: "zikr ring vs tasbih app",   market: mkt, search_volume: 1900, keyword_difficulty: 17, cpc: 0.55, competition: 0.31, number_of_results: 92000,  trends: "0.4,0.5,0.6,0.7,0.8,0.8,0.9,1.0,1.0,1.0,1.0,1.0", intent: "Informational", relevance_rate: 0.79 },
                    { keyword: "where to buy zikr ring",    market: mkt, search_volume: 1300, keyword_difficulty: 28, cpc: 0.88, competition: 0.55, number_of_results: 168000, trends: "0.5,0.6,0.7,0.7,0.8,0.9,1.0,1.0,1.0,1.0,1.0,1.0", intent: "Commercial",    relevance_rate: 0.71 },
                    { keyword: "zikr ring price india",     market: mkt, search_volume: 880,  keyword_difficulty: 12, cpc: 0.42, competition: 0.20, number_of_results: 58000,  trends: "0.4,0.5,0.5,0.6,0.7,0.8,0.9,1.0,1.0,1.0,1.0,1.0", intent: "Commercial",    relevance_rate: 0.62 },
                    { keyword: "buy zikr ring online",      market: mkt, search_volume: 720,  keyword_difficulty: 26, cpc: 1.04, competition: 0.61, number_of_results: 145000, trends: "0.5,0.6,0.7,0.8,0.9,1.0,1.0,1.0,1.0,1.0,1.0,1.0", intent: "Transactional", relevance_rate: 0.55 },
                    { keyword: "zikr ring battery life",    market: mkt, search_volume: 480,  keyword_difficulty: 8,  cpc: 0.27, competition: 0.14, number_of_results: 32000,  trends: "0.5,0.5,0.6,0.7,0.7,0.8,0.9,0.9,1.0,1.0,1.0,1.0", intent: "Informational", relevance_rate: 0.48 },
                    { keyword: "zikr ring discount code",   market: mkt, search_volume: 320,  keyword_difficulty: 11, cpc: 0.65, competition: 0.39, number_of_results: 47000,  trends: "0.4,0.5,0.6,0.6,0.7,0.8,0.8,0.9,1.0,1.0,1.0,1.0", intent: "Transactional", relevance_rate: 0.40 },
                  ])
              : ep === "W08"
                ? mockMarketList.flatMap((mkt) => [
                    { keyword: "wireless headphones",     market: mkt, advertiser_domain: "amazon.com", position: 1, visible_url: "amazon.com/electronics",    ad_title: "Wireless Headphones – Free Shipping",        ad_description: "Shop top-rated wireless headphones with Prime free 1-day delivery. Read reviews. Today's deals." },
                    { keyword: "running shoes",           market: mkt, advertiser_domain: "amazon.com", position: 2, visible_url: "amazon.com/shoes",           ad_title: "Running Shoes for Men & Women",              ad_description: "Huge selection of running shoes from top brands. Fast & free shipping with Prime." },
                    { keyword: "laptop deals",            market: mkt, advertiser_domain: "amazon.com", position: 3, visible_url: "amazon.com/computers",       ad_title: "Laptop Deals – Shop Now & Save",            ad_description: "Find the best laptop deals. Compare top brands. Free returns. Shop now at Amazon." },
                    { keyword: "kitchen appliances",      market: mkt, advertiser_domain: "amazon.com", position: 4, visible_url: "amazon.com/kitchen",         ad_title: "Kitchen Appliances – Today Only",           ad_description: "Upgrade your kitchen with our best-selling appliances. Free shipping over $25. Limited time offer." },
                    { keyword: "fitness tracker",         market: mkt, advertiser_domain: "amazon.com", position: 5, visible_url: "amazon.com/fitness",         ad_title: "Fitness Trackers – Best Sellers",           ad_description: "Track your health goals with top-rated fitness bands. Prime members get exclusive deals." },
                    { keyword: "tablet under 200",        market: mkt, advertiser_domain: "amazon.com", position: 6, visible_url: "amazon.com/tablets",         ad_title: "Tablets Under $200 – Shop Today",           ad_description: "Browse affordable tablets from top brands. Free same-day delivery for Prime members." },
                    { keyword: "books best sellers",      market: mkt, advertiser_domain: "amazon.com", position: 7, visible_url: "amazon.com/books",           ad_title: "Best-Selling Books – New Arrivals",         ad_description: "Discover this week's best sellers. Huge selection of fiction, non-fiction & more. Free delivery." },
                    { keyword: "clothing sale",           market: mkt, advertiser_domain: "amazon.com", position: 8, visible_url: "amazon.com/fashion",         ad_title: "Clothing Sale – Up to 50% Off",             ad_description: "Shop men's & women's fashion at unbeatable prices. Free returns. Shop the sale now at Amazon." },
                  ])
              : ep === "W09"
                ? mockMarketList.flatMap((mkt) => [
                    { keyword: "wireless headphones",  market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260415", position: 1, visible_url: "amazon.com/electronics", ad_title: "Wireless Headphones – Free Shipping",     ad_description: "Shop top-rated wireless headphones with Prime free 1-day delivery. Today's deals." },
                    { keyword: "spring fashion sale",  market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260415", position: 2, visible_url: "amazon.com/fashion",     ad_title: "Spring Sale – Up to 60% Off",             ad_description: "Refresh your wardrobe with the latest spring trends. Free returns. Shop now." },
                    { keyword: "outdoor furniture",    market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260415", position: 3, visible_url: "amazon.com/garden",      ad_title: "Outdoor Furniture – New Arrivals",         ad_description: "Patio sets, BBQs, and more. Free shipping on orders over $35." },
                    { keyword: "wireless headphones",  market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260315", position: 1, visible_url: "amazon.com/electronics", ad_title: "Wireless Headphones – Best Deals",         ad_description: "Top-rated wireless audio with active noise cancelling. Prime 2-day delivery." },
                    { keyword: "running shoes",        market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260315", position: 2, visible_url: "amazon.com/shoes",       ad_title: "Running Shoes for Men & Women",            ad_description: "Wide selection from top brands. Free returns within 30 days." },
                    { keyword: "smart watch",          market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260315", position: 4, visible_url: "amazon.com/wearable",    ad_title: "Smart Watches – Today's Deals",            ad_description: "Track fitness, get notifications. Latest models from leading brands." },
                    { keyword: "valentine's day gift", market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260215", position: 1, visible_url: "amazon.com/gifts",       ad_title: "Valentine's Day Gifts – Last Chance",      ad_description: "Heartfelt gifts for your loved one. Free 2-day Prime delivery available." },
                    { keyword: "winter coats",         market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260215", position: 3, visible_url: "amazon.com/outerwear",   ad_title: "Winter Coats – Up to 50% Off",             ad_description: "Stay warm with our top-rated outerwear. Easy returns. Shop now." },
                    { keyword: "wireless headphones",  market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260215", position: 5, visible_url: "amazon.com/audio",       ad_title: "Wireless Audio – New Releases",            ad_description: "Latest wireless headphones with industry-leading noise cancellation." },
                    { keyword: "new year fitness",     market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260115", position: 1, visible_url: "amazon.com/fitness",     ad_title: "New Year, New You – Fitness Gear",         ad_description: "Stick to your resolutions with our fitness equipment. Free shipping over $25." },
                    { keyword: "kitchen appliances",   market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260115", position: 2, visible_url: "amazon.com/kitchen",     ad_title: "Kitchen Appliances – Year-End Sale",       ad_description: "Upgrade your kitchen with top brands. Free returns. Today only." },
                    { keyword: "books best sellers",   market: mkt, advertiser_domain: "amazon.com", fetch_date: "20260115", position: 6, visible_url: "amazon.com/books",       ad_title: "Best-Selling Books – Discover Now",        ad_description: "This week's top reads across all genres. Free Kindle app available." },
                  ])
              : ep === "W10"
                ? mockMarketList.flatMap((mkt) => [
                    { keyword: "smart islamic device",      market: mkt, gap_type: "missing",  our_domain: "weslamic.com", competitor_domain: "amazon.com", our_position: 0,  competitor_position: 3,  search_volume: 4400, keyword_difficulty: 28, cpc: 0.92, competition: 0.51, number_of_results: 412000, trends: null },
                    { keyword: "muslim wearable tech",      market: mkt, gap_type: "missing",  our_domain: "weslamic.com", competitor_domain: "ebay.com",   our_position: 0,  competitor_position: 7,  search_volume: 2900, keyword_difficulty: 24, cpc: 0.71, competition: 0.42, number_of_results: 188000, trends: null },
                    { keyword: "digital tasbih bluetooth",  market: mkt, gap_type: "missing",  our_domain: "weslamic.com", competitor_domain: "amazon.com", our_position: 0,  competitor_position: 12, search_volume: 1800, keyword_difficulty: 19, cpc: 0.55, competition: 0.31, number_of_results: 92000,  trends: null },
                    { keyword: "zikr ring",                 market: mkt, gap_type: "common",   our_domain: "weslamic.com", competitor_domain: "amazon.com", our_position: 5,  competitor_position: 2,  search_volume: 8800, keyword_difficulty: 32, cpc: 1.12, competition: 0.62, number_of_results: 524000, trends: null },
                    { keyword: "muslim ring",               market: mkt, gap_type: "common",   our_domain: "weslamic.com", competitor_domain: "ebay.com",   our_position: 8,  competitor_position: 4,  search_volume: 6600, keyword_difficulty: 28, cpc: 0.88, competition: 0.51, number_of_results: 312000, trends: null },
                    { keyword: "smart prayer counter",      market: mkt, gap_type: "untapped", our_domain: "weslamic.com", competitor_domain: "amazon.com", our_position: 0,  competitor_position: 6,  search_volume: 4400, keyword_difficulty: 21, cpc: 0.78, competition: 0.41, number_of_results: 240000, trends: null },
                    { keyword: "wireless dhikr device",     market: mkt, gap_type: "untapped", our_domain: "weslamic.com", competitor_domain: "ebay.com",   our_position: 0,  competitor_position: 14, search_volume: 880,  keyword_difficulty: 12, cpc: 0.43, competition: 0.22, number_of_results: 58000,  trends: null },
                    { keyword: "halal smart jewelry",       market: mkt, gap_type: "weak",     our_domain: "weslamic.com", competitor_domain: "amazon.com", our_position: 28, competitor_position: 8,  search_volume: 1300, keyword_difficulty: 17, cpc: 0.52, competition: 0.30, number_of_results: 124000, trends: null },
                    { keyword: "muslim digital gift",       market: mkt, gap_type: "weak",     our_domain: "weslamic.com", competitor_domain: "ebay.com",   our_position: 35, competitor_position: 11, search_volume: 590,  keyword_difficulty: 9,  cpc: 0.31, competition: 0.18, number_of_results: 45000,  trends: null },
                    { keyword: "ramadan tech gift",         market: mkt, gap_type: "weak",     our_domain: "weslamic.com", competitor_domain: "amazon.com", our_position: 41, competitor_position: 6,  search_volume: 720,  keyword_difficulty: 14, cpc: 0.41, competition: 0.25, number_of_results: 87000,  trends: null },
                    { keyword: "eid wearable gift",         market: mkt, gap_type: "weak",     our_domain: "weslamic.com", competitor_domain: "ebay.com",   our_position: 52, competitor_position: 3,  search_volume: 480,  keyword_difficulty: 8,  cpc: 0.27, competition: 0.14, number_of_results: 32000,  trends: null },
                    { keyword: "halal smart bracelet",      market: mkt, gap_type: "weak",     our_domain: "weslamic.com", competitor_domain: "amazon.com", our_position: 67, competitor_position: 19, search_volume: 320,  keyword_difficulty: 6,  cpc: 0.21, competition: 0.10, number_of_results: 24000,  trends: null },
                  ])
                : [
                    { keyword: "hijab",          market: "sa", search_volume: 110000, keyword_difficulty: 42, cpc: 0.85, competition: 0.62, number_of_results: 12300000, trends: "0.6,0.7,0.8,0.9,1.0,1.0,1.0,0.9,0.9,1.0,1.0,1.0", intent: "Commercial" },
                    { keyword: "abaya",          market: "sa", search_volume: 74000,  keyword_difficulty: 38, cpc: 0.62, competition: 0.55, number_of_results: 8400000,  trends: "0.5,0.6,0.7,0.8,0.9,1.0,1.0,0.9,0.8,0.9,1.0,1.0", intent: "Commercial" },
                    { keyword: "ramadan dates",  market: "sa", search_volume: 18100,  keyword_difficulty: 29, cpc: 0.41, competition: 0.30, number_of_results: 2100000,  trends: "0.1,0.1,0.2,0.4,0.8,1.0,0.9,0.6,0.3,0.2,0.1,0.1", intent: "Informational" },
                    { keyword: "modest fashion", market: "sa", search_volume: 9900,   keyword_difficulty: 47, cpc: 1.12, competition: 0.81, number_of_results: 5600000,  trends: "0.7,0.8,0.9,0.9,1.0,1.0,1.0,1.0,0.9,0.9,1.0,1.0", intent: "Commercial" },
                    { keyword: "prayer mat",     market: "sa", search_volume: 6600,   keyword_difficulty: 35, cpc: 0.78, competition: 0.48, number_of_results: 3200000,  trends: "0.6,0.7,0.8,0.8,0.9,1.0,1.0,0.9,0.9,0.9,1.0,1.0", intent: "Commercial" },
                  ];
            controller.enqueue(
              encoder.encode(`event: rows\ndata: ${JSON.stringify({ rows: mockRows })}\n\n`)
            );
          }
          controller.enqueue(
            encoder.encode(`id: ${validated.event_id}\ndata: ${JSON.stringify(validated)}\n\n`)
          );
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        try {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ error: errMsg })}\n\n`)
          );
        } catch { /* */ }
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* */ }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
