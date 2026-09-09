"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * เมนูข้างของหลังร้าน
 *
 * เป็น client component เพราะต้องรู้ว่าอยู่หน้าไหนเพื่อไฮไลต์ (usePathname)
 * — รายการเมนูของหลังร้าน (LINKS) เหมือนกันหมดทุกตำแหน่ง เพราะทุกคนที่เข้าจอนี้ได้
 * เห็นหน้าเดียวกัน (สิทธิ์ที่ต่างกันคือ "กดปุ่มในหน้าได้ไหม" ไม่ใช่ "เห็นหน้าไหม")
 *
 * ⚠ ข้อยกเว้นเดียวคือ **ทางกลับไป /pos** ซึ่งไม่ใช่เมนูของจอนี้ แต่เป็นทางออกไป
 * อีกจอหนึ่งที่มีด่านสิทธิ์ของตัวเอง — SCREEN_ROLES.pos ไม่มี KITCHEN ทั้งที่
 * SCREEN_ROLES.admin มี แปลว่าพ่อครัวที่เข้ามากด "ของหมด" จะเห็นปุ่มที่กดแล้ว
 * เด้งไป /pos/login แล้วใส่ PIN ถูกก็ยังเข้าไม่ได้ จึงต้องรับ canGoToPos
 * มาจาก layout (ฝั่ง server เป็นคนตัดสิน ที่นี่แค่ไม่วาด)
 *
 * ⚠ ห้ามใส่คลาส design system (`ink-row`/`panel`) คู่กับ `lg:hidden`/`hidden lg:flex`
 * เพราะ `.pos-skin .xxx` มี specificity 0-2-0 ซึ่งชนะ utility คลาสเดียวของ Tailwind
 * แล้วแถบจะโผล่ทั้งสองที่พร้อมกันโดยที่ tsc/build ไม่ฟ้อง (กับดักใน CLAUDE.md หัวข้อ 4)
 * ที่นี่จึงวาดเส้นด้วย utility ล้วน ๆ
 */
const LINKS = [
  { href: "/admin/menu", label: "Menu & items", short: "Menu", hint: "Categories · Items · Sold out" },
  { href: "/admin/modifiers", label: "Option groups", short: "Options", hint: "Size · Spice · Toppings" },
  { href: "/admin/receipts", label: "Receipts", short: "Receipts", hint: "Search past · Reprint" },
  { href: "/admin/audit-logs", label: "Audit log", short: "Log", hint: "Who did what · When" },
  { href: "/admin/staff", label: "Staff", short: "Staff", hint: "Accounts · PINs · Devices" },
  { href: "/admin/settings", label: "Settings", short: "Settings", hint: "Tax · Store info · Stations" },
];

export function AdminNav({
  canGoToPos,
  canViewDashboard,
}: {
  canGoToPos: boolean;
  /**
   * ตำแหน่งที่ดูสรุปยอดขายไม่ได้ **ไม่เห็นเมนูนี้เลย** ต่างจากเมนูอื่นที่ทุกคนเห็น
   * — /admin จะ redirect คนกลุ่มนี้ไป /admin/menu ทันที ปุ่มที่กดแล้วเด้งกลับ
   * ทำให้คนกดสรุปว่าระบบเสีย (เหตุผลเดียวกับปุ่ม "กลับไปหน้าร้าน" ด้านล่าง)
   */
  canViewDashboard: boolean;
}) {
  const pathname = usePathname();

  /**
   * "สรุปวันนี้" ต้องเทียบแบบตรงตัวเท่านั้น — `startsWith("/admin/")` จะทำให้
   * ทุกหน้าในจอนี้ไฮไลต์เมนูนี้ค้างไว้ตลอด
   */
  const isCurrent = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);

  const links = canViewDashboard
    ? [{ href: "/admin", label: "Today", short: "Today", hint: "Sales · Floor right now" }, ...LINKS]
    : LINKS;

  return (
    <>
      {/* จอกว้าง: แถบซ้าย */}
      <nav
        data-print-hide
        className="hidden w-[248px] flex-none flex-col border-r-2 border-[var(--color-text)] bg-[var(--color-neutral-100)] lg:flex"
      >
        {links.map((link) => (
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

          ...แต่ต้องไม่โชว์ให้คนที่เข้า /pos ไม่ได้ (ดูหัวไฟล์) — ปุ่มที่กดแล้วพา
          ไปหน้าที่ล็อกอินไม่ผ่าน แย่กว่าไม่มีปุ่ม เพราะคนกดจะสรุปว่าระบบเสีย
        */}
        {canGoToPos && (
          <Link
            href="/pos"
            className="mt-auto flex items-center gap-2 border-t-2 border-[var(--color-text)] px-4 py-3.5 transition-colors hover:bg-[var(--color-accent-100)]"
          >
            <span aria-hidden>‹</span>
            <span className="display text-[15px]">Back to POS</span>
          </Link>
        )}

        {/*
          กล่องท้ายแถบ: `mt-auto` ย้ายมาอยู่ที่นี่ตอนไม่มีปุ่มกลับ ไม่งั้นกล่องนี้
          จะลอยขึ้นไปติดเมนูแทนที่จะอยู่ก้นแถบ
        */}
        <div className={`flex flex-col gap-1 border-t-2 border-[var(--color-text)] p-4 ${canGoToPos ? "" : "mt-auto"}`}>
          <span className="kicker">Not built yet</span>
          <span className="kicker">Inventory (ch. 14) · Reports (ch. 15)</span>
        </div>
      </nav>

      {/* จอแคบ: แถบล่าง (นิ้วโป้งเอื้อมถึง — เหตุผลเดียวกับแถบของ POS) */}
      <nav
        data-print-hide
        className="flex flex-none gap-[2px] border-t-2 border-[var(--color-text)] bg-[var(--color-text)] lg:hidden"
      >
        {canGoToPos && (
          <Link
            href="/pos"
            aria-label="Back to POS"
            className="flex min-h-[56px] w-14 flex-none items-center justify-center bg-[var(--color-neutral-100)] text-xl leading-none"
          >
            ‹
          </Link>
        )}

        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isCurrent(link.href) ? "page" : undefined}
            className={`flex min-h-[56px] flex-1 items-center justify-center px-2 text-center transition-colors ${
              isCurrent(link.href) ? "is-active" : "bg-[var(--color-neutral-100)]"
            }`}
          >
            {/*
              แถบล่างใช้ป้าย **สั้น** ไม่ใช่ป้ายเต็มของแถบซ้าย — ตอนออกแบบมีสี่โมดูล
              ช่องละ ~80px พอใส่ "บันทึกการใช้งาน" ได้ ตอนนี้มีหกโมดูล เหลือช่องละ
              ~55px ที่จอ 390px ป้ายเต็มจะตัดเป็นสามบรรทัดจนอ่านไม่ออก
              (เพิ่มโมดูลที่เจ็ดเมื่อไหร่ ต้องกลับมาคิดใหม่ว่าแถบล่างยังไหวไหม)
            */}
            <span className="display text-[13px] leading-tight">{link.short}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
