import Link from "next/link";

import { prisma } from "@/lib/server/db";

/**
 * หน้า index สำหรับ dev — ทางลัดไปทั้ง 4 หน้าจอ + เช็คว่าต่อ Postgres ติดจริงไหม
 * (หน้านี้จะถูกแทนที่ตอน deploy จริงในบทที่ 16)
 *
 * force-dynamic เพราะหน้านี้แตะฐานข้อมูล จึงต้องไม่ถูก prerender ตอน build
 * (ตอน build บนเครื่อง CI จะยังไม่มี Postgres ให้ต่อ)
 */
export const dynamic = "force-dynamic";

const SCREENS = [
  {
    href: "/t/A01",
    title: "มือถือลูกค้า (QR)",
    desc: "สแกน QR ประจำโต๊ะ เปิดเมนู สั่งอาหารเอง",
    chapter: "บทที่ 5-7",
  },
  {
    href: "/pos",
    title: "เครื่องพนักงาน (POS)",
    desc: "เปิดโต๊ะ สั่งแทนลูกค้า ย้าย/รวมโต๊ะ คิดเงิน",
    chapter: "บทที่ 9-12",
  },
  {
    href: "/kds",
    title: "จอครัว (KDS)",
    desc: "รับออร์เดอร์ realtime ผ่าน SSE แยกตามสถานี",
    chapter: "บทที่ 8",
  },
  {
    href: "/admin",
    title: "หลังร้าน (admin/report)",
    desc: "ยอดขาย เมนูขายดี ปิดกะ/ปิดวัน จัดการเมนู-สิทธิ์",
    chapter: "บทที่ 13-15",
  },
] as const;

async function readDbStatus() {
  try {
    const [tenants, branches] = await Promise.all([
      prisma.tenant.count(),
      prisma.branch.count(),
    ]);
    return { ok: true as const, tenants, branches };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export default async function DevIndexPage() {
  const db = await readDbStatus();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs tracking-wide text-neutral-500 uppercase">dev index</p>
        <h1 className="text-3xl font-semibold">POS ร้านอาหาร</h1>
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
        <p className="font-medium">
          {db.ok ? "ต่อฐานข้อมูลสำเร็จ" : "ต่อฐานข้อมูลไม่สำเร็จ"}
        </p>
        {db.ok ? (
          <p className="mt-1">
            Tenant {db.tenants} รายการ · Branch {db.branches} รายการ
          </p>
        ) : (
          <div className="mt-1 flex flex-col gap-1">
            <p>สั่ง `npm run db:up` แล้วตามด้วย `npm run db:migrate` ก่อน</p>
            <p className="font-mono text-xs break-all opacity-80">{db.message}</p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-500">4 หน้าจอของระบบ</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {SCREENS.map((screen) => (
            <li key={screen.href}>
              <Link
                href={screen.href}
                className="flex h-full flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-400"
              >
                <span className="font-medium">{screen.title}</span>
                <span className="text-sm text-neutral-600">{screen.desc}</span>
                <span className="mt-auto pt-2 text-xs text-neutral-400">{screen.chapter}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
