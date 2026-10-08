import path from "node:path";
import { NextResponse } from "next/server";
import { compareDirectories, defaultRoots, listBackups, restoreSkillBackup, snapshotDirectory } from "@skillhub/core";
import { skillhubHome, stateRoot } from "@/lib/paths";
import { checkMutationOrigin } from "@/lib/mutations";

export const dynamic = "force-dynamic";
const root = () => path.join(stateRoot(), "backups");
const allowed = () => defaultRoots(skillhubHome()).filter((r) => ["agents", "claude", "codex"].includes(r.source)).map((r) => r.path);
export async function GET(req: Request): Promise<Response> {
  try {
    const backups = listBackups(root()).filter((b) => allowed().some((dir) => b.targetPath.startsWith(path.resolve(dir) + path.sep)));
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json(backups);
    const backup = backups.find((b) => b.id === id);
    if (!backup) throw new Error("找不到允许恢复的备份");
    return NextResponse.json({ backup, targetHash: snapshotDirectory(backup.targetPath).hash, differences: compareDirectories(path.join(root(), backup.id, "skill"), backup.targetPath) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "备份读取失败" }, { status: 400 }); }
}
export async function POST(req: Request): Promise<Response> {
  try {
    checkMutationOrigin(req);
    const body = await req.json() as { id?: string; expectedCurrentHash?: string };
    if (typeof body.id !== "string" || typeof body.expectedCurrentHash !== "string") throw new Error("恢复需要备份编号与预览中的当前指纹");
    return NextResponse.json(restoreSkillBackup(root(), body.id, allowed(), body.expectedCurrentHash));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "备份恢复失败" }, { status: 400 }); }
}
