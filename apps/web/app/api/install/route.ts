import { NextResponse } from "next/server";
import { installSkill, isTargetKind } from "@skillhub/core";
import { getScan } from "@/lib/data";

export const dynamic = "force-dynamic";

interface InstallBody {
  name?: string;
  to?: string;
  from?: string;
  force?: boolean;
  dryRun?: boolean;
}

/** Web 端只允许写三个全局 agent 目录，不支持任意路径 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: InstallBody;
  try {
    body = (await req.json()) as InstallBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!body.name || !body.to || !isTargetKind(body.to)) {
    return NextResponse.json({ error: "缺少 name 或 to（只支持 agents / claude / codex）" }, { status: 400 });
  }
  try {
    const result = installSkill(getScan().skills, body.name, {
      to: body.to,
      from: body.from,
      force: body.force === true,
      dryRun: body.dryRun === true,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
