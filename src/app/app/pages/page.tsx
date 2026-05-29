import { redirect } from "next/navigation";

// 「页面规划」已并入「主题与页面规划」(/app/strategy)。保留路由做永久重定向，
// 避免旧书签 / 外链 404。导航栏已移除该入口。
export default function PagesRedirect() {
  redirect("/app/strategy");
}
