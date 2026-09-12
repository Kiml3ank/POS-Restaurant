import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveRefresh } from "@/components/live-refresh";
import type { Currency } from "@/lib/generated/prisma/enums";
import { formatMoney } from "@/lib/money";
import { canAccessScreen, canManageShift } from "@/lib/rbac";
import { salePointKey } from "@/lib/sale-point";
import { getT, type Translator } from "@/lib/server/locale";
import {
  getOpenSalePointSessions,
  getPosTables,
  type PosTableSummary,
} from "@/lib/server/pos";
import { getOpenShift } from "@/lib/server/shift";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * ผังโต๊ะ — หน้าแรกของเครื่องพนักงาน (บทที่ 9)
 *
 * สิ่งที่พนักงานต้องอ่านออกภายในหนึ่งวินาทีจากระยะสองเมตร:
 *   1. โต๊ะไหนว่าง (กดเปิดได้เลย)
 *   2. โต๊ะไหนมีของ "พร้อมเสิร์ฟ" ค้างอยู่ (ต้องรีบไปยก)
 *   3. โต๊ะไหนยอดเท่าไหร่แล้ว (เตรียมคิดเงิน)
 *
 * design "Modernist" มีสี accent สีเดียว จึงเปลี่ยนวิธีสื่อสถานะจาก "สีการ์ด
 * หลายสี" (เขียว/เหลือง/ขาว แบบเดิม) มาเป็น **ลำดับความเข้ม**: โต๊ะที่ต้องรีบ
 * ไปยกของได้พื้น accent เต็ม ๆ ใบเดียวในจอ ที่เหลือเป็นกระดาษเปล่า —
 * อ่านง่ายกว่าเพราะตาจับ "ใบที่ต่างจากพวก" ได้เร็วกว่าจับเฉดสี
 */
export default async function PosTableMapPage() {
  const i18n = await getT();
  const { t, tc } = i18n;
  const staff = await getCurrentStaff("pos");

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const currency = staff.branch.currency;
  const [tables, takeawayQueue, openShiftRow] = await Promise.all([
    getPosTables(staff.branchId),
    getOpenSalePointSessions(staff.branchId),
    getOpenShift(staff.branchId),
  ]);
  const takeawayReady = takeawayQueue.filter((entry) => entry.readyItems > 0).length;
  const openTables = tables.filter((table) => table.session !== null);
  const totalOnFloor = openTables.reduce((sum, table) => sum + table.runningTotal, 0);
  const needAttention = tables.filter((table) => table.readyItems > 0).length;

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4 lg:gap-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="kicker kicker-accent">
            {needAttention > 0 ? tc("pos.map.waiting", needAttention) : t("pos.map.nothingWaiting")}
          </p>
          {/* หัวเรื่องย่อลงบนจอแคบ เพราะ 40px กินความสูงไปหนึ่งแถวโต๊ะเต็ม ๆ */}
          <h1 className="display text-[28px] lg:text-[40px]">{t("pos.map.title")}</h1>
        </div>

        <div className="flex flex-wrap items-end gap-4 lg:gap-8">
          {/*
            ผังโต๊ะรับ event เดียวกับจอครัว (บทที่ 8) — โต๊ะที่ลูกค้าเพิ่งสแกน QR เปิดเอง
            และตัวเลข "พร้อมเสิร์ฟ" ที่ครัวเพิ่งกด จะขึ้นเองโดยพนักงานไม่ต้องกดโหลดใหม่
            ซึ่งเป็นเหตุผลทั้งหมดที่หน้านี้มีอยู่: พนักงานเดินผ่านแล้วเหลือบมอง ไม่ได้มายืนกด
          */}
          <LiveRefresh src="/api/realtime" className="text-[var(--color-accent-700)]" />

          <div className="flex flex-col gap-1">
            <span className="kicker">{t("pos.map.open")}</span>
            <span className="display text-[22px]">
              {t("pos.map.openCount", { open: openTables.length, total: tables.length })}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="kicker">{t("pos.map.totalOnTables")}</span>
            <span className="display text-[22px]">{formatMoney(totalOnFloor, currency)}</span>
          </div>
        </div>
      </div>

      {/*
        แถบ "ยังไม่ได้เปิดกะ" (บทที่ 15)

        **ห้ามขวางการขาย** — เป็นแถบข้อความที่กดไปหน้าเปิดกะได้ ไม่ใช่ modal
        และไม่ปิดปุ่มไหนเลย ระบบกะเป็นเครื่องมือนับเงิน ร้านที่ลืมเปิดกะต้องขายต่อได้
        (เงินที่รับตอนนี้ถูกนับแยกแล้วโชว์ให้เห็นที่หน้าเปิดกะ)

        อยู่ในโซนที่เลื่อนได้ ไม่ใช่หัวจอ — ของที่เพิ่มในโซน `flex-none`
        จะไปกินพื้นที่ของโซนที่เลื่อนได้เสมอ (บทเรียนจากบั๊ก "รวมทั้งสิ้นหายจากจอ")
      */}
      {openShiftRow === null && canManageShift(staff.role) ? (
        <Link href="/pos/shift" className="alert flex items-baseline justify-between gap-4">
          <span>{t("pos.shift.bannerNoShift")}</span>
          <span className="kicker whitespace-nowrap">{t("pos.shift.bannerAction")} ›</span>
        </Link>
      ) : null}

      {/*
        แถบซื้อกลับ — ทางเข้าเดียวของบิลที่ไม่ได้อยู่บนโต๊ะ

        จุดขายที่ไม่ใช่โต๊ะนั่งถูกกรองออกจากผังด้านล่างโดยตั้งใจ (ผังตอบคำถาม
        "โต๊ะไหนว่าง" ซึ่งเคาน์เตอร์ตอบไม่ได้ เพราะมีบิลเปิดพร้อมกันได้หลายใบ)
        ถ้าไม่มีแถบนี้ **บิลซื้อกลับที่เปิดค้างอยู่จะมองไม่เห็นจากหน้าจอไหนเลย**

        วางไว้เหนือผังโต๊ะเพราะลูกค้าซื้อกลับยืนรออยู่หน้าร้านจริง ๆ ต่างจาก
        โต๊ะที่นั่งรอได้ — ของที่ต้องรีบกว่าต้องอยู่สูงกว่าบนจอ
      */}
      <Link
        href="/pos/counter"
        className={`flex items-center justify-between gap-4 border-2 border-[var(--color-text)] px-5 py-4 transition-colors ${
          takeawayReady > 0
            ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-600)]"
            : "hover:bg-[var(--color-accent-100)]"
        }`}
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className={`kicker ${takeawayReady > 0 ? "text-white/80" : "kicker-accent"}`}>
            {t(salePointKey("COUNTER"))}
          </span>
          <span className="display text-[19px]">
            {takeawayQueue.length === 0
              ? t("pos.map.takeawayNew")
              : tc("pos.map.takeawayOpen", takeawayQueue.length)}
          </span>
        </span>

        <span className="flex items-baseline gap-4 whitespace-nowrap lg:gap-6">
          {takeawayReady > 0 ? (
            <span className="display text-[17px]">{tc("pos.map.takeawayReady", takeawayReady)}</span>
          ) : null}
          <span className="display text-[22px]">›</span>
        </span>
      </Link>

      <div className="rule" />

      {tables.length === 0 ? (
        <p className="text-[var(--color-neutral-700)]">{t("pos.map.noTables")}</p>
      ) : (
        <ul className="ink-grid ink-grid-sparse grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tables.map((table) => (
            <li key={table.id}>
              <TableCard table={table} currency={currency} i18n={i18n} />
            </li>
          ))}
        </ul>
      )}

      <p className="kicker mt-auto">{t("pos.map.footer")}</p>
    </main>
  );
}

function TableCard({
  table,
  currency,
  i18n: { t, tc },
}: {
  table: PosTableSummary;
  currency: Currency;
  /** รับจาก page — การ์ดเป็น server component ธรรมดา เรียก getT() ซ้ำทุกใบไม่คุ้ม */
  i18n: Translator;
}) {
  const isOpen = table.session !== null;
  const needsAttention = table.readyItems > 0;

  return (
    <Link
      href={`/pos/table/${table.id}`}
      className={`flex h-full min-h-[210px] flex-col gap-4 p-6 transition-colors ${
        needsAttention
          ? "bg-[var(--color-accent-100)] hover:bg-[var(--color-accent-200)]"
          : "bg-[var(--color-bg)] hover:bg-[var(--color-neutral-200)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="display text-[28px]">{table.name}</span>
        {needsAttention ? (
          <span className="tag tag-solid">{t("pos.card.ready", { count: table.readyItems })}</span>
        ) : isOpen ? (
          <span className="tag tag-outline">{tc("common.guests", table.session?.pax ?? 0)}</span>
        ) : (
          <span className="kicker">{tc("pos.card.seats", table.seats)}</span>
        )}
      </div>

      {isOpen ? (
        <>
          <div className="flex flex-1 flex-col gap-1 text-[var(--color-neutral-700)]">
            {table.pendingItems > 0 ? <span>{tc("pos.card.preparing", table.pendingItems)}</span> : null}
            {table.draftCount > 0 ? <span>{t("pos.card.cartPending")}</span> : null}
            {table.pendingItems === 0 && table.draftCount === 0 && !needsAttention ? (
              <span>{t("pos.card.allServed")}</span>
            ) : null}
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <span className="kicker">{t("pos.card.runningTotal")}</span>
            <span className="display text-[24px]">{formatMoney(table.runningTotal, currency)}</span>
          </div>

          {/* ปุ่มท้ายการ์ดตาม design ("Resume tab") — การ์ดทั้งใบเป็นลิงก์อยู่แล้ว
              ตัวนี้จึงเป็น <span> ที่หน้าตาเป็นปุ่ม ไม่ใช่ <button> ซ้อนในลิงก์
              มีไว้เพราะการ์ดที่เปิดอยู่ไม่เคยบอกเลยว่ากดแล้วเจออะไร */}
          <span className="btn btn-secondary btn-block h-11">
            {table.draftCount > 0 ? t("pos.card.viewCart") : t("pos.card.order")}
          </span>
        </>
      ) : (
        <>
          <div className="flex flex-1 items-start text-[var(--color-neutral-600)]">{t("pos.card.empty")}</div>
          <span className="btn btn-secondary btn-block h-11">{t("pos.openTable")}</span>
        </>
      )}
    </Link>
  );
}
