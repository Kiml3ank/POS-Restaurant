import Link from "next/link";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { getT } from "@/lib/server/locale";
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
  const { t } = await getT();
  const staff = await getCurrentStaff("pos");

  if (!staff) {
    return <div className="pos-skin flex min-h-dvh flex-col">{children}</div>;
  }

  return (
    <div className="pos-skin flex h-dvh flex-col overflow-hidden">
      {/* data-print-hide: แถบนี้เป็นของ "หน้าจอ" ไม่ใช่ของ "เอกสาร" — ใบเสร็จบทที่ 12
          พิมพ์จากในเชลล์นี้ ถ้าไม่แปะ แถบจะติดไปบนกระดาษความร้อนด้วย (globals.css @media print) */}
      <header
        data-print-hide
        className="flex h-[58px] flex-none items-stretch border-b-2 border-[var(--color-text)] lg:h-[66px]"
      >
        <Link
          href="/pos"
          className="flex flex-none items-center gap-2 border-r-2 border-[var(--color-text)] px-4 lg:w-[268px] lg:gap-3 lg:px-6"
        >
          <span className="size-3.5 flex-none bg-[var(--color-accent)]" />
          <span className="display text-[17px]">{t("nav.pos")}</span>
          {/* ชื่อสาขาเป็นข้อมูลยืนยัน ไม่ใช่ข้อมูลที่ต้องอ่านทุกวินาที — จอแคบตัดทิ้งก่อน */}
          <span className="kicker hidden truncate sm:inline">{staff.branch.name}</span>
        </Link>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 px-4 lg:gap-6 lg:px-6">
          {/* รหัสพนักงานซ้ำกับชื่อที่อยู่ข้าง ๆ อยู่แล้ว จอแคบเก็บแค่ชื่อไว้ */}
          <span className="kicker hidden whitespace-nowrap lg:inline">
            {t("pos.header.code", { code: staff.code })}
          </span>
          <span className="display truncate text-[15px]">{staff.name}</span>

          {/* ซ่อนที่ <div> ครอบ ไม่ใช่ที่ตัวปุ่ม (กฎ specificity ของ .pos-skin) —
              จอแคบกว่า sm สลับภาษาได้ที่หน้าล็อกจอ (เหตุผลเดียวกับแถบจอครัว) */}
          <div className="hidden flex-none sm:block">
            <LocaleSwitcher />
          </div>

          <form action={logoutAction} className="flex-none">
            <button type="submit" className="btn btn-secondary h-[38px] whitespace-nowrap">
              {t("staff.lockScreen")}
            </button>
          </form>
        </div>
      </header>

      {/*
        `flex-col-reverse lg:flex-row` — ใน DOM แถบโมดูลมาก่อนเนื้อหาเสมอ
        (ลำดับที่ถูกสำหรับ screen reader และปุ่ม tab: เมนู → เนื้อหา)
        แล้วให้ CSS เป็นคนย้ายมันไปไว้ "ล่างจอ" ตอนจอแคบ ไม่ใช่สลับลำดับใน DOM
        — ถ้าสลับใน DOM จอกว้างจะกลายเป็น tab เจอเนื้อหาก่อนเมนู ซึ่งกลับด้านกัน
      */}
      <div className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        <PosSidebar role={staff.role} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
