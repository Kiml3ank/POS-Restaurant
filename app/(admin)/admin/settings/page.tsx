import { redirect } from "next/navigation";

import { formatBp } from "@/lib/bill";
import { canAccessScreen, canEditSettings, canEditTaxSettings } from "@/lib/rbac";
import { salePointKey } from "@/lib/sale-point";
import { prisma } from "@/lib/server/db";
import { getT } from "@/lib/server/locale";
import { getSettings } from "@/lib/server/settings";
import { getCurrentStaff } from "@/lib/server/staff-session";

import {
  BusinessInfoForm,
  DeleteStationForm,
  DeleteTableForm,
  RotateQrForm,
  StationForm,
  TableForm,
  TaxSettingsForm,
} from "./_components/settings-forms";

/**
 * ตั้งค่าร้าน (spec §22 §23 §24)
 *
 * ── สามแผง สามระดับสิทธิ์ ────────────────────────────────────────────────
 *   1. อัตราภาษี/ค่าบริการ/สกุลเงิน — **เจ้าของร้านเท่านั้น** (เปลี่ยนยอดที่ลูกค้าจ่าย)
 *   2. ข้อมูลร้านบนใบเสร็จ — เจ้าของร้าน/ผู้จัดการ
 *   3. สถานีครัว — เจ้าของร้าน/ผู้จัดการ
 *   4. จุดขาย (โต๊ะ/เคาน์เตอร์/ช่องไรเดอร์) — เจ้าของร้าน/ผู้จัดการ
 *
 * แผงที่กดไม่ได้ยัง **แสดงค่าปัจจุบันให้เห็น** ไม่ใช่ซ่อนทั้งแผง เพราะผู้จัดการ
 * ต้องรู้ว่าตอนนี้ร้านคิด VAT กี่เปอร์เซ็นต์เพื่อตอบลูกค้าได้ แค่แก้เองไม่ได้
 */
export default async function SettingsPage() {
  const { t, tc } = await getT();
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  if (!canEditSettings(staff.role)) {
    return (
      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
          <span className="display text-[19px]">{t("admin.nav.settings")}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
          <div className="panel mx-auto mt-8 flex max-w-[520px] flex-col gap-2 p-6">
            <span className="display text-[20px]">{t("common.cantViewPage")}</span>
            <p className="text-[var(--color-neutral-700)]">{t("admin.settings.deniedDetail")}</p>
          </div>
        </div>
      </main>
    );
  }

  const settings = await getSettings(staff.branchId);

  if (!settings) {
    redirect("/admin/menu");
  }

  const { branch, tenant, stations, tables, paymentCount } = settings;
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
          <span className="display text-[19px]">{t("admin.nav.settings")}</span>
          <span className="kicker">
            {branch.name} · {branch.currency} · {branch.timezone}
          </span>
        </div>
        <span className="kicker">{t("admin.settings.note")}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-[840px] flex-col gap-5">
          <section className="panel flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <span className="display text-[17px]">{t("admin.settings.taxTitle")}</span>
              <span className="kicker">{t("admin.settings.taxNote")}</span>
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
                  : t("admin.settings.ratesReadonly", {
                      vat: formatBp(branch.vatRateBp),
                      service: formatBp(branch.serviceChargeBp),
                      meal: formatBp(branch.staffMealDiscountBp),
                    })
              }
            />
          </section>

          <section className="panel flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <span className="display text-[17px]">{t("admin.settings.businessTitle")}</span>
              <span className="kicker">{t("admin.settings.businessNote")}</span>
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
              <span className="display text-[17px]">{t("admin.settings.stationsTitle")}</span>
              <span className="kicker">{t("admin.settings.stationsNote")}</span>
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
                        {t(station.isActive ? "common.active" : "common.disabled")}
                      </span>
                      {usedStationIds.has(station.id) ? (
                        <span className="kicker">{t("admin.settings.used")}</span>
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
              <span className="kicker">{t("admin.settings.addStation")}</span>
              <StationForm />
            </div>
          </section>

          {/*
            จุดขาย — โต๊ะนั่ง / เคาน์เตอร์ซื้อกลับ / ช่องไรเดอร์ อยู่ในตารางเดียวกัน
            (RestaurantTable) ต่างกันที่ `kind` ซึ่งตัดสินสี่ข้อพร้อมกัน ดู lib/sale-point.ts

            วางไว้ล่างสุดเพราะเป็นแผงที่ยาวที่สุดและถูกแตะน้อยที่สุด — เพิ่มโต๊ะเป็นงาน
            ตอนจัดร้านใหม่ ไม่ใช่งานประจำวันแบบ "ของหมด"
          */}
          <section className="panel flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <span className="display text-[17px]">{t("admin.settings.tablesTitle")}</span>
              <span className="kicker">{t("admin.settings.tablesNote")}</span>
            </div>

            <ul className="flex flex-col gap-4">
              {tables.map((table) => (
                <li key={table.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="display text-[15px]">{table.name}</span>
                      <span className="kicker">
                        {t(salePointKey(table.kind))}
                        {table.kind === "DINE_IN" ? ` · ${tc("pos.card.seats", table.seats)}` : ""}
                      </span>
                      {/*
                        โชว์รหัส QR เป็นตัวหนังสือด้วย ไม่ใช่แค่รูป — พนักงานต้องพิมพ์
                        ตามด้วยมือได้เวลากล้องสแกนไม่ติด (เหตุผลเดียวกับที่ตัวอักษรของ
                        รหัสตัด 0/O และ 1/l ออก)
                      */}
                      {table.kind === "DINE_IN" ? (
                        <code className="kicker">/t/{table.tableCode}</code>
                      ) : null}
                    </span>

                    <span className="flex flex-wrap items-center gap-2">
                      {table.hasOpenSession ? (
                        <span className="tag">{t("admin.settings.openBill")}</span>
                      ) : null}
                      <span className={table.isActive ? "tag tag-neutral" : "tag"}>
                        {t(table.isActive ? "common.active" : "common.disabled")}
                      </span>
                      {table.kind === "DINE_IN" ? (
                        <RotateQrForm tableId={table.id} tableName={table.name} />
                      ) : null}
                      {table.deletable ? (
                        <DeleteTableForm tableId={table.id} />
                      ) : (
                        <span className="kicker">{t("admin.settings.hasHistory")}</span>
                      )}
                    </span>
                  </div>

                  <TableForm
                    table={{
                      id: table.id,
                      name: table.name,
                      seats: table.seats,
                      sortOrder: table.sortOrder,
                      kind: table.kind,
                      isActive: table.isActive,
                      locked: !table.deletable,
                    }}
                  />
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2">
              <span className="kicker">{t("admin.settings.addTable")}</span>
              <TableForm />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
