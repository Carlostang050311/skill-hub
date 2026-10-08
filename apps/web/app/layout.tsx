import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import { getScan } from "@/lib/data";
import "./globals.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "skill-hub", description: "本地 Agent Skill 管理与评测平台" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const scan = getScan();
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen flex-col md:flex-row">
          <aside className="flex w-full shrink-0 flex-col border-b border-slate-800 bg-slate-950/80 p-4 md:w-56 md:border-b-0 md:border-r">
            <Link href="/" className="mb-6 block px-2">
              <div className="text-lg font-semibold text-slate-100">
                skill<span className="text-violet-400">hub</span>
              </div>
              <div className="text-xs text-slate-500">本地 Skill 库管理与评测</div>
            </Link>
            <NavLinks />
            <div className="mt-auto hidden px-2 text-xs text-slate-600 md:block">
              <div>{scan.skills.length} 个 skill 已索引</div>
              <div className="mt-0.5">扫描于 {new Date(scan.scannedAt).toLocaleTimeString("zh-CN")}</div>
            </div>
          </aside>
          <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
