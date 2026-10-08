import { NextResponse } from "next/server";
import { recommendSkills } from "@skillhub/core";
import { getScan } from "@/lib/data";

export const dynamic = "force-dynamic";
export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const task = (params.get("task") ?? "").slice(0, 5000);
  return NextResponse.json(recommendSkills(getScan().skills, task, 5, { client: params.get("client") || undefined }));
}
