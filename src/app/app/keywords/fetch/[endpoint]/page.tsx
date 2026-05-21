import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { W01Workspace } from "../_components/W01Workspace";
import { W02Workspace } from "../_components/W02Workspace";
import { W03Workspace } from "../_components/W03Workspace";
import { W04Workspace } from "../_components/W04Workspace";
import { W05Workspace } from "../_components/W05Workspace";
import { W06Workspace } from "../_components/W06Workspace";
import { W07Workspace } from "../_components/W07Workspace";
import { W08Workspace } from "../_components/W08Workspace";
import { W09Workspace } from "../_components/W09Workspace";
import { W10Workspace } from "../_components/W10Workspace";

type SkillMeta = {
  title: string;
  description: string;
  available: boolean;
};

const SKILL_META: Record<string, SkillMeta> = {
  w01: {
    title: "批量关键词指标查询",
    description: "一次投一批词 × 多市场，秒看搜量、难度、CPC、意图、趋势",
    available: true,
  },
  w02: {
    title: "关键词指标查询",
    description: "单个核心词 × 多市场，秒查该词在每个市场的搜量、难度、CPC、意图、趋势",
    available: true,
  },
  w03: {
    title: "关键词排名对手",
    description: "看 Google SERP 前 N 名（1-10）谁在排这个词，列出域名 / URL / 排位 / SERP 特性（中文标注）",
    available: true,
  },
  w04: {
    title: "问句词挖掘",
    description: "围绕主题挖掘 5W1H 长尾问句词，附问句类型筛选",
    available: true,
  },
  w05: {
    title: "主题相关词",
    description: "围绕主题挖掘语义相关的关键词集合，含相关度排序",
    available: true,
  },
  w06: {
    title: "全搜索拓词",
    description: "基于种子词跨数据源批量拓展候选词，单价 20u/行（W05 一半），适合大量探词",
    available: true,
  },
  w07: {
    title: "跨市场搜量",
    description: "一次获取 Semrush 数据库超 120 个国家的单个关键词的月搜量、难度、CPC、Intent 等",
    available: true,
  },
  w08: {
    title: "竞品广告词",
    description: "查竞品域名当前在 Google Ads 投放的广告词、排名、落地页与广告文案",
    available: true,
  },
  w09: {
    title: "竞品广告词历史",
    description: "回溯竞品域名历史投放过的广告词变化，每月 15 日快照（单次 ≤ 12 月，单价 100u/行）",
    available: true,
  },
  w10: {
    title: "域名差距分析",
    description: "对比自身与竞品域名的关键词覆盖差距，4 种维度（缺口/共有/蓝海/弱势）多选",
    available: true,
  },
};

type PageProps = {
  params: Promise<{ endpoint: string }>;
};

export default async function SkillDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { endpoint } = await params;
  const slug = endpoint.toLowerCase();
  const meta = SKILL_META[slug];
  if (!meta) notFound();

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* 标题栏：黄铜歌剧院皮肤，面包屑 / 大字标题 + Latin 编号 / 描述 */}
      <div className="px-6 py-4 border-b border-manor-brass/25 bg-manor-bg2 shrink-0 relative">
        {/* 面包屑 */}
        <div
          className="font-sc tracking-[0.28em] text-manor-brass/80"
          style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 10 }}
        >
          <Link
            href="/app/keywords/fetch"
            className="transition-colors hover:text-manor-brassHi"
          >
            ◆ INSTRUMENTA · 关键词功能库
          </Link>
          <span className="mx-2 text-manor-brassDim">›</span>
          <span className="text-manor-brassHi">{slug.toUpperCase()}</span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-3 flex-wrap">
          <h1
            className="text-brass-gradient font-serif font-semibold leading-none"
            style={{
              fontFamily: "var(--font-serif), 'EB Garamond', serif",
              fontSize: 26,
              letterSpacing: "0.04em",
              filter:
                "drop-shadow(0 0 5px rgba(239,216,154,.22)) drop-shadow(0 1px 0 rgba(0,0,0,.55))",
            }}
          >
            {meta.title}
          </h1>
          <span
            className="font-sc tracking-[0.24em] text-manor-brassHi"
            style={{
              fontFamily: "var(--font-sc), 'Cormorant SC', serif",
              fontSize: 11,
              textShadow:
                "0 0 8px rgba(239,216,154,.5), 0 0 2px rgba(224,197,122,.7)",
            }}
          >
            〔OPUS · {slug.toUpperCase()}〕
          </span>
          <span className="brass-divider flex-1 max-w-[180px] opacity-60" />
        </div>
        <p
          className="mt-1.5 text-manor-ink/65 italic"
          style={{
            fontFamily: "var(--font-serif), 'EB Garamond', serif",
            fontSize: 12,
            textShadow: "0 0 4px rgba(239,216,154,.18)",
          }}
        >
          {meta.description}
        </p>
      </div>

      {/* 主体：available 走完整 workspace；未上线走占位 */}
      {meta.available && slug === "w01" ? (
        <W01Workspace />
      ) : meta.available && slug === "w02" ? (
        <W02Workspace />
      ) : meta.available && slug === "w03" ? (
        <W03Workspace />
      ) : meta.available && slug === "w04" ? (
        <W04Workspace />
      ) : meta.available && slug === "w05" ? (
        <W05Workspace />
      ) : meta.available && slug === "w06" ? (
        <W06Workspace />
      ) : meta.available && slug === "w07" ? (
        <W07Workspace />
      ) : meta.available && slug === "w08" ? (
        <W08Workspace />
      ) : meta.available && slug === "w09" ? (
        <W09Workspace />
      ) : meta.available && slug === "w10" ? (
        <W10Workspace />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-manor-bg">
          <div className="rounded-lg border border-dashed border-manor-line2 bg-manor-bg2 px-6 py-16 text-center text-sm text-manor-inkDim">
            该功能即将上线
          </div>
        </div>
      )}
    </div>
  );
}
