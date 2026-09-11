import { redirect } from "next/navigation";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { PinForm } from "@/components/pin-form";
import { canAccessScreen, staffRoleKey } from "@/lib/rbac";
import { getT } from "@/lib/server/locale";
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
  const { t } = await getT();
  const staff = await getCurrentStaff("admin");
  const lastStaff = await readLastStaffOnDevice("admin");

  if (staff && canAccessScreen(staff.role, "admin")) {
    redirect("/admin/menu");
  }

  return (
    <main className="grid flex-1 grid-cols-1 xl:grid-cols-[1fr_620px]">
      <div className="flex min-w-0 flex-col justify-between gap-10 border-b-2 border-[var(--color-text)] p-6 sm:p-10 xl:border-r-2 xl:border-b-0 xl:p-16">
        <div className="flex flex-col gap-4">
          {/* ต้องเลือกภาษาได้ตั้งแต่หน้านี้ — คนที่อ่านหน้าล็อกอินไม่ออกไปถึงปุ่มในแถบหัวจอไม่ได้ */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="kicker kicker-accent">{t("admin.login.kicker")}</p>
            <LocaleSwitcher />
          </div>
          <p className="display text-[40px] leading-[0.92] tracking-[-0.03em] sm:text-[56px] xl:text-[76px]">
            {t("admin.login.hero1")}
            <br />
            {t("admin.login.hero2")}
          </p>
          <p className="max-w-[420px] leading-relaxed text-[var(--color-neutral-700)]">
            {t("admin.login.intro")}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rule" />
          <p className="kicker">{t("admin.login.auditNote")}</p>
          <div className="kicker flex flex-wrap justify-between gap-3">
            <span>{t("login.devHint")}</span>
            <span>001 · 1234 {t(staffRoleKey("OWNER"))}</span>
            <span>002 · 2345 {t(staffRoleKey("CASHIER"))}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-[var(--color-neutral-100)] p-5 sm:p-10 xl:p-14">
        <div className="w-full max-w-[440px]">
          <PinForm action={adminLoginAction} submitLabel={t("admin.login.submit")} lastStaff={lastStaff} />
        </div>
      </div>
    </main>
  );
}
