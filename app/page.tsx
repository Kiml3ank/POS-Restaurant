import Link from "next/link";

import { LocaleSwitcher } from "@/components/locale-switcher";
import type { MessageKey } from "@/lib/i18n/vi";
import { prisma } from "@/lib/server/db";
import { getT } from "@/lib/server/locale";

/**
 * หน้า index สำหรับ dev — ทางลัดไปทั้ง 4 หน้าจอ + เช็คว่าต่อ Postgres ติดจริงไหม
 * (หน้านี้จะถูกแทนที่ตอน deploy จริงในบทที่ 16)
 *
 * force-dynamic เพราะหน้านี้แตะฐานข้อมูล จึงต้องไม่ถูก prerender ตอน build
 * (ตอน build บนเครื่อง CI จะยังไม่มี Postgres ให้ต่อ)
 */
export const dynamic = "force-dynamic";

const SCREENS: { href: string; title: MessageKey; desc: MessageKey; chapters: string }[] = [
  // href ของลูกค้าถูกแทนด้วยรหัสโต๊ะจริงตอน render (ดู customerHref ด้านล่าง)
  { href: "/t", title: "dev.screen.customer.title", desc: "dev.screen.customer.desc", chapters: "5–7" },
  { href: "/pos", title: "dev.screen.pos.title", desc: "dev.screen.pos.desc", chapters: "9–12" },
  { href: "/kds", title: "dev.screen.kds.title", desc: "dev.screen.kds.desc", chapters: "8" },
  { href: "/admin", title: "dev.screen.admin.title", desc: "dev.screen.admin.desc", chapters: "13–15" },
];

async function readDbStatus() {
  try {
    const [tenants, branches, firstTable] = await Promise.all([
      prisma.tenant.count(),
      prisma.branch.count(),
      /**
       * ลิงก์หน้าลูกค้าต้องชี้รหัสโต๊ะที่มีอยู่จริง — เดิมฮาร์ดโค้ด `/t/A01`
       * ซึ่งไม่ตรงกับรหัสใน seed เลย กดแล้วได้ 404 ทุกครั้ง
       */
      prisma.restaurantTable.findFirst({
        where: { kind: "DINE_IN", isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { tableCode: true },
      }),
    ]);
    return { ok: true as const, tenants, branches, tableCode: firstTable?.tableCode ?? null };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export default async function DevIndexPage() {
  const { t } = await getT();
  const db = await readDbStatus();
  const customerHref = db.ok && db.tableCode ? `/t/${db.tableCode}` : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs tracking-wide text-neutral-500 uppercase">{t("dev.kicker")}</p>
          <LocaleSwitcher className="text-neutral-700" />
        </div>
        <h1 className="text-3xl font-semibold">{t("app.title")}</h1>
        <p className="text-sm text-neutral-600">
          Next.js 16.2 (App Router) + TypeScript + Prisma + PostgreSQL 17 (docker-compose)
        </p>
      </header>

      <section
        className={`rounded-lg border p-4 text-sm ${
          db.ok
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-red-200 bg-red-50 text-red-900"
        }`}
      >
        <p className="font-medium">{t(db.ok ? "dev.dbOk" : "dev.dbFail")}</p>
        {db.ok ? (
          <p className="mt-1">{t("dev.dbCounts", { tenants: db.tenants, branches: db.branches })}</p>
        ) : (
          <div className="mt-1 flex flex-col gap-1">
            <p>{t("dev.dbHint")}</p>
            <p className="font-mono text-xs break-all opacity-80">{db.message}</p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-500">{t("dev.screens")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {SCREENS.map((screen) => {
            const href = screen.href === "/t" ? customerHref : screen.href;

            return (
              <li key={screen.href}>
                <Link
                  href={href ?? "/"}
                  aria-disabled={href === null}
                  className={`flex h-full flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-400 ${
                    href === null ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <span className="font-medium">{t(screen.title)}</span>
                  <span className="text-sm text-neutral-600">{t(screen.desc)}</span>
                  <span className="mt-auto pt-2 text-xs text-neutral-400">
                    {t("dev.chapters", { n: screen.chapters })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
