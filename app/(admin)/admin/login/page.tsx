import { redirect } from "next/navigation";

import { PinForm } from "@/components/pin-form";
import { canAccessScreen } from "@/lib/rbac";
import { getCurrentStaff, readLastStaffOnDevice } from "@/lib/server/staff-session";

import { adminLoginAction } from "../actions";

/**
 * หน้าล็อกจอของหลังร้าน (โมดูล 04)
 *
 * ต้องมีหน้านี้แยกจาก /pos/login และ /kds/login เพราะ **cookie คนละใบ** —
 * เครื่องที่ล็อกอิน POS ไว้แล้วต้องยังถูกถามหา PIN ตอนเปิดหลังร้าน
 * (เหตุผลเต็มอยู่ใน lib/staff-session-cookie.ts)
 *
 * ต่างจากอีกสองจอตรงที่ **ทุกตำแหน่งล็อกอินผ่าน** เพราะทุกคนต้องกดของหมดได้
 * — สิ่งที่ต่างกันคือกดปุ่มไหนได้บ้างหลังเข้ามาแล้ว ไม่ใช่เข้าได้หรือไม่ได้
 */
export default async function AdminLoginPage() {
  const staff = await getCurrentStaff("admin");
  const lastStaff = await readLastStaffOnDevice("admin");

  if (staff && canAccessScreen(staff.role, "admin")) {
    redirect("/admin/menu");
  }

  return (
    <main className="grid flex-1 grid-cols-1 xl:grid-cols-[1fr_620px]">
      <div className="flex min-w-0 flex-col justify-between gap-10 border-b-2 border-[var(--color-text)] p-6 sm:p-10 xl:border-r-2 xl:border-b-0 xl:p-16">
        <div className="flex flex-col gap-4">
          <p className="kicker kicker-accent">หลังร้าน · เมนูและสินค้า</p>
          <p className="display text-[40px] leading-[0.92] tracking-[-0.03em] sm:text-[56px] xl:text-[76px]">
            BACK
            <br />
            OFFICE
          </p>
          <p className="max-w-[420px] leading-relaxed text-[var(--color-neutral-700)]">
            แก้เมนู ราคา และกลุ่มตัวเลือก · ของที่หมดกลางกะกดปิดได้จากที่นี่แล้ว
            มือถือลูกค้าที่เปิดเมนูค้างอยู่จะอัปเดตเองทันที
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rule" />
          <p className="kicker">
            ทุกการแก้ไขถูกบันทึกชื่อผู้กดและค่าก่อน-หลังไว้เสมอ
          </p>
          <div className="kicker flex flex-wrap justify-between gap-3">
            <span>รหัส / PIN สำหรับ dev (4 หลัก)</span>
            <span>001 · 1234 เจ้าของร้าน</span>
            <span>002 · 2345 แคชเชียร์</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-[var(--color-neutral-100)] p-5 sm:p-10 xl:p-14">
        <div className="w-full max-w-[440px]">
          <PinForm action={adminLoginAction} submitLabel="Enter back office" lastStaff={lastStaff} />
        </div>
      </div>
    </main>
  );
}
