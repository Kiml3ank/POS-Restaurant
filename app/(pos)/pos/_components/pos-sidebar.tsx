"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { STAFF_ROLE_LABEL, canAccessScreen, type StaffScreen } from "@/lib/rbac";
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
  /**
   * ข้อความบอกทางเมื่อโมดูล "ทำเสร็จแล้วแต่ไม่มีหน้าเดี่ยวของตัวเอง"
   *
   * เคสของโมดูล 03: การคิดเงินต้องมีโต๊ะก่อนเสมอ (บิลผูกกับรอบโต๊ะ) จึงไม่มี
   * URL ที่กดจากตรงนี้ได้ตรง ๆ — แต่ถ้าปล่อยเป็น "บทที่ 10-11" ต่อไปจะกลายเป็น
   * คำโกหก เพราะสองบทนั้นทำเสร็จแล้ว ที่ถูกคือบอกว่าเข้าถึงได้จากที่ไหน
   */
  hint?: string;
  /**
   * หน้าจอที่โมดูลนี้พาไป — ใส่เมื่อมันอยู่คนละ route group แล้วมี RBAC ของตัวเอง
   *
   * ตำแหน่งที่เข้าไม่ได้จะเห็นเป็นข้อความจางเหมือนโมดูลที่ยังไม่ได้ทำ ไม่ใช่ลิงก์
   * — แคชเชียร์ที่กด "จอครัว" แล้วไปเจอหน้าใส่ PIN ที่ตัวเองใส่เท่าไหร่ก็ไม่ผ่าน
   * คือประสบการณ์ที่แย่กว่าการไม่มีปุ่มให้กดตั้งแต่แรก
   */
  screen?: StaffScreen;
};

const MODULES: Module[] = [
  {
    num: "01",
    label: "Table map / Order",
    href: "/pos",
    /**
     * `/pos/counter` (ซื้อกลับ) นับเป็นโมดูลเดียวกับผังโต๊ะโดยตั้งใจ
     *
     * ไม่ได้เพิ่มเป็นโมดูลที่ 07 เพราะ design "Cafe POS" วางไว้เป็นหกโมดูล
     * และสำหรับพนักงานมันคืองานเดียวกัน ("รับออร์เดอร์") แค่คนละช่องทาง —
     * ทางเข้าจริงของซื้อกลับคือแถบคิวบนหน้า `/pos` ไม่ใช่รายการในแถบข้าง
     */
    isCurrent: (pathname) =>
      pathname === "/pos" || pathname.startsWith("/pos/table") || pathname.startsWith("/pos/counter"),
  },
  {
    num: "02",
    label: "Kitchen display",
    href: "/kds",
    isCurrent: (pathname) => pathname.startsWith("/kds"),
    screen: "kds",
  },
  { num: "03", label: "Checkout / Payment", hint: "Pick a table from the map" },
  {
    num: "04",
    label: "Menu & items",
    href: "/admin/menu",
    isCurrent: (pathname) => pathname.startsWith("/admin"),
    screen: "admin",
  },
  { num: "05", label: "Inventory", todo: "Chapter 14" },
  { num: "06", label: "Reports / Shift close", todo: "Chapter 15" },
];

export function PosSidebar({ role }: { role: StaffRole }) {
  const pathname = usePathname();

  const isAllowed = (module: Module) =>
    module.screen ? canAccessScreen(role, module.screen) : true;

  /**
   * บนจอแคบแสดงเฉพาะโมดูลที่ "กดได้จริง" เท่านั้น
   *
   * ไม่ได้ย่อของเดิมให้เล็กลง แต่เปลี่ยนหน้าที่ของแถบนี้ไปเลย: บนจอกว้างมันคือ
   * แผนที่ของระบบ (จึงโชว์โมดูลที่ยังไม่ได้ทำพร้อมเลขบท) แต่บนจอแคบพื้นที่แนวนอน
   * มีจำกัดจนต้องเลือกอย่างเดียว — เลือก "ปุ่มที่กดแล้วไปไหนได้" ทิ้งของที่กดไม่ได้
   * เพราะแถบล่างที่เต็มไปด้วยของกดไม่ได้คือแถบที่คนเลิกมองภายในวันเดียว
   */
  const barModules = MODULES.filter((module) => module.href && isAllowed(module));

  return (
    <>
      {/* ── จอกว้าง: แถบซ้ายเต็มรูป (แผนที่ของระบบ) ───────────────────────── */}
      <nav
        data-print-hide
        className="hidden w-[268px] flex-none flex-col overflow-auto border-r-2 border-[var(--color-text)] bg-[var(--color-neutral-100)] lg:flex"
      >
        {MODULES.map((module) => {
          const current = module.isCurrent?.(pathname) ?? false;
          // ทำเสร็จแล้ว (มี href) แต่ตำแหน่งนี้เข้าไม่ได้ → แสดงจางพร้อมบอกเหตุผล
          const allowed = isAllowed(module);

          return (
            <div key={module.num} className="border-b-2 border-[var(--color-text)]">
              {module.href && allowed ? (
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
                  <span className="kicker ml-auto whitespace-nowrap">
                    {module.hint ?? module.todo ?? "No access"}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        <div className="mt-auto flex flex-col gap-1 border-t-2 border-[var(--color-text)] p-4">
          <span className="kicker">Role</span>
          <span className="display text-[14px]">{STAFF_ROLE_LABEL[role]}</span>
        </div>
      </nav>

      {/* ── จอแคบ: แถบล่าง ────────────────────────────────────────────────
          อยู่ล่างไม่ใช่บน เพราะนิ้วโป้งเอื้อมถึงขอบล่างของจอได้โดยไม่ต้องขยับมือ
          ที่จับเครื่อง — กฎเดียวกับแอปมือถือทุกตัว และสำคัญกว่าปกติที่นี่เพราะ
          พนักงานถือเครื่องมือเดียวขณะอีกมือถือจานอยู่

          `ink-row` ให้เส้นคั่น 2px ระหว่างปุ่มเหมือนกริดของ design เดิม */}
      {/*
        ⚠ ห้ามใส่คลาส `ink-row` ตรงนี้แล้วหวังให้ `lg:hidden` ซ่อนมันได้
        `.pos-skin .ink-row` ประกาศ `display:flex` ด้วย specificity สองคลาส (0-2-0)
        ส่วน `lg:hidden` ของ Tailwind เป็นคลาสเดียว (0-1-0) — ของเราแพ้ แถบล่าง
        จะโผล่บนจอกว้างเป็นแถบแดงตั้งข้าง ๆ แถบซ้าย โดยที่ tsc/build ไม่ฟ้องอะไรเลย
        (กับดักเดียวกับ `.pos-skin *{border-radius:0}` ใน CLAUDE.md หัวข้อ 4)

        จึงเขียนหน้าตาของ ink-row ด้วย utility ตรง ๆ แทน: พื้นหมึก + gap 2px
        แล้วให้ลูกทับด้วยพื้นของตัวเอง = ได้เส้นคั่น 2px เหมือนกันเป๊ะ
      */}
      <nav
        data-print-hide
        aria-label="Modules"
        className="flex flex-none gap-[2px] border-t-2 border-[var(--color-text)] bg-[var(--color-text)] lg:hidden"
      >
        {barModules.map((module) => {
          const current = module.isCurrent?.(pathname) ?? false;

          return (
            <Link
              key={module.num}
              href={module.href!}
              aria-current={current ? "page" : undefined}
              // min-h 56px = เป้าสัมผัสที่กดได้ด้วยนิ้วโป้งโดยไม่ต้องเล็ง
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-2 transition-colors ${
                current ? "is-active" : "bg-[var(--color-neutral-100)]"
              }`}
            >
              <span className="text-[10px] font-bold opacity-65">{module.num}</span>
              <span className="display text-center text-[13px] leading-tight">
                {module.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
