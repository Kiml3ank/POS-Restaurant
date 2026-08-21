"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { STAFF_ROLE_LABEL } from "@/lib/rbac";
import type { StaffRole } from "@/lib/generated/prisma/enums";

/**
 * แถบโมดูลด้านซ้ายของเครื่องพนักงาน (ตาม design "Cafe POS")
 *
 * เป็น client component เพราะต้องรู้ว่าตอนนี้อยู่หน้าไหนเพื่อไฮไลต์ (usePathname)
 * — ข้อมูลที่ต้องใช้มีแค่ตำแหน่งของพนักงาน จึงรับมาเป็น prop ไม่ต้องแตะ DB
 *
 * **โมดูลที่ยังไม่ได้ทำแสดงเป็นข้อความ ไม่ใช่ลิงก์** และบอกไว้เลยว่าอยู่บทไหน
 * เจตนา: แถบนี้ทำหน้าที่เป็นแผนที่ของระบบให้คนที่มาเห็นครั้งแรกรู้ว่าอะไรมีแล้ว
 * อะไรยังไม่มี — ดีกว่าซ่อนจนดูเหมือนระบบมีแค่หน้าเดียว และดีกว่าใส่ลิงก์ที่กดแล้ว
 * ไปเจอหน้าเปล่า ถ้าบทไหนทำเสร็จให้ย้ายมาใส่ `href` แล้วมันจะกดได้เอง
 */
type Module = {
  num: string;
  label: string;
  href?: string;
  /** true เมื่อ pathname ปัจจุบันถือว่าอยู่ในโมดูลนี้ */
  isCurrent?: (pathname: string) => boolean;
  /** บทที่จะมาทำ — ใส่เมื่อยังไม่มี href */
  todo?: string;
};

const MODULES: Module[] = [
  {
    num: "01",
    label: "ผังโต๊ะ / สั่งอาหาร",
    href: "/pos",
    isCurrent: (pathname) => pathname === "/pos" || pathname.startsWith("/pos/table"),
  },
  { num: "02", label: "จอครัว", todo: "บทที่ 8" },
  { num: "03", label: "คิดเงิน / รับชำระ", todo: "บทที่ 10-11" },
  { num: "04", label: "เมนูและสินค้า", todo: "บทที่ 13" },
  { num: "05", label: "สต็อกวัตถุดิบ", todo: "บทที่ 14" },
  { num: "06", label: "รายงาน / ปิดกะ", todo: "บทที่ 15" },
];

export function PosSidebar({ role }: { role: StaffRole }) {
  const pathname = usePathname();

  return (
    <nav className="flex w-[268px] flex-none flex-col overflow-auto border-r-2 border-[var(--color-text)] bg-[var(--color-neutral-100)]">
      {MODULES.map((module) => {
        const current = module.isCurrent?.(pathname) ?? false;

        return (
          <div key={module.num} className="border-b-2 border-[var(--color-text)]">
            {module.href ? (
              <Link
                href={module.href}
                aria-current={current ? "page" : undefined}
                className={`flex w-full items-baseline gap-3 px-4 py-3.5 transition-colors ${
                  current
                    ? "bg-[var(--color-accent)] text-white"
                    : "hover:bg-[var(--color-accent-100)]"
                }`}
              >
                <span className="w-3.5 text-[11px] font-bold opacity-65">{module.num}</span>
                <span className="display text-[15px]">{module.label}</span>
              </Link>
            ) : (
              <div className="flex w-full items-baseline gap-3 px-4 py-3.5 opacity-40">
                <span className="w-3.5 text-[11px] font-bold">{module.num}</span>
                <span className="display text-[15px]">{module.label}</span>
                <span className="kicker ml-auto whitespace-nowrap">{module.todo}</span>
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-auto flex flex-col gap-1 border-t-2 border-[var(--color-text)] p-4">
        <span className="kicker">ตำแหน่ง</span>
        <span className="display text-[14px]">{STAFF_ROLE_LABEL[role]}</span>
      </div>
    </nav>
  );
}
