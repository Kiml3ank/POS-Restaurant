import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveRefresh } from "@/components/live-refresh";
import { formatMoney } from "@/lib/money";
import { canAccessScreen } from "@/lib/rbac";
import { SALE_POINT_LABEL } from "@/lib/sale-point";
import {
  getOpenSalePointSessions,
  getSalePoints,
  type SalePointQueueEntry,
} from "@/lib/server/pos";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { OpenSalePointForm } from "../_components/table-actions";

/**
 * แถบคิวซื้อกลับ — ทางเข้าเดียวของบิลที่ไม่ได้อยู่บนโต๊ะ
 *
 * ── ทำไมต้องมีหน้านี้ ────────────────────────────────────────────────────
 * จุดขายที่ไม่ใช่โต๊ะนั่งถูกกรองออกจากผังโต๊ะโดยตั้งใจ (ผังโต๊ะตอบคำถาม
 * "โต๊ะไหนว่าง" ซึ่งเคาน์เตอร์ตอบไม่ได้) ถ้าไม่มีหน้านี้ **บิลซื้อกลับที่เปิดค้างอยู่
 * จะมองไม่เห็นจากหน้าจอไหนเลย** — ของถูกทำเสร็จวางรออยู่ แต่ไม่มีใครรู้ว่ามีบิลค้าง
 *
 * เรียงตามเลขคิว = ลำดับที่ลูกค้ามาถึงจริง ไม่ใช่เรียงตามเวลาที่เปิดล่าสุด
 * (คนที่รอนานที่สุดต้องอยู่บนสุดเสมอ เพราะเป็นคนที่กำลังจะถามว่า "ของผมถึงไหนแล้ว")
 */
export default async function PosCounterQueuePage() {
  const staff = await getCurrentStaff("pos");

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const currency = staff.branch.currency;
  const [queue, salePoints] = await Promise.all([
    getOpenSalePointSessions(staff.branchId),
    getSalePoints(staff.branchId),
  ]);

  const readyCount = queue.filter((entry) => entry.readyItems > 0).length;
  const total = queue.reduce((sum, entry) => sum + entry.runningTotal, 0);

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4 lg:gap-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="kicker kicker-accent">
            {readyCount > 0 ? `${readyCount} order(s) ready for pickup` : "Nothing waiting for pickup"}
          </p>
          <h1 className="display text-[28px] lg:text-[40px]">Takeaway</h1>
        </div>

        <div className="flex flex-wrap items-end gap-4 lg:gap-8">
          {/* รับ event เดียวกับผังโต๊ะและจอครัว — ครัวกด "เสร็จแล้ว" ที่จอครัว
              แล้วคิวตรงนี้ต้องขึ้นเองโดยแคชเชียร์ไม่ต้องกดโหลดใหม่ (บทที่ 8) */}
          <LiveRefresh src="/api/realtime" className="text-[var(--color-accent-700)]" />

          <div className="flex flex-col gap-1">
            <span className="kicker">Open bills</span>
            <span className="display text-[22px]">{queue.length}</span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="kicker">Total</span>
            <span className="display text-[22px]">{formatMoney(total, currency)}</span>
          </div>
        </div>
      </div>

      {/*
        ปุ่มเปิดบิลใหม่อยู่ "บนสุด" ไม่ใช่ล่างสุด เพราะเป็นสิ่งที่แคชเชียร์กดบ่อยที่สุด
        ในหน้านี้ — ลูกค้าเดินมาถึงเคาน์เตอร์แล้วต้องเริ่มรับออร์เดอร์ทันที
        ส่วนคิวที่รออยู่เป็นของที่ "เหลือบดู" ไม่ใช่ของที่ต้องกดทุกครั้ง
      */}
      <section className="panel flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="kicker kicker-accent">Take a new order</span>
          <p className="text-[var(--color-neutral-700)]">
            Open a new bill every time a new customer arrives — each one gets its own queue number
            and <strong>doesn&apos;t charge a service fee</strong>.
          </p>
        </div>

        {salePoints.length === 0 ? (
          <p className="alert">
            This branch has no takeaway sale points yet — add one from the back office.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {salePoints.map((point) => (
              <OpenSalePointForm
                key={point.id}
                tableId={point.id}
                label={
                  salePoints.length === 1
                    ? "Open a new takeaway bill"
                    : `Open new bill · ${point.name}`
                }
              />
            ))}
          </div>
        )}
      </section>

      {queue.length === 0 ? (
        <p className="panel p-6 text-[var(--color-neutral-700)]">
          No open takeaway bills — press the button above when a customer arrives.
        </p>
      ) : (
        <ul className="ink-grid ink-grid-sparse grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {queue.map((entry) => (
            <li key={entry.id}>
              <QueueCard entry={entry} currency={currency} timezone={staff.branch.timezone} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * การ์ดหนึ่งใบ = บิลซื้อกลับหนึ่งใบ
 *
 * ใช้ภาษาเดียวกับผังโต๊ะ (design "Modernist" มี accent สีเดียว): ใบที่ต้องรีบ
 * จัดการได้พื้น accent เต็ม ๆ ที่เหลือเป็นกระดาษเปล่า — ตาจับ "ใบที่ต่างจากพวก"
 * ได้เร็วกว่าจับเฉดสี
 *
 * ที่นี่ "ต้องรีบ" = **ของเสร็จแล้วแต่ลูกค้ายังไม่ได้รับ** ซึ่งต่างจากผังโต๊ะที่
 * แปลว่า "ต้องไปยกเสิร์ฟ" — ที่เคาน์เตอร์ไม่มีใครยกไปให้ ลูกค้ายืนรออยู่ตรงนั้น
 */
function QueueCard({
  entry,
  currency,
  timezone,
}: {
  entry: SalePointQueueEntry;
  currency: Parameters<typeof formatMoney>[1];
  timezone: string;
}) {
  const ready = entry.readyItems > 0;

  return (
    <Link
      href={`/pos/counter/${entry.id}`}
      className={`flex h-[148px] flex-col justify-between p-[18px] transition-colors ${
        ready
          ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-600)]"
          : "bg-[var(--color-bg)] hover:bg-[var(--color-accent-100)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="display text-[26px] leading-none">
          {entry.queueNumber ? `#${entry.queueNumber}` : "—"}
        </span>
        <span className={ready ? "tag tag-solid" : "tag tag-neutral"}>
          {SALE_POINT_LABEL[entry.table.kind]}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {entry.customerName ? (
          <span className="truncate text-[15px]">{entry.customerName}</span>
        ) : null}

        <span className={`text-xs ${ready ? "text-white/80" : "text-[var(--color-neutral-700)]"}`}>
          {ready
            ? `${entry.readyItems} item(s) ready`
            : entry.pendingItems > 0
              ? `Kitchen preparing ${entry.pendingItems} item(s)`
              : entry.draftCount > 0
                ? "Not sent to kitchen yet"
                : "No items yet"}
        </span>

        <span className="flex items-baseline justify-between gap-2">
          <span className={`kicker ${ready ? "text-white/80" : ""}`}>
            {formatTime(entry.openedAt, timezone)}
          </span>
          <span className="display text-[19px]">{formatMoney(entry.runningTotal, currency)}</span>
        </span>
      </div>
    </Link>
  );
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    value,
  );
}
