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
            {readyCount > 0 ? `มีของพร้อมให้ลูกค้ารับ ${readyCount} คิว` : "ไม่มีของค้างรอลูกค้ารับ"}
          </p>
          <h1 className="display text-[28px] lg:text-[40px]">ซื้อกลับ</h1>
        </div>

        <div className="flex flex-wrap items-end gap-4 lg:gap-8">
          {/* รับ event เดียวกับผังโต๊ะและจอครัว — ครัวกด "เสร็จแล้ว" ที่จอครัว
              แล้วคิวตรงนี้ต้องขึ้นเองโดยแคชเชียร์ไม่ต้องกดโหลดใหม่ (บทที่ 8) */}
          <LiveRefresh src="/api/realtime" className="text-[var(--color-accent-700)]" />

          <div className="flex flex-col gap-1">
            <span className="kicker">บิลที่เปิดอยู่</span>
            <span className="display text-[22px]">{queue.length} ใบ</span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="kicker">ยอดรวม</span>
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
          <span className="kicker kicker-accent">รับออร์เดอร์ใหม่</span>
          <p className="text-[var(--color-neutral-700)]">
            เปิดบิลใหม่ทุกครั้งที่ลูกค้าคนใหม่มาถึง — แต่ละใบได้เลขคิวของตัวเอง
            และ<strong>ไม่คิดเซอร์วิสชาร์จ</strong>
          </p>
        </div>

        {salePoints.length === 0 ? (
          <p className="alert">
            สาขานี้ยังไม่มีจุดขายสำหรับซื้อกลับ — เพิ่มได้ที่หน้าหลังร้าน
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {salePoints.map((point) => (
              <OpenSalePointForm
                key={point.id}
                tableId={point.id}
                label={
                  salePoints.length === 1
                    ? "เปิดบิลซื้อกลับใบใหม่"
                    : `เปิดบิลใหม่ · ${point.name}`
                }
              />
            ))}
          </div>
        )}
      </section>

      {queue.length === 0 ? (
        <p className="panel p-6 text-[var(--color-neutral-700)]">
          ยังไม่มีบิลซื้อกลับที่เปิดอยู่ — กดปุ่มด้านบนเมื่อลูกค้ามาถึง
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
          {entry.queueNumber ? `คิว ${entry.queueNumber}` : "—"}
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
            ? `พร้อมให้รับ ${entry.readyItems} ชิ้น`
            : entry.pendingItems > 0
              ? `ครัวกำลังทำ ${entry.pendingItems} ชิ้น`
              : entry.draftCount > 0
                ? "ยังไม่ได้ส่งเข้าครัว"
                : "ยังไม่มีรายการ"}
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
