export function checkMutationOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const page = new URL(origin);
  const request = new URL(req.url);
  // Next.js 的内部 URL 可能使用 localhost；浏览器访问地址以 Host 为准。
  if (page.host !== (req.headers.get("host") ?? request.host) || page.protocol !== request.protocol) throw new Error("写入请求必须来自当前本地页面");
}
