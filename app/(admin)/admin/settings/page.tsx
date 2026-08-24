import { redirect } from "next/navigation";

import { canAccessScreen, canEditSettings, canEditTaxSettings } from "@/lib/rbac";
import { prisma } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";
import { getCurrentStaff } from "@/lib/server/staff-session";

import {
  BusinessInfoForm,
  DeleteStationForm,
  StationForm,
  TaxSettingsForm,
} from "./_components/settings-forms";

/**
 * ตั้งค่าร้าน (spec §22 §23 §24)
 *
 * ── สามแผง สามระดับสิทธิ์ ────────────────────────────────────────────────
 *   1. อัตราภาษี/ค่าบริการ/สกุลเงิน — **เจ้าของร้านเท่านั้น** (เปลี่ยนยอดที่ลูกค้าจ่าย)
 *   2. ข้อมูลร้านบนใบเสร็จ — เจ้าของร้าน/ผู้จัดการ
 *   3. สถานีครัว — เจ้าของร้าน/ผู้จัดการ
 *
 * แผงที่กดไม่ได้ยัง **แสดงค่าปัจจุบันให้เห็น** ไม่ใช่ซ่อนทั้งแผง เพราะผู้จัดการ
 * ต้องรู้ว่าตอนนี้ร้านคิด VAT กี่เปอร์เซ็นต์เพื่อตอบลูกค้าได้ แค่แก้เองไม่ได้
 */
export default async function SettingsPage() {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  if (!canEditSettings(staff.role)) {
    return (
      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
          <span className="display text-[19px]">ตั้งค่า</span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
          <div className="panel mx-auto mt-8 flex max-w-[520px] flex-col gap-2 p-6">
            <span className="display text-[20px]">ดูหน้านี้ไม่ได้</span>
            <p className="text-[var(--color-neutral-700)]">
              เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่แก้ค่าตั้งของสาขาได้
            </p>
          </div>
        </div>
      </main>
    );
  }

  const settings = await getSettings(staff.branchId);

  if (!settings) {
    redirect("/admin/menu");
  }

  const { branch, tenant, stations, paymentCount } = settings;
  const canEditRates = canEditTaxSettings(staff.role);

  /**
   * สถานีที่ยังไม่เคยถูกใช้เลยเท่านั้นที่ลบได้ — นับที่นี่ครั้งเดียวแล้วส่งลงไป
   * ให้หน้าจอไม่ต้องวาดปุ่มที่กดแล้วขึ้น error แน่ ๆ (ตัวที่กันจริงอยู่ฝั่ง server)
   */
  const usage = await prisma.orderItem.groupBy({
    by: ["stationId"],
    where: { stationId: { in: stations.map((station) => station.id) } },
    _count: { _all: true },
  });
  const menuUsage = await prisma.menuItem.groupBy({
    by: ["stationId"],
    where: { stationId: { in: stations.map((station) => station.id) } },
    _count: { _all: true },
  });
  const usedStationIds = new Set(
    [...usage, ...menuUsage].map((row) => row.stationId).filter((id): id is string => id !== null),
  );

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
        <div className="flex items-baseline gap-3">
          <span className="display text-[19px]">ตั้งค่า</span>
          <span className="kicker">
            {branch.name} · {branch.currency} · {branch.timezone}
          </span>
        </div>
        <span className="kicker">แก้แล้วมีผลกับบิลใบถัดไป ไม่ย้อนหลัง</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-[840px] flex-col gap-5">
          <section className="panel flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <span className="display text-[17px]">ภาษีและค่าบริการ</span>
              <span className="kicker">
                มีผลกับบิลที่เปิดอยู่และบิลใบถัดไป · บิลที่ปิดไปแล้วเก็บอัตราของตัวเองไว้ ไม่เปลี่ยนตาม
              </span>
            </div>

            <TaxSettingsForm
              vatRateBp={branch.vatRateBp}
              serviceChargeBp={branch.serviceChargeBp}
              staffMealDiscountBp={branch.staffMealDiscountBp}
              pricesIncludeVat={branch.pricesIncludeVat}
              currency={branch.currency}
              timezone={branch.timezone}
              currencyLocked={paymentCount > 0}
              disabledReason={
                canEditRates
                  ? undefined
                  : `ตอนนี้ VAT ${branch.vatRateBp / 100}% · เซอร์วิสชาร์จ ${
                      branch.serviceChargeBp / 100
                    }% · ส่วนลดพนักงาน ${branch.staffMealDiscountBp / 100}% — เฉพาะเจ้าของร้านเท่านั้นที่แก้ได้`
              }
            />
          </section>

          <section className="panel flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <span className="display text-[17px]">ข้อมูลร้านบนใบเสร็จ</span>
              <span className="kicker">
                ใบที่ออกไปแล้วเก็บข้อมูล ณ วันที่ออกไว้ในตัวเอง — แก้ที่นี่ไม่กระทบใบเก่า
              </span>
            </div>

            <BusinessInfoForm
              tenantName={tenant.name}
              taxId={tenant.taxId}
              branchName={branch.name}
              addressLine={branch.addressLine}
              phone={branch.phone}
              receiptFooter={branch.receiptFooter}
            />
          </section>

          <section className="panel flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <span className="display text-[17px]">สถานีครัว</span>
              <span className="kicker">
                จอครัวแยกตั๋วตามสถานีที่ผูกไว้กับเมนู · เปลี่ยนชื่อได้ ตั๋วที่อยู่บนจอไม่กระทบ
              </span>
            </div>

            <ul className="flex flex-col gap-4">
              {stations.map((station) => (
                <li key={station.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="display text-[15px]">
                      {station.code} · {station.name}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={station.isActive ? "tag tag-neutral" : "tag"}>
                        {station.isActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                      </span>
                      {usedStationIds.has(station.id) ? (
                        <span className="kicker">เคยถูกใช้แล้ว ลบไม่ได้</span>
                      ) : (
                        <DeleteStationForm stationId={station.id} />
                      )}
                    </span>
                  </div>

                  <StationForm station={station} />
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2">
              <span className="kicker">เพิ่มสถานีใหม่</span>
              <StationForm />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
