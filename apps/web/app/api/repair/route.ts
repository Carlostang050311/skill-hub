import fs from "node:fs";
import { NextResponse } from "next/server";
import { applySkillEdit, isTargetKind, previewSkillEdit, repairSuggestions } from "@skillhub/core";
import { getScan } from "@/lib/data";
import { stateRoot } from "@/lib/paths";
import { checkMutationOrigin } from "@/lib/mutations";

export const dynamic = "force-dynamic";
export async function GET(req: Request): Promise<Response> {
  try {
    const id = new URL(req.url).searchParams.get("id");
    const record = getScan().skills.find((r) => r.id === id);
    if (!record || !isTargetKind(record.source)) throw new Error("请选择可写的 agents / claude / codex 副本");
    return NextResponse.json({ raw: fs.readFileSync(record.skillPath, "utf8"), hash: record.hash, suggestions: repairSuggestions(record) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "指导书读取失败" }, { status: 400 }); }
}
export async function POST(req: Request): Promise<Response> {
  try {
    checkMutationOrigin(req);
    const body = await req.json() as { id?: string; raw?: string; action?: string; expectedHash?: string };
    const record = getScan().skills.find((r) => r.id === body.id);
    if (!record || !isTargetKind(record.source) || typeof body.raw !== "string") throw new Error("请选择可写副本并提供编辑后的指导书");
    if (body.action === "preview") return NextResponse.json(previewSkillEdit(record, body.raw));
    if (body.action !== "apply" || typeof body.expectedHash !== "string") throw new Error("应用修复需要先预览并提交内容指纹");
    return NextResponse.json(applySkillEdit(record, body.raw, body.expectedHash, stateRoot()));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "修复失败" }, { status: 400 }); }
}
