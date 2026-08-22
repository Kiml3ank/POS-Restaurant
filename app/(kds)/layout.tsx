import { LiveRefresh } from "@/components/live-refresh";
import { STAFF_ROLE_LABEL, canAccessScreen } from "@/lib/rbac";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { kdsLogoutAction } from "./kds/actions";

/**
 * Layout ของจอครัว (KDS) — บทที่ 8
 *
 * `pos-skin kds-skin` = design system ตัวเดียวกับเครื่องพนักงาน แต่กลับสีเป็น
 * โหมดมืด (ดูเหตุผลเต็มในหัวข้อ KDS ที่ท้าย app/globals.css) ตรงนี้คือจุดเดียว
 * ที่แปะคลาสให้ทั้ง route group ตามกฎใน CLAUDE.md — ห้ามย้าย token ขึ้น :root
 *
 * ── ไฟ "สดอยู่" บนแถบหัวจอ ─────────────────────────────────────────────
 * อยู่ที่ layout ไม่ใช่ที่ page เพราะสาย SSE ต้องไม่ถูกตัดแล้วต่อใหม่ทุกครั้งที่
 * ครัวสลับแท็บสถานี (layout ไม่ re-mount ตอนเปลี่ยน page ใน group เดียวกัน)
 * ถ้าเผลอย้ายไปไว้ใน page.tsx จะได้จอที่ "กำลังต่อ..." กะพริบทุกครั้งที่กดแท็บ
 *
 * และมันไม่ใช่ของประดับ: จอที่ค้างภาพเมื่อยี่สิบนาทีที่แล้วกับจอที่สดอยู่
 * หน้าตาเหมือนกันเป๊ะเมื่อครัวไม่ยุ่ง ครัวต้องมีทางรู้ว่ากำลังมองของจริงอยู่ไหม
 * โดยไม่ต้องเดินไปกดอะไรสักอย่างเพื่อทดสอบ
 *
 * `h-dvh overflow-hidden` ด้วยเหตุผลเดียวกับ (pos)/layout.tsx — หน้าใหม่ใน
 * group นี้ต้องใส่ `min-h-0` + `overflow-auto` เองเสมอ ไม่งั้นเนื้อหาโดนตัดหาย
 */
export default async function KdsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staff = await getCurrentStaff("kds");

  // หน้าใส่ PIN — ยังไม่มีใครล็อกอิน จึงไม่มีแถบหัวจอและไม่มีสาย SSE
  if (!staff || !canAccessScreen(staff.role, "kds")) {
    return <div className="pos-skin kds-skin flex min-h-dvh flex-col">{children}</div>;
  }

  return (
    <div className="pos-skin kds-skin flex h-dvh flex-col overflow-hidden">
      <header className="flex h-[58px] flex-none items-stretch border-b-2 border-[var(--color-text)] lg:h-[66px]">
        <div className="flex flex-none items-center gap-2 border-r-2 border-[var(--color-text)] px-4 lg:gap-3 lg:px-6">
          <span className="size-3.5 flex-none bg-[var(--color-accent)]" />
          <span className="display text-[17px]">KDS</span>
          <span className="kicker hidden truncate sm:inline">{staff.branch.name}</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 px-4 lg:gap-6 lg:px-6">
          {/*
            ไฟ "สดอยู่" ไม่ถูกซ่อนบนจอแคบเด็ดขาด — มันคือสิ่งเดียวที่บอกครัวว่า
            จอที่กำลังมองอยู่เป็นของสดหรือภาพค้าง ซึ่งสำคัญกว่าชื่อคนกดเสียอีก
          */}
          <LiveRefresh src="/api/realtime" className="text-[var(--color-accent-700)]" />
          <span className="kicker hidden whitespace-nowrap lg:inline">
            {STAFF_ROLE_LABEL[staff.role]}
          </span>
          <span className="display hidden truncate text-[15px] sm:inline">{staff.name}</span>

          <form action={kdsLogoutAction} className="flex-none">
            <button type="submit" className="btn btn-secondary h-[38px] whitespace-nowrap">
              ล็อกจอ
            </button>
          </form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
