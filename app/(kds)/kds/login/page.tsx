import { redirect } from "next/navigation";

import { PinForm } from "@/components/pin-form";
import { canAccessScreen } from "@/lib/rbac";
import { getCurrentStaff, readLastStaffOnDevice } from "@/lib/server/staff-session";

import { kdsLoginAction } from "../actions";

/**
 * หน้าล็อกจอของจอครัว (บทที่ 8)
 *
 * ต้องมีหน้านี้แยกจาก /pos/login ไม่ใช่เพราะหน้าตา แต่เพราะ **ด่านสิทธิ์คนละด่าน**:
 * loginAction ของ POS จะเตะพนักงานครัวออกทันทีที่ล็อกอินสำเร็จ (ครัวไม่มีสิทธิ์
 * เข้าหน้า POS) ถ้าไม่มีหน้านี้ พนักงานครัวจะล็อกอินเข้าระบบไม่ได้เลยสักทาง
 *
 * แป้น PIN เป็น component ตัวเดียวกับ POS เป๊ะ ๆ (components/pin-form.tsx)
 * ต่างกันแค่ action ที่ส่งเข้าไป — กฎความยาว PIN, การไม่โชว์ตัวเลขจริง,
 * และการนับครั้งที่กรอกผิด จึงเป็นชุดเดียวกันทั้งระบบโดยอัตโนมัติ
 */
export default async function KdsLoginPage() {
  const staff = await getCurrentStaff("kds");
  const lastStaff = await readLastStaffOnDevice("kds");

  if (staff && canAccessScreen(staff.role, "kds")) {
    redirect("/kds");
  }

  return (
    <main className="grid flex-1 grid-cols-1 xl:grid-cols-[1fr_620px]">
      <div className="flex min-w-0 flex-col justify-between gap-10 border-b-2 border-[var(--color-text)] p-6 sm:p-10 xl:border-r-2 xl:border-b-0 xl:p-16">
        <div className="flex flex-col gap-4">
          <p className="kicker kicker-accent">Kitchen display · all stations</p>
          <p className="display text-[40px] leading-[0.92] tracking-[-0.03em] sm:text-[56px] xl:text-[76px]">
            KITCHEN
            <br />
            DISPLAY
          </p>
          <p className="max-w-[420px] leading-relaxed text-[var(--color-neutral-700)]">
            Enter your PIN to open the display. Orders arrive automatically —
            every time you accept or finish an item, it&apos;s timestamped under your name.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rule" />
          <div className="kicker flex flex-wrap justify-between gap-3">
            <span>Dev staff code / PIN (4 digits)</span>
            <span>004 · 4567 Kitchen</span>
            <span>001 · 1234 Owner</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-[var(--color-neutral-100)] p-5 sm:p-10 xl:p-14">
        <div className="w-full max-w-[440px]">
          <PinForm action={kdsLoginAction} submitLabel="Open kitchen display" lastStaff={lastStaff} />
        </div>
      </div>
    </main>
  );
}
