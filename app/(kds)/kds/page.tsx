import Link from "next/link";
import { redirect } from "next/navigation";

import { ORDER_ITEM_STATUS_LABEL, isKitchenActionable } from "@/lib/order-status";
import { canAccessScreen, canCookOrderItem, canServeOrderItem } from "@/lib/rbac";
import { getKitchenStations, getKitchenTickets, type KitchenTicket } from "@/lib/server/kds";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { Elapsed, LATE_AFTER_MINUTES } from "./_components/elapsed";
import { AdvanceItemButton, BumpTicketButton, ServeItemButton } from "./_components/ticket-actions";

/**
 * จอครัว KDS (บทที่ 8)
 *
 * realtime ใช้ SSE ผ่าน Route Handler เท่านั้น — ไฟ "สดอยู่" และตัวรับ event
 * อยู่ที่ layout ของ route group นี้ (app/(kds)/layout.tsx) ไม่ใช่ที่หน้านี้
 * เพื่อไม่ให้สายถูกตัดแล้วต่อใหม่ทุกครั้งที่ครัวสลับแท็บสถานี
 *
 * ── สิ่งที่ครัวต้องอ่านออกจากระยะสองเมตรภายในหนึ่งวินาที ────────────────
 *   1. ใบไหนเข้ามาก่อน (คิวคือ FIFO ตามเวลาที่กดส่ง)
 *   2. ใบไหนรอนานเกินไปแล้ว
 *   3. ในใบนั้นต้องทำอะไร กี่ที่
 * ทุกอย่างที่ไม่ตอบสามคำถามนี้ถูกตัดออกจากจอ — ราคา ยอดรวม ชื่อพนักงาน
 * ไม่มีบนจอครัวเลยแม้แต่ตัวเดียว เพราะครัวไม่ได้ตัดสินใจอะไรจากตัวเลขพวกนั้น
 *
 * แท็บสถานีเป็น <Link> ที่เปลี่ยน `?station=` ไม่ใช่ state ฝั่ง client
 * — ครัวร้อนกับบาร์น้ำเปิดคนละจอ แล้ว bookmark URL ของสถานีตัวเองไว้ได้เลย
 */
export default async function KdsPage({
  searchParams,
}: {
  searchParams: Promise<{ station?: string }>;
}) {
  const staff = await getCurrentStaff("kds");

  if (!staff || !canAccessScreen(staff.role, "kds")) {
    redirect("/kds/login");
  }

  const { station } = await searchParams;
  const stations = await getKitchenStations(staff.branchId);

  // station ที่ส่งมาทาง URL ต้องเป็นของสาขานี้จริง ไม่งั้นถือว่าเลือก "ทุกสถานี"
  // (ยิง ?station=<id ของสาขาอื่น> เข้ามาแล้วต้องไม่ได้อะไรเลย ไม่ใช่ error)
  const activeStation = stations.find((item) => item.id === station) ?? null;

  const tickets = await getKitchenTickets(staff.branchId, { stationId: activeStation?.id ?? null });
  const canCook = canCookOrderItem(staff.role);
  const canServe = canServeOrderItem(staff.role);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <nav
        aria-label="สถานีครัว"
        className="ink-row flex-none overflow-x-auto border-x-0 border-t-0"
      >
        <StationTab
          href="/kds"
          label="ทุกสถานี"
          count={stations.reduce((sum, item) => sum + item.queued + item.cooking, 0)}
          active={activeStation === null}
        />

        {stations.map((item) => (
          <StationTab
            key={item.id}
            href={`/kds?station=${item.id}`}
            label={item.name}
            count={item.queued + item.cooking}
            active={activeStation?.id === item.id}
          />
        ))}
      </nav>

      {tickets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
          <p className="display text-[32px]">ไม่มีออร์เดอร์ค้าง</p>
          <p className="text-[var(--color-neutral-700)]">
            {activeStation
              ? `${activeStation.name} เคลียร์หมดแล้ว`
              : "ทุกสถานีเคลียร์หมดแล้ว"}{" "}
            · ออร์เดอร์ใหม่จะขึ้นเองไม่ต้องกดโหลด
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3 lg:p-5">
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:gap-5 xl:grid-cols-3 2xl:grid-cols-4">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <TicketCard
                  ticket={ticket}
                  stationId={activeStation?.id ?? null}
                  showStationName={activeStation === null}
                  canCook={canCook}
                  canServe={canServe}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

function StationTab({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-w-[128px] flex-1 items-center justify-between gap-3 px-4 py-3 whitespace-nowrap lg:min-w-[168px] lg:px-5 lg:py-4 ${
        active ? "is-active" : "hover:bg-[var(--color-accent-100)]"
      }`}
    >
      <span className="display text-[16px]">{label}</span>
      {/* จำนวนงานค้าง = ตัวเลขเดียวที่ครัวใช้ตัดสินใจว่าจะไปช่วยสถานีไหนต่อ */}
      <span className="display text-[20px] tabular-nums">{count}</span>
    </Link>
  );
}

/**
 * ใบสั่งหนึ่งใบ = หนึ่ง Order ที่ยังมีของของสถานีนี้ค้างอยู่
 *
 * ใบที่ครัวทำเสร็จครบแล้ว (รอพนักงานมายก) ยังอยู่บนจอโดยตั้งใจ แต่ถูกลดความเข้ม
 * ลง — ครัวต้องเห็นว่ามีของวางรออยู่ที่ช่องรับอาหารกี่ใบ ถ้าใบหายไปทันทีที่กด
 * "ทำเสร็จ" ของจะกองอยู่ที่ช่องโดยไม่มีใครในครัวรู้ว่ามันยังไม่ถูกยก
 */
function TicketCard({
  ticket,
  stationId,
  showStationName,
  canCook,
  canServe,
}: {
  ticket: KitchenTicket;
  stationId: string | null;
  showStationName: boolean;
  canCook: boolean;
  canServe: boolean;
}) {
  const queuedAt = ticket.queuedAt.getTime();
  // นาทีที่รอมาแล้วคำนวณที่ lib/server/kds.ts (นาฬิกาเดียวกันทั้งจอ) แล้วให้
  // <Elapsed> เดินต่อเองฝั่ง client — component นี้จึงบริสุทธิ์ ไม่แตะเวลาเลย
  const minutes = ticket.waitedMinutes;
  const isLate = minutes >= LATE_AFTER_MINUTES && !ticket.allReady;

  // ยังมีของที่ครัวต้องลงมือ = ใบนี้ยังบั๊มได้
  const pending = ticket.items.filter(
    (item) => item.status === "PLACED" || item.status === "IN_PROGRESS",
  );
  const allPlaced = pending.length > 0 && pending.every((item) => item.status === "PLACED");

  return (
    <article
      className={`panel flex h-full flex-col ${
        isLate ? "border-[var(--color-accent)]" : ""
      } ${ticket.allReady ? "opacity-60" : ""}`}
    >
      <header
        className={`flex flex-none items-baseline justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 ${
          isLate ? "bg-[var(--color-accent-100)]" : ""
        }`}
      >
        <div className="flex min-w-0 flex-col">
          <span className="display truncate text-[22px]">
            {ticket.table?.name ?? "กลับบ้าน"}
          </span>
          <span className="kicker truncate">#{ticket.orderNumber}</span>
        </div>

        <div className="flex flex-none flex-col items-end">
          <span className="display text-[16px] tabular-nums">
            <Elapsed since={queuedAt} initialMinutes={minutes} />
          </span>
          <span className="kicker">
            {ticket.channel === "CUSTOMER_QR" ? "ลูกค้าสั่งเอง" : "พนักงานสั่ง"}
          </span>
        </div>
      </header>

      {ticket.note ? (
        <p className="flex-none border-b-2 border-[var(--color-text)] bg-[var(--color-accent-100)] px-4 py-2 text-[14px] text-[var(--color-accent-800)]">
          หมายเหตุทั้งบิล: {ticket.note}
        </p>
      ) : null}

      <ul className="flex flex-1 flex-col">
        {ticket.items.map((item) => (
          <li
            key={item.id}
            className="flex items-start justify-between gap-3 border-b border-[var(--color-neutral-300)] px-4 py-3 last:border-b-0"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="display text-[18px] leading-snug">
                {/* จำนวนมาก่อนชื่อเสมอ — ครัวอ่าน "สามที่" ก่อนอ่านว่าของอะไร */}
                <span className="text-[var(--color-accent)]">{item.quantity}×</span>{" "}
                {item.nameSnapshot}
              </span>

              {item.modifiers.length > 0 ? (
                <span className="text-[14px] text-[var(--color-neutral-700)]">
                  {item.modifiers.map((modifier) => modifier.nameSnapshot).join(" · ")}
                </span>
              ) : null}

              {item.note ? (
                <span className="text-[14px] text-[var(--color-accent-700)]">! {item.note}</span>
              ) : null}

              <span className="kicker">
                {ORDER_ITEM_STATUS_LABEL[item.status]}
                {showStationName && item.station ? ` · ${item.station.name}` : ""}
              </span>
            </div>

            <div className="flex flex-none flex-col items-end gap-2">
              {isKitchenActionable(item.status) && canCook ? (
                <AdvanceItemButton orderItemId={item.id} status={item.status} />
              ) : null}

              {item.status === "READY" && canServe ? (
                <ServeItemButton orderItemId={item.id} />
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {pending.length > 0 && canCook ? (
        <footer className="flex-none border-t-2 border-[var(--color-text)] p-3">
          <BumpTicketButton
            orderId={ticket.id}
            stationId={stationId}
            label={
              allPlaced
                ? `รับทั้งใบ (${pending.length} รายการ)`
                : `ทำเสร็จทั้งใบ (${pending.length} รายการ)`
            }
          />
        </footer>
      ) : null}
    </article>
  );
}
