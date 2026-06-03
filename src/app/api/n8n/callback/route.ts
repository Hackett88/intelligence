import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { n8nCallbackEvents, n8nCallbackProjections } from "@/db/schema";
import { N8nCallbackEventSchema } from "@/contracts/n8n-callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokensEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function ipAllowed(req: NextRequest): boolean {
  const raw = process.env.N8N_CALLBACK_IP_ALLOWLIST ?? "*";
  if (raw.trim() === "*") return true;
  const allow = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
  if (!ip) return false;
  return allow.includes(ip);
}

export async function POST(req: NextRequest) {
  const expectedToken = process.env.N8N_CALLBACK_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ error: "callback_token_unset" }, { status: 500 });
  }
  const incomingToken = req.headers.get("x-n8n-token") ?? "";
  if (!tokensEqual(incomingToken, expectedToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!ipAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = N8nCallbackEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "schema_validation_failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const ev = parsed.data;

  // 防重放（defense-in-depth）：拒绝时间戳偏离当前时间过大的事件——挡住"录下一条
  // 合法回调、隔很久再重发"的攻击。窗口默认 1 小时，足够宽松以吸收 n8n(Railway)↔APP
  // 之间的时钟偏移与正常网络延迟，正常实时回调（秒级到达）绝不会被误拒；可经
  // N8N_CALLBACK_MAX_SKEW_SEC 调整，设为 0 关闭。注意：同一 event_id 的逐字重放本就
  // 被下方 onConflictDoNothing 幂等吸收，此处是叠加的一层。
  const maxSkewSec = Number(process.env.N8N_CALLBACK_MAX_SKEW_SEC ?? "3600");
  if (maxSkewSec > 0) {
    const eventMs = new Date(ev.ts).getTime();
    if (Number.isFinite(eventMs) && Math.abs(Date.now() - eventMs) > maxSkewSec * 1000) {
      return NextResponse.json({ error: "stale_timestamp" }, { status: 422 });
    }
  }

  const inserted = await db
    .insert(n8nCallbackEvents)
    .values({
      eventId:     ev.event_id,
      seq:         ev.seq,
      ts:          new Date(ev.ts),
      batchId:     ev.batch_id,
      workflowId:  ev.workflow_id,
      executionId: ev.execution_id,
      nodeName:    ev.node_name,
      nodeStatus:  ev.node_status,
      payload:     ev.payload as object | undefined,
    })
    .onConflictDoNothing({ target: n8nCallbackEvents.eventId })
    .returning({ eventId: n8nCallbackEvents.eventId });

  const duplicate = inserted.length === 0;

  let advancedTo: number | null = null;
  await db.transaction(async (tx) => {
    await tx
      .insert(n8nCallbackProjections)
      .values({ batchId: ev.batch_id, expectedSeq: 0 })
      .onConflictDoNothing({ target: n8nCallbackProjections.batchId });

    while (true) {
      const proj = await tx
        .select()
        .from(n8nCallbackProjections)
        .where(sql`${n8nCallbackProjections.batchId} = ${ev.batch_id}`)
        .for("update");
      const current = proj[0];
      if (!current) break;
      const nextSeq = current.expectedSeq + 1;
      const next = await tx
        .select()
        .from(n8nCallbackEvents)
        .where(
          sql`${n8nCallbackEvents.batchId} = ${ev.batch_id} AND ${n8nCallbackEvents.seq} = ${nextSeq}`
        )
        .limit(1);
      if (next.length === 0) {
        advancedTo = current.expectedSeq;
        break;
      }
      await tx
        .update(n8nCallbackProjections)
        .set({
          expectedSeq: nextSeq,
          lastEventTs: next[0].ts,
          status:      next[0].nodeStatus,
          updatedAt:   new Date(),
        })
        .where(sql`${n8nCallbackProjections.batchId} = ${ev.batch_id}`);
      advancedTo = nextSeq;
    }
  });

  return NextResponse.json({
    received: true,
    duplicate,
    advanced_to: advancedTo,
  });
}
