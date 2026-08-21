import { redirect } from "next/navigation";

import { canAccessScreen } from "@/lib/rbac";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { PinForm } from "../_components/pin-form";

/**
 * หน้าล็อกจอของเครื่อง POS (บทที่ 13 ส่วนที่ดึงมาทำก่อน)
 *
 * ล็อกอินด้วยรหัสพนักงาน + PIN สั้น ไม่ใช่อีเมล/รหัสผ่าน เพราะหน้าร้านต้อง
 * สลับคนกดได้ในไม่กี่วินาที — ราคาที่จ่ายคือต้องมี rate limit + AuditLog กำกับ
 * (ดู lib/server/staff-session.ts)
 *
 * เลย์เอาต์สองคอลัมน์ยืมจาก design "Cafe POS" ตรง ๆ แต่ **ไม่เอาลิสต์รายชื่อ
 * พนักงานที่กดเลือกได้มาด้วย** — จอนี้อยู่ในที่ที่ลูกค้ามองเห็น การโชว์รายชื่อ
 * ทั้งกะคือการแจกครึ่งหนึ่งของข้อมูลที่ต้องใช้ล็อกอินให้ฟรี และขัดกับที่
 * loginStaff() ตั้งใจตอบข้อความเดียวกันทั้งกรณีรหัสผิดและ PIN ผิด
 *
 * หัวเรื่องใหญ่คงเป็นตัวโรมันตาม design เพราะเป็น wordmark ไม่ใช่ข้อความที่ต้องอ่าน
 * และ line-height 0.92 ของ design ตัดหัว-หางสระไทยขาดถ้าเอาตัวไทยมาวางตรงนี้
 */
export default async function PosLoginPage() {
  const staff = await getCurrentStaff();

  if (staff && canAccessScreen(staff.role, "pos")) {
    redirect("/pos");
  }

  return (
    <main className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_620px]">
      <div className="flex flex-col justify-between gap-10 border-b-2 border-[var(--color-text)] p-10 lg:border-r-2 lg:border-b-0 lg:p-16">
        <div className="flex flex-col gap-4">
          <p className="kicker kicker-accent">เครื่องพนักงาน · เคาน์เตอร์ 01</p>
          <p className="display text-[56px] leading-[0.92] tracking-[-0.03em] lg:text-[76px]">
            POINT OF
            <br />
            SALE
          </p>
          <p className="max-w-[420px] leading-relaxed text-[var(--color-neutral-700)]">
            ใส่ PIN เพื่อเริ่มกะของคุณ ทุกบิล ทุกการยกเลิก และการปิดรอบโต๊ะ
            จะถูกบันทึกไว้ในชื่อของคุณจนกว่าจะกดล็อกจอ
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rule" />
          <div className="kicker flex flex-wrap justify-between gap-3">
            <span>รหัส / PIN สำหรับ dev (4 หลัก)</span>
            <span>001 · 1234 เจ้าของร้าน</span>
            <span>002 · 2345 แคชเชียร์</span>
            <span>003 · 3456 เสิร์ฟ</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-[var(--color-neutral-100)] p-10 lg:p-14">
        <div className="w-full max-w-[440px]">
          <PinForm />
        </div>
      </div>
    </main>
  );
}
