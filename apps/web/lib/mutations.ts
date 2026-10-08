export function checkMutationOrigin(req: Request): void {
  const request = new URL(req.url);
  const host = new URL(`${request.protocol}//${req.headers.get("host") ?? request.host}`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host.hostname) || host.username || host.password || host.port !== request.port) throw new Error("写入请求必须来自当前本地页面");
  const origin = req.headers.get("origin");
  if (!origin) return;
  const page = new URL(origin);
  // Next.js 的内部 URL 可能使用 localhost；浏览器访问地址以 Host 为准。
  if (page.host !== host.host || page.protocol !== request.protocol || page.username || page.password) throw new Error("写入请求必须来自当前本地页面");
}
