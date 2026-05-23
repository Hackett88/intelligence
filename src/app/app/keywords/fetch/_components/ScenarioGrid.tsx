"use client";

import {
  Stethoscope,
  Target,
  Lightbulb,
  TrendingUp,
  Layers,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { SkillCard } from "./SkillCard";

type Scenario = {
  endpoint: string;
  title: string;
  description: string;
  available: boolean;
  spanCls: string;
  icon: LucideIcon;
  backgroundImage?: string;
};

// Bento 横向 1-2-1-2：4 个并列纵向分区，节奏「大 · 双 · 大 · 双」，一行铺开、一屏放下。
//   分区 1：一键体检       [整列高]
//   分区 2：竞品空隙 / 博客选题   [上下双卡]
//   分区 3：内容形态       [整列高]
//   分区 4：SEM 投放 / 跨市场扩库  [上下双卡]
const SCENARIOS: Scenario[] = [
  {
    endpoint: "checkup",
    title: "一键关键词体检",
    description:
      "输入一组词，自动跑搜量、难度、SERP、跨市场分布四项检查，一份报告告诉你每个词值不值得投入。",
    available: false,
    spanCls: "sm:col-start-1 sm:row-start-1 sm:row-span-2",
    icon: Stethoscope,
    backgroundImage: "/scenarios/checkup-diagnosis.svg",
  },
  {
    endpoint: "competitor-gap",
    title: "找竞品流量空隙",
    description: "竞品有流量你没有的词，挑出可以抢的机会词，含问句长尾与 SERP 透视。",
    available: false,
    spanCls: "sm:col-start-2 sm:row-start-1",
    icon: Target,
  },
  {
    endpoint: "blog-topics",
    title: "发现博客选题",
    description: "围绕主题挖出 5W1H 长尾问句 + 语义相关词，铺给写作团队当选题池。",
    available: false,
    spanCls: "sm:col-start-2 sm:row-start-2",
    icon: Lightbulb,
  },
  {
    endpoint: "content-form",
    title: "内容形态决策",
    description: "一个词到底是写博客还是建产品页？看 SERP 意图分布 + 长尾问句给出建议。",
    available: false,
    spanCls: "sm:col-start-3 sm:row-start-1 sm:row-span-2",
    icon: Workflow,
    backgroundImage: "/scenarios/content-form-decision.svg",
  },
  {
    endpoint: "sem-opportunity",
    title: "SEM 投放机会",
    description: "竞品当前在投 + 历史投过的广告词一起捞，挖出值得我方投放的关键词。",
    available: false,
    spanCls: "sm:col-start-4 sm:row-start-1",
    icon: TrendingUp,
  },
  {
    endpoint: "multi-market",
    title: "跨市场扩库评估",
    description: "把一批词在多个国家市场扫一遍，快速定位高搜量低竞争的目标地区词。",
    available: false,
    spanCls: "sm:col-start-4 sm:row-start-2",
    icon: Layers,
  },
];

export function ScenarioGrid() {
  return (
    <div className="grid h-full grid-cols-1 sm:grid-cols-4 sm:grid-rows-2 gap-3">
      {SCENARIOS.map((s, i) => (
        <div
          key={s.endpoint}
          className={`${s.spanCls} min-h-0`}
          style={{ ["--skill-i" as string]: String(i + 1) }}
        >
          <SkillCard
            title={s.title}
            description={s.description}
            endpoint={s.endpoint}
            available={s.available}
            featured={s.endpoint === "checkup" || s.endpoint === "content-form"}
            icon={s.icon}
            backgroundImage={s.backgroundImage}
          />
        </div>
      ))}
    </div>
  );
}
