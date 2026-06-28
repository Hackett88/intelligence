// GET/PUT /api/indexing/scheduler-config
//
// 应用内「收录定时检查」配置读写（app_scheduler_config 单行，id=1）。
// 由前端设置面板调用：GET 读当前配置，PUT 改 enabled / intervalMinutes / mode（可自由编辑）。
//
// 鉴权照抄 inspect-coverage/route.ts。
// 刻意【不加】生产 403 守卫：这只是改 PG 一行配置，生产也该能改；真正跑收录时调度器自己会判 key。

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { appSchedulerConfig, type AppSchedulerConfig } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// intervalMinutes 范围 5..43200（5 分钟 ~ 30 天）。只校验传入字段，全部可选（部分更新）。
const PutSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(5).max(43200).optional(),
  mode: z.enum(["incremental", "all"]).optional(),
});

function toWire(row: AppSchedulerConfig) {
  return {
    ok: true as const,
    enabled: row.enabled,
    intervalMinutes: row.intervalMinutes,
    mode: row.mode,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastRunSummary: row.lastRunSummary ?? null,
  };
}

async function readConfigRow(): Promise<AppSchedulerConfig | undefined> {
  const rows = await db
    .select()
    .from(appSchedulerConfig)
    .where(eq(appSchedulerConfig.id, 1));
  return rows[0];
}

export async function GET() {
  // ── 鉴权（照抄 inspect-coverage/route.ts） ──
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录" },
      { status: 401 }
    );
  }

  try {
    const row = await readConfigRow();
    if (!row) {
      return NextResponse.json(
        { ok: false, code: "CONFIG_MISSING", message: "调度器配置行不存在（应有 id=1 默认行）" },
        { status: 500 }
      );
    }
    return NextResponse.json(toWire(row));
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ ok: false, code: "DB_ERROR", message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  // ── 鉴权（照抄 inspect-coverage/route.ts） ──
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_JSON", message: "请求体不是合法 JSON" },
      { status: 400 }
    );
  }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "INVALID_BODY", message: "参数校验失败", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // 只更传入字段 + updatedAt=now()。
  const patch: Partial<typeof appSchedulerConfig.$inferInsert> = { updatedAt: new Date() };
  if (data.enabled !== undefined) patch.enabled = data.enabled;
  if (data.intervalMinutes !== undefined) patch.intervalMinutes = data.intervalMinutes;
  if (data.mode !== undefined) patch.mode = data.mode;

  try {
    const updated = await db
      .update(appSchedulerConfig)
      .set(patch)
      .where(eq(appSchedulerConfig.id, 1))
      .returning();
    const row = updated[0];
    if (!row) {
      return NextResponse.json(
        { ok: false, code: "CONFIG_MISSING", message: "调度器配置行不存在（应有 id=1 默认行）" },
        { status: 500 }
      );
    }
    return NextResponse.json(toWire(row));
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ ok: false, code: "DB_ERROR", message }, { status: 500 });
  }
}
