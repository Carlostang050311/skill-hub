import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import { getScan } from "@/lib/data";
import "./globals.css";

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const scan = getScan();
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen">
          <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 p-4">
            <Link href="/" className="mb-6 block px-2">
              <div className="text-lg font-semibold text-slate-100">
                skill<span className="text-violet-400">hub</span>
              </div>
              <div className="text-xs text-slate-500">本地 Skill 库管理与评测</div>
            </Link>
            <NavLinks />
            <div className="mt-auto px-2 text-xs text-slate-600">
              <div>{scan.skills.length} 个 skill 已索引</div>
              <div className="mt-0.5">扫描于 {new Date(scan.scannedAt).toLocaleTimeString("zh-CN")}</div>
            </div>
          </aside>
          <main className="min-w-0 flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
