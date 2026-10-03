import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isTargetKind, parseSkillFile } from "@skillhub/core";
import { Badge, Card, Mono, SectionTitle } from "@/components/ui";
import { InstallButton } from "@/components/InstallButton";
import { getScan } from "@/lib/data";
import { reverseMentions, reverseReferences } from "@/lib/graph";

export const dynamic = "force-dynamic";

export default async function SkillDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scan = getScan();
  const hits = scan.skills.filter((s) => s.name === name).sort((a, b) => a.source.localeCompare(b.source));
  if (hits.length === 0) notFound();
  const allIdentical = hits.every((h) => h.hash === hits[0]?.hash);

  const inbound = reverseReferences(scan.skills, name);
  const inboundMentions = reverseMentions(scan.skills, name);
  const knownNames = new Set(scan.skills.map((s) => s.name));
  const outbound = [...new Set(hits.flatMap((h) => h.references))].filter((r) => r !== name && knownNames.has(r));
  const outboundMentions = [...new Set(hits.flatMap((h) => h.mentions))].filter(
    (r) => r !== name && knownNames.has(r) && !outbound.includes(r),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold text-slate-100">{name}</h1>
          {hits.length > 1 ? <Badge tone={allIdentical ? "violet" : "rose"}>{hits.length} 处出现</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          出现于 {hits.map((h) => h.source).join("、")} · hash{" "}
          {allIdentical ? (
            <Mono>{hits[0]?.hash}</Mono>
          ) : (
            <span className="text-rose-300">各处内容不一致</span>
          )}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>引用与提及</SectionTitle>          {outbound.length === 0 && outboundMentions.length === 0 ? (
            <p className="text-xs text-slate-500">没有指向库内其他 skill 的引用或提及</p>
          ) : (
            <div className="space-y-2">
              {outbound.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {outbound.map((r) => (
                    <Link key={r} href={`/skills/${r}`} className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-violet-500/50 hover:text-violet-300">
                      {r}
                    </Link>
                  ))}
                </div>
              ) : null}
              {outboundMentions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {outboundMentions.map((r) => (
                    <Link key={r} href={`/skills/${r}`} className="rounded-md border border-dashed border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300">
                      {r}
                    </Link>
                  ))}
                </div>
              ) : null}
              <p className="text-[10px] text-slate-600">实线边框 = 显式链接，虚线边框 = 正文提及</p>
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle>谁引用与提及它</SectionTitle>
          {inbound.length === 0 && inboundMentions.length === 0 ? (
            <p className="text-xs text-slate-500">没有其他 skill 引用它</p>
          ) : (
            <div className="space-y-2">
              {inbound.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {inbound.map((r) => (
                    <Link key={r} href={`/skills/${r}`} className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-violet-500/50 hover:text-violet-300">
                      {r}
                    </Link>
                  ))}
                </div>
              ) : null}
              {inboundMentions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {inboundMentions.map((r) => (
                    <Link key={r} href={`/skills/${r}`} className="rounded-md border border-dashed border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300">
                      {r}
                    </Link>
                  ))}
                </div>
              ) : null}
              <p className="text-[10px] text-slate-600">实线边框 = 显式链接，虚线边框 = 正文提及</p>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle hint="连同资源文件一起复制；插件缓存来源也可作为安装源">安装到其他 agent 目录</SectionTitle>
        <div className="flex flex-wrap gap-4">
          {(["agents", "claude", "codex"] as const).map((kind) => {
            const existing = hits.find((h) => h.source === kind);
            const same = existing != null && existing.hash === hits[0]?.hash;
            return (
              <div key={kind} className="flex flex-col gap-1">
                <InstallButton name={name} to={kind} force={existing != null && !same} label={`装到 ${kind}`} />
                <span className="text-[10px] text-slate-600">
                  {existing == null ? "未安装" : same ? "已是同内容" : "已有不同内容，将覆盖"}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {hits.map((h) => {
        const { body } = parseSkillFile(h.skillPath);
        return (
          <Card key={h.id}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge tone="violet">{h.source}</Badge>
              {h.version ? <Badge>@{h.version}</Badge> : null}
              <Mono>{h.skillPath}</Mono>
            </div>
            <div className="mb-4 grid gap-2 text-xs text-slate-400 md:grid-cols-4">
              <div>正文 {h.bodyChars} 字符</div>
              <div>资源文件 {h.files.length} 个</div>
              <div>
                hash <Mono>{h.hash}</Mono>
              </div>
              <div>引用 {h.references.length} 个 skill</div>
            </div>
            {h.quality.warnings.length > 0 ? (
              <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
                <div className="mb-1 text-xs font-medium text-amber-300">质量警告</div>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-200/90">
                  {h.quality.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {h.files.length > 0 ? (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {h.files.map((f) => (
                  <Mono key={f}>{f}</Mono>
                ))}
              </div>
            ) : null}
            <details open={hits.length === 1}>
              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">正文（点击折叠/展开）</summary>
              <div className="prose prose-invert prose-sm mt-3 max-w-none">
                <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
              </div>
            </details>
          </Card>
        );
      })}
    </div>
  );
}
