// 新站 sitemap 抓取器 —— 权威"允许收录的页面"名单。
//
// 新站是 Framer，sitemap 为扁平 <urlset>（无 sitemap index），约 58 个 <loc>。
// 纯 server 端 fetch，零浏览器成本，无外部依赖。用作「收录与索引」页的行集来源：
// sitemap 里有的页才是"我们允许 Google 收录的页"，据此判断已收录/未收录。

export interface SitemapPage {
  fullUrl: string;
  path: string;
}

const DEFAULT_SITEMAP_URL = "https://www.weslamic.com/sitemap.xml";

export async function fetchSitemapPages(
  sitemapUrl: string = DEFAULT_SITEMAP_URL
): Promise<SitemapPage[]> {
  let res: Response;
  try {
    res = await fetch(sitemapUrl, {
      headers: {
        // 部分 CDN 会拒空 UA，给一个普通的；Accept 偏向 XML
        "User-Agent":
          "Mozilla/5.0 (compatible; WeslamicSEOBot/1.0; +https://www.weslamic.com)",
        Accept: "application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(
      `fetchSitemapPages: 网络请求失败 (${sitemapUrl}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!res.ok) {
    throw new Error(
      `fetchSitemapPages: sitemap 返回 HTTP ${res.status} ${res.statusText} (${sitemapUrl})`
    );
  }

  const xml = await res.text();

  // 解析所有 <loc>…</loc>（非贪婪，兼容内部换行/空白），逐条 trim
  const locRegex = /<loc>([\s\S]*?)<\/loc>/gi;
  const pages: SitemapPage[] = [];
  let m: RegExpExecArray | null;
  while ((m = locRegex.exec(xml)) !== null) {
    const fullUrl = m[1].trim();
    if (!fullUrl) continue;
    let path: string;
    try {
      path = new URL(fullUrl).pathname;
    } catch {
      continue; // 跳过解析不出的畸形 URL
    }
    pages.push({ fullUrl, path });
  }

  if (pages.length === 0) {
    throw new Error(
      `fetchSitemapPages: 未从 sitemap 解析到任何 <loc>（${sitemapUrl}）。` +
        `请确认 URL 正确、返回的是 <urlset> XML 而非 HTML/重定向页。`
    );
  }

  return pages;
}
