// 本地 Chrome CDP 接管 —— GSC 与 GA4 采集共享的连接原语。
//
// 工作前提：用户的 Chrome 已登录（GSC / GA4），并以 `--remote-debugging-port=9222`
// 启动。本模块只 `connect` 这个已存在的实例，绝不 launch 新 Chromium，也不 close 它。
//
// 兼容性：Chrome 148+ 默认禁用 HTTP discovery（/json/version 返回 404），puppeteer 的
// `browserURL` 方式失效 → 回落读 `<user-data-dir>/DevToolsActivePort` 自行构造 ws URL。
//
// 从 fetcher.ts 抽出共享，避免 GSC / GA4 两份连接逻辑漂移。

import puppeteer, { type Browser } from "puppeteer-core";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULT_CDP_HOST = "127.0.0.1";
export const DEFAULT_CDP_PORT = 9222;

export function chromeUserDataDir(): string[] {
  // 允许通过环境变量覆盖；按 OS 给默认路径，多个候选都试一遍。
  const env = process.env.CHROME_USER_DATA_DIR;
  if (env) return [env];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return [
      path.join(local, "Google", "Chrome", "User Data"),
      path.join(local, "Google", "Chrome Beta", "User Data"),
      path.join(local, "Chromium", "User Data"),
    ];
  }
  if (process.platform === "darwin") {
    const home = os.homedir();
    return [
      path.join(home, "Library", "Application Support", "Google", "Chrome"),
      path.join(home, "Library", "Application Support", "Chromium"),
    ];
  }
  // linux
  const home = os.homedir();
  return [
    path.join(home, ".config", "google-chrome"),
    path.join(home, ".config", "chromium"),
  ];
}

export async function resolveBrowserWSEndpoint(host: string, port: number): Promise<string> {
  // 先尝试老的 HTTP discovery（Chrome 旧版 / 非默认安全策略下还可用）
  try {
    const res = await fetch(`http://${host}:${port}/json/version`, {
      headers: { Host: "localhost" },
    });
    if (res.ok) {
      const data = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (data?.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
    }
  } catch {
    // 不输出，继续走 DevToolsActivePort
  }

  // Fallback：读 DevToolsActivePort
  const candidates = chromeUserDataDir().map((d) => path.join(d, "DevToolsActivePort"));
  for (const file of candidates) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const [portLine, wsPath] = content.split("\n");
      const filePort = parseInt(portLine?.trim() || "", 10);
      if (filePort !== port) continue; // 跨 profile 时端口可能不一致
      if (!wsPath?.startsWith("/devtools/browser/")) continue;
      return `ws://${host}:${port}${wsPath.trim()}`;
    } catch {
      // 该文件不存在 / 没权限，试下一个
    }
  }
  throw new Error(
    `无法解析 Chrome wsEndpoint：${host}:${port} 的 /json/version 不响应，且 DevToolsActivePort 文件未找到。` +
      `请确认 Chrome 已以 --remote-debugging-port=${port} 启动，或设置环境变量 CHROME_USER_DATA_DIR。`
  );
}

// CDP 接管用户的 Chrome（仅 connect，不 launch）。调用方负责 disconnect。
export async function connectBrowser(host: string, port: number): Promise<Browser> {
  const browserWSEndpoint = await resolveBrowserWSEndpoint(host, port);
  return puppeteer.connect({ browserWSEndpoint, defaultViewport: null });
}
