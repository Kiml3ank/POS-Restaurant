"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * เมนูข้างของหลังร้าน
 *
 * เป็น client component เพราะต้องรู้ว่าอยู่หน้าไหนเพื่อไฮไลต์ (usePathname)
 * — ไม่รับ prop อะไรเลย เพราะทุกตำแหน่งที่เข้าจอนี้ได้เห็นรายการเดียวกันหมด
 * (สิทธิ์ที่ต่างกันคือ "กดปุ่มในหน้าได้ไหม" ไม่ใช่ "เห็นหน้าไหม")
 *
 * ⚠ ห้ามใส่คลาส design system (`ink-row`/`panel`) คู่กับ `lg:hidden`/`hidden lg:flex`
 * เพราะ `.pos-skin .xxx` มี specificity 0-2-0 ซึ่งชนะ utility คลาสเดียวของ Tailwind
 * แล้วแถบจะโผล่ทั้งสองที่พร้อมกันโดยที่ tsc/build ไม่ฟ้อง (กับดักใน CLAUDE.md หัวข้อ 4)
 * ที่นี่จึงวาดเส้นด้วย utility ล้วน ๆ
 */
const LINKS = [
  { href: "/admin/menu", label: "เมนูและสินค้า", hint: "หมวด · เมนู · ของหมด" },
  { href: "/admin/modifiers", label: "กลุ่มตัวเลือก", hint: "ขนาด · ความเผ็ด · ท็อปปิ้ง" },
];

export function AdminNav() {
  const pathname = usePathname();

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* จอกว้าง: แถบซ้าย */}
      <nav className="hidden w-[248px] flex-none flex-col border-r-2 border-[var(--color-text)] bg-[var(--color-neutral-100)] lg:flex">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isCurrent(link.href) ? "page" : undefined}
            className={`flex flex-col gap-0.5 border-b-2 border-[var(--color-text)] px-4 py-3.5 transition-colors ${
              isCurrent(link.href)
                ? "bg-[var(--color-accent)] text-white"
                : "hover:bg-[var(--color-accent-100)]"
            }`}
          >
            <span className="display text-[15px]">{link.label}</span>
            {/*
              ⚠ `.pos-skin .kicker` ตั้ง `color: var(--color-neutral-700)` (เทา)
              ไว้ด้วย specificity 0-2-0 ซึ่ง **ชนะ `text-white` ของ Tailwind (0-1-0)**
              — แปะสองคลาสคู่กันแล้วจะได้ตัวหนังสือเทาบนพื้นแดงที่อ่านไม่ออก
              โดยที่ tsc/build ไม่ฟ้องอะไร (กับดักเดียวกับ CLAUDE.md หัวข้อ 4)
              จึงต้อง **ไม่ใช้ `.kicker` เลย** ตอน active แล้วเขียนหน้าตาเองด้วย utility
            */}
            <span
              className={
                isCurrent(link.href)
                  ? "text-[11px] tracking-[0.14em] text-white/85 uppercase"
                  : "kicker"
              }
            >
              {link.hint}
            </span>
          </Link>
        ))}

        {/*
          ทางกลับไปหน้าร้าน — ต้องมี เพราะคนเข้ามาที่นี่จากแถบโมดูลของ POS
          ถ้าไม่มีปุ่มนี้ ทางกลับมีทางเดียวคือกดปุ่ม back ของเบราว์เซอร์
          ซึ่งบนแท็บเล็ตที่รันแบบเต็มจอ (kiosk) อาจไม่มีให้กดเลย
        */}
        <Link
          href="/pos"
          className="mt-auto flex items-center gap-2 border-t-2 border-[var(--color-text)] px-4 py-3.5 transition-colors hover:bg-[var(--color-accent-100)]"
        >
          <span aria-hidden>‹</span>
          <span className="display text-[15px]">กลับไปหน้าร้าน (POS)</span>
        </Link>

        <div className="flex flex-col gap-1 border-t-2 border-[var(--color-text)] p-4">
          <span className="kicker">ยังไม่ได้ทำ</span>
          <span className="kicker">สต็อก (บทที่ 14) · รายงาน (บทที่ 15)</span>
        </div>
      </nav>

      {/* จอแคบ: แถบล่าง (นิ้วโป้งเอื้อมถึง — เหตุผลเดียวกับแถบของ POS) */}
      <nav className="flex flex-none gap-[2px] border-t-2 border-[var(--color-text)] bg-[var(--color-text)] lg:hidden">
        <Link
          href="/pos"
          aria-label="กลับไปหน้าร้าน (POS)"
          className="flex min-h-[56px] w-14 flex-none items-center justify-center bg-[var(--color-neutral-100)] text-xl leading-none"
        >
          ‹
        </Link>

        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isCurrent(link.href) ? "page" : undefined}
            className={`flex min-h-[56px] flex-1 items-center justify-center px-2 text-center transition-colors ${
              isCurrent(link.href) ? "is-active" : "bg-[var(--color-neutral-100)]"
            }`}
          >
            <span className="display text-[13px] leading-tight">{link.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
