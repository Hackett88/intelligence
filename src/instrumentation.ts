// Next 启动钩子：进程启动时拉起应用内「收录定时检查」调度器（60s 心跳）。
//
// 仅在 Node 服务运行时启动（跳过 edge / build）；用 global 单例标志防 dev 热载重复启动。
// 动态 import scheduler，避免被打进 edge bundle（scheduler 依赖 pg / puppeteer 等 node-only 模块）。

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // 只在 node 服务运行时
  const g = global as typeof globalThis & { __weslamicSchedulerStarted?: boolean };
  if (g.__weslamicSchedulerStarted) return; // 防 dev 热载重复启动
  g.__weslamicSchedulerStarted = true;
  const { startScheduler } = await import("@/lib/gsc/scheduler"); // 动态导入，避免 edge 打包
  startScheduler();
  console.log("[scheduler] 应用内定时收录调度器已启动（60s 心跳）");
}
