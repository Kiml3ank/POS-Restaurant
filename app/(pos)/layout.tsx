import Link from "next/link";

import { getCurrentStaff } from "@/lib/server/staff-session";

import { logoutAction } from "./pos/actions";
import { PosSidebar } from "./pos/_components/pos-sidebar";

/**
 * Layout ของเครื่องพนักงาน (POS) — แท็บเล็ต/จอสัมผัสแนวนอน
 *
 * แถบบนแสดงว่า "ตอนนี้ใครกดอยู่" ตลอดเวลา เพราะเครื่อง POS เครื่องเดียวถูกใช้
 * สลับกันทั้งกะ ถ้าไม่โชว์ชื่อไว้ พนักงานจะเผลอกดต่อจากคนก่อนหน้าโดยไม่รู้ตัว
 * แล้ว Order.placedByStaffId กับ AuditLog จะชี้ผิดคนทั้งกะ
 *
 * หน้าล็อกอินไม่มี staff จึงไม่มีทั้งแถบบนและแถบข้าง (getCurrentStaff คืน null)
 *
 * `pos-skin` คือคลาสที่เปิด design system "Modernist" ให้ทั้ง subtree
 * (token อยู่ที่ app/globals.css) — อยู่ตรงนี้จุดเดียว หน้าอื่นนอก (pos)
 * จึงไม่ถูกแตะเลย ดูเหตุผลเต็มในคอมเมนต์หัวไฟล์ globals.css
 *
 * ตอนล็อกอินแล้วใช้ `h-dvh overflow-hidden` ไม่ใช่ `min-h-dvh` โดยตั้งใจ:
 * จอ POS ต้องไม่มี scrollbar ของทั้งหน้า แต่ให้แต่ละแพเนล (เมนู / ตะกร้า /
 * รายการบิล) เลื่อนของตัวเองแยกกัน — ตะกร้าและยอดรวมต้องอยู่กับที่เสมอ
 * ส่วนหน้าล็อกอินยังเป็น min-h-dvh เพราะจอเตี้ย ๆ ต้องเลื่อนลงไปหาแป้น PIN ได้
 */
export default async function PosLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staff = await getCurrentStaff();

  if (!staff) {
    return <div className="pos-skin flex min-h-dvh flex-col">{children}</div>;
  }

  return (
    <div className="pos-skin flex h-dvh flex-col overflow-hidden">
      <header className="flex h-[66px] flex-none items-stretch border-b-2 border-[var(--color-text)]">
        <Link
          href="/pos"
          className="flex w-[268px] flex-none items-center gap-3 border-r-2 border-[var(--color-text)] px-6"
        >
          <span className="size-3.5 flex-none bg-[var(--color-accent)]" />
          <span className="display text-[17px]">POS</span>
          <span className="kicker truncate">{staff.branch.name}</span>
        </Link>

        <div className="flex flex-1 items-center justify-end gap-6 px-6">
          <span className="kicker whitespace-nowrap">รหัส {staff.code}</span>
          <span className="display text-[15px] whitespace-nowrap">{staff.name}</span>

          <form action={logoutAction}>
            <button type="submit" className="btn btn-secondary h-[38px] whitespace-nowrap">
              ล็อกจอ
            </button>
          </form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <PosSidebar role={staff.role} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
