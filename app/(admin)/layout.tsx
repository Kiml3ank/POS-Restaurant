import Link from "next/link";

import { STAFF_ROLE_LABEL, canAccessScreen, canEditMenu, canViewDashboard } from "@/lib/rbac";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { adminLogoutAction } from "./admin/actions";
import { AdminNav } from "./admin/_components/admin-nav";

/**
 * Layout ของหลังร้าน (โมดูล 04)
 *
 * `pos-skin` = design system ตัวเดียวกับเครื่องพนักงาน **ไม่มี skin ใหม่**
 * เพราะจอนี้เป็นงานประเภทเดียวกัน (พนักงานกดบนแท็บเล็ต/เดสก์ท็อปในร้าน)
 * ไม่ใช่จอมืดที่ต้องอ่านจากระยะไกลแบบครัว — ตรงนี้คือจุดเดียวที่แปะคลาสให้ทั้ง
 * route group ตามกฎใน CLAUDE.md **ห้ามย้าย token ขึ้น :root**
 *
 * `h-dvh overflow-hidden` ด้วยเหตุผลเดียวกับ (pos)/(kds) — หน้าใหม่ใน group นี้
 * ต้องใส่ `min-h-0` + `overflow-auto` เองเสมอ ไม่งั้นเนื้อหาโดนตัดหายแทนที่จะเลื่อนได้
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staff = await getCurrentStaff("admin");

  // หน้าใส่ PIN — ยังไม่มีใครล็อกอิน จึงไม่มีแถบหัวจอและไม่มีเมนูข้าง
  if (!staff || !canAccessScreen(staff.role, "admin")) {
    return <div className="pos-skin flex min-h-dvh flex-col">{children}</div>;
  }

  return (
    <div className="pos-skin flex h-dvh flex-col overflow-hidden">
      <header
        data-print-hide
        className="flex h-[58px] flex-none items-stretch border-b-2 border-[var(--color-text)] lg:h-[66px]"
      >
        <Link
          href="/admin"
          className="flex flex-none items-center gap-2 border-r-2 border-[var(--color-text)] px-4 transition-colors hover:bg-[var(--color-accent-100)] lg:gap-3 lg:px-6"
        >
          <span className="size-3.5 flex-none bg-[var(--color-accent)]" />
          <span className="display text-[17px]">Back office</span>
          <span className="kicker hidden truncate sm:inline">{staff.branch.name}</span>
        </Link>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 px-4 lg:gap-6 lg:px-6">
          {/*
            บอกให้ชัดว่ากำลังดูอยู่ในสิทธิ์ไหน เพราะจอนี้ทุกตำแหน่งเข้าได้แต่ทำได้ไม่เท่ากัน
            — คนที่กดปุ่มไม่เจอจะได้รู้ทันทีว่าเป็นเพราะสิทธิ์ ไม่ใช่เพราะระบบเสีย
          */}
          <span className="kicker hidden whitespace-nowrap sm:inline">
            {canEditMenu(staff.role) ? "Full edit access" : "Sold-out toggle only"}
          </span>
          <span className="kicker hidden whitespace-nowrap lg:inline">
            {STAFF_ROLE_LABEL[staff.role]}
          </span>
          <span className="display hidden truncate text-[15px] sm:inline">{staff.name}</span>

          <form action={adminLogoutAction} className="flex-none">
            <button type="submit" className="btn btn-secondary h-[38px] whitespace-nowrap">
              Lock screen
            </button>
          </form>
        </div>
      </header>

      {/*
        โครงเดียวกับ (pos)/layout.tsx เป๊ะ ๆ และต้องเป็นแบบนี้:

        1. **แถบเมนูมาก่อนเนื้อหาใน DOM เสมอ** แล้วให้ CSS ย้ายมันลงล่างจอตอน
           จอแคบด้วย `flex-col-reverse` — ไม่ใช่สลับลำดับใน DOM เอง
           (ลำดับ tab/screen reader ต้องเป็น เมนู → เนื้อหา ทั้งสองขนาดจอ)

        2. **`min-w-0` ที่กล่องเนื้อหาห้ามลืม** — flex item มี `min-width:auto`
           เป็นค่าเริ่มต้น ซึ่งแปลว่ามันหดต่ำกว่าความกว้างของลูกไม่ได้ พอมีตาราง
           หรือแถวยาว ๆ ข้างใน กล่องจะดันความกว้างจนล้น แล้วดันความสูงตามมาด้วย
           รอบแรกผมลืมข้อนี้ไป หน้า /admin/menu เลยเลื่อนทั้งหน้าได้
      */}
      <div className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        <AdminNav
          canGoToPos={canAccessScreen(staff.role, "pos")}
          canViewDashboard={canViewDashboard(staff.role)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
