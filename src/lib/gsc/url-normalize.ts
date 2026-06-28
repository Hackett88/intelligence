// URL 归一化 —— 用于把"新站 sitemap URL"与"GSC 已编入索引 URL"放到同一口径比对。
//
// 归一化规则（顺序固定，与 sitemap × GSC 比对口径一致）：
//   1. 转小写
//   2. 去掉 scheme（http:// 或 https://）
//   3. 去掉前导 "www."
//   4. 去掉 ?query 和 #hash
//   5. 去掉结尾的一个或多个 "/"
//
// 保留 host + path（如 weslamic.com/about），两侧同域名时等价于按 path 比对，
// 跨域名时仍能正确区分。例：
//   https://www.weslamic.com/about/ → weslamic.com/about
//   https://www.weslamic.com/       → weslamic.com

export function normalizeForMatch(url: string): string {
  let s = (url ?? "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, ""); // 去 scheme
  s = s.replace(/^www\./, ""); // 去前导 www.
  s = s.replace(/[?#].*$/, ""); // 去 query / hash
  s = s.replace(/\/+$/, ""); // 去结尾斜杠（一个或多个）
  return s;
}
