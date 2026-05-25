---
description: GSC 页面关键词排名（page-queries 懒加载）端到端核对日志 — 10 轮，覆盖不同类型页面
created: 2026-05-24 23:00
updated: 2026-05-24 23:00
---

# GSC 页面关键词排名核对（10 轮）

每轮方法：① 调真实接口 `/api/indexing/page-queries?url=...&refresh=1`（应用抽屉的数据源）→ 拿 top5 + totalRows；
② 独立把 GSC 标签页导航到该页 query 深链并 reload 复抓 → 对照点击/曝光/排名/总行数是否逐行一致。

## 计划覆盖的 10 类页面
- R1 首页 root — https://www.weslamic.com/
- R2 品类列表页(us) — https://www.weslamic.com/collections/zikr-ring
- R3 产品详情页(us) — https://www.weslamic.com/products/zikr-ring-itasbih-salam
- R4 博客文章(fr) — https://www.weslamic.com/fr/blogs/muslim/what-is-an-appropriate-gift-to-give-a-muslim
- R5 首页 locale(ar) — https://www.weslamic.com/ar
- R6 落地页 — https://www.weslamic.com/pages/itasbih-manual
- R7 品类列表页(tr) — https://www.weslamic.com/tr/collections/zikr-ring
- R8 博客文章(de) — https://www.weslamic.com/de/blogs/lifestyle/why-muslims-pray-5-times-a-day
- R9 产品详情页 — https://www.weslamic.com/products/zikr-ring
- R10 博客文章(en) — https://www.weslamic.com/blogs/muslim/what-does-the-zikr-ring-do

> 说明：先前任务里已核对过 博客文章(ar)/suggestions-and-trends-for-muslim-boy-name，本轮计划不再重复，换其它语言/类型增加覆盖面。

---

## R1 首页 `/` — ✅ 完全吻合
- API: topQuery=weslamic, totalRows=166, count=25
- 逐行对照（API vs GSC）：
  - weslamic 279/625/p1.3 vs 279/625/44.6%/1.3 ✓
  - weslamic itasbih 197/865/p1.6 vs 197/865/22.8%/1.6 ✓
  - itasbih 83/867/p3.2 vs 83/867/9.6%/3.2 ✓
  - weislamic 62/104/p1 vs 62/104/59.6%/1.0 ✓
  - weslamic itasbih ring 29/244/p2 vs 29/244/11.9%/2.0 ✓
  - 总行数 166 vs 共 166 行 ✓
- 结论：通过。totalRows 解析、精确过滤、点击/曝光/排名解析均正确。

## R2 品类列表页 `/collections/zikr-ring` — ✅ 完全吻合
- API: topQuery=weslamic itasbih, totalRows=180, count=25
- GSC pageFilter 回读 = https://www.weslamic.com/collections/zikr-ring（过滤映射正确）
- 逐行：weslamic itasbih 141/717/1.5 ✓ · itasbih 117/911/2.7 ✓ · weslamic itasbih ring 80/255/1.4 ✓ · itasbih ring 46/230/1.2 ✓ · itasbih fit 16/87/2.3 ✓ · 总行数 180 ✓
- 结论：通过。

## R3 产品详情页 `/products/zikr-ring-itasbih-salam` — ✅ 完全吻合
- API: topQuery=itasbih, totalRows=81, count=25 · GSC pageFilter 正确
- 逐行：itasbih 80/1046/4.1 ✓ · itasbih salam 39/241/1.8 ✓ · weslamic itasbih 15/888/4.5 ✓ · itasbeeh salam 6/40/1.2 ✓ · weslamic itasbih ring 4/251/4.6 ✓ · 总行数 81 ✓
- 结论：通过。

## R4 博客文章(fr) `/fr/blogs/muslim/what-is-an-appropriate-gift-to-give-a-muslim` — ✅ 完全吻合
- API: topQuery=cadeau musulman, totalRows=153 · GSC pageFilter 正确 · 低流量页(榜首仅 4 点击)同样准确
- 逐行：cadeau musulman 4/253/8.6 ✓ · cadeau islam 3/98/9.3 ✓ · cadeau religieux islam 3/42/3.8 ✓ · cadeaux musulman 1/76/8.3 ✓ · cadeau en islam 1/28/6.9 ✓ · 总行数 153 ✓
- 结论：通过。

## R5 首页 locale(ar) `/ar` — ✅ 完全吻合
- API: topQuery=weslamic, totalRows=64 · pageFilter 精确 `/ar`（未越界到 /ar/blogs/*，精确过滤不串层）· 阿语+混排查询正确
- 逐行：weslamic 43/155/1.4 ✓ · weslamic itasbih 2/40/2.3 ✓ · خاتم تسبيح weslamic 2/19/1.7 ✓ · خواتم اسلامية 2/9/8.3 ✓ · i tasbih 1/10/2.7 ✓ · 总行数 64 ✓
- 结论：通过。

## R6 落地页 `/pages/itasbih-manual` — ✅ 完全吻合
- API: topQuery=weslamic itasbih, totalRows=37 · pageFilter 正确
- 逐行：weslamic itasbih 10/493/5.8 ✓ · itasbih 7/460/6.3 ✓ · weslamic 2/111/3.5 ✓ · weslamic itasbih ring 1/138/7.7 ✓ · itasbih fit 1/28/7.2 ✓ · 总行数 37 ✓
- 结论：通过。

<!-- 下一轮：R7 -->
