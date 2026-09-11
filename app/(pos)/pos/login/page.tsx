import { redirect } from "next/navigation";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { PinForm } from "@/components/pin-form";
import { canAccessScreen, staffRoleKey } from "@/lib/rbac";
import { getT } from "@/lib/server/locale";
import { getCurrentStaff, readLastStaffOnDevice } from "@/lib/server/staff-session";

import { loginAction } from "../actions";

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
 * สิ่งที่โชว์แทนคือ **ชื่อคนล่าสุดที่ใช้เครื่องนี้เครื่องเดียว** (จาก cookie ของ
 * เครื่อง ไม่ใช่ query รายชื่อพนักงาน) และไม่โชว์รหัสพนักงานคู่กัน —
 * ตอบคำถาม "รับกะต่อจากใคร" ได้โดยไม่กลายเป็นรายชื่อให้ไล่สุ่ม
 * รายละเอียดการแลกได้แลกเสียอยู่ที่ lib/last-staff-cookie.ts
 *
 * หัวเรื่องใหญ่แปลตามภาษาแล้ว ("ĐIỂM / BÁN HÀNG") — เดิมตรึงเป็นอังกฤษเพราะ
 * line-height 0.92 ตัดหัว-หางสระไทยขาด ส่วนวรรณยุกต์ซ้อนของเวียดนาม (Ể Ế) ตรวจจาก
 * screenshot จริงแล้วว่าวาดครบ: เครื่องหมายบรรทัดแรกล้นขึ้นไปในช่องว่างเหนือหัวเรื่อง
 * และบรรทัดสองไม่ชนบรรทัดแรกเพราะตัวพิมพ์ใหญ่ไม่มีหาง · **ถ้าลด gap เหนือหัวเรื่อง
 * หรือใส่ overflow-hidden ให้กล่องนี้ ต้องถ่ายภาพตรวจใหม่** ตัววัดตัวเลขมองไม่เห็นเรื่องนี้
 */
export default async function PosLoginPage() {
  const { t } = await getT();
  const staff = await getCurrentStaff("pos");
  const lastStaff = await readLastStaffOnDevice("pos");

  if (staff && canAccessScreen(staff.role, "pos")) {
    redirect("/pos");
  }

  return (
    <main className="grid flex-1 grid-cols-1 xl:grid-cols-[1fr_620px]">
      <div className="flex min-w-0 flex-col justify-between gap-10 border-b-2 border-[var(--color-text)] p-6 sm:p-10 xl:border-r-2 xl:border-b-0 xl:p-16">
        <div className="flex flex-col gap-4">
          {/* ต้องเลือกภาษาได้ตั้งแต่หน้านี้ — คนที่อ่านหน้าล็อกอินไม่ออกไปถึงปุ่มในแถบหัวจอไม่ได้ */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="kicker kicker-accent">{t("pos.login.kicker")}</p>
            <LocaleSwitcher />
          </div>
          <p className="display text-[40px] leading-[0.92] tracking-[-0.03em] sm:text-[56px] xl:text-[76px]">
            {t("pos.login.hero1")}
            <br />
            {t("pos.login.hero2")}
          </p>
          <p className="max-w-[420px] leading-relaxed text-[var(--color-neutral-700)]">
            {t("pos.login.intro")}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rule" />
          <div className="kicker flex flex-wrap justify-between gap-3">
            <span>{t("login.devHint")}</span>
            <span>001 · 1234 {t(staffRoleKey("OWNER"))}</span>
            <span>002 · 2345 {t(staffRoleKey("CASHIER"))}</span>
            <span>003 · 3456 {t(staffRoleKey("SERVER"))}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-[var(--color-neutral-100)] p-5 sm:p-10 xl:p-14">
        <div className="w-full max-w-[440px]">
          <PinForm action={loginAction} lastStaff={lastStaff} />
        </div>
      </div>
    </main>
  );
}
