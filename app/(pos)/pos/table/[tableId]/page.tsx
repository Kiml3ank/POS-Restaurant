import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { formatBaht } from "@/lib/money";
import { ORDER_ITEM_STATUS_LABEL, ORDER_STATUS_LABEL } from "@/lib/order-status";
import { canAccessScreen, canCancelOrderItem } from "@/lib/rbac";
import { getCustomerMenu } from "@/lib/server/menu";
import { getPosTable, type PosOrder } from "@/lib/server/pos";
import { getCurrentStaff } from "@/lib/server/staff-session";

import {
  CancelItemForm,
  CloseTableForm,
  OpenTableForm,
  PosLineControls,
  PosPlaceOrderForm,
} from "../../_components/table-actions";

/**
 * จอสั่งอาหารของโต๊ะหนึ่งโต๊ะ — จอหลักที่พนักงานอยู่กับมันทั้งกะ (บทที่ 9)
 *
 * **เมนูกับตะกร้าอยู่จอเดียวกัน** ตาม design "Cafe POS": เมนูกินพื้นที่ซ้าย
 * ตะกร้าปักขวาถาวร 412px คั่นด้วยเส้น 2px รอบแรกผมแยกเมนูไปเป็นอีก route
 * ซึ่งผิดจุดประสงค์ของจอ POS — คนสั่งพูดกับลูกค้าไปกดไป ต้องเห็นตะกร้าโตขึ้น
 * ทันทีที่กดโดยไม่มีการเปลี่ยนหน้าคั่น และไม่ต้องกดย้อนกลับมาดูว่าสั่งอะไรไปแล้ว
 *
 * ตะกร้าที่เห็นตรงนี้คือ "ใบเดียวกัน" กับที่ลูกค้ากดจากมือถือ เพราะทั้งคู่ผูกกับ
 * TableSession เดียวกัน — พนักงานจึงเห็นของที่ลูกค้ากำลังเลือกอยู่ด้วย
 *
 * สองมุมมองสลับกันที่ฝั่งซ้ายผ่าน `?view=` (ไม่ใช่ client state เพื่อให้ยังเป็น
 * Server Component ล้วนและกดได้ก่อน JS โหลดเสร็จ):
 *   - `menu` (ค่าเริ่มต้น) — หมวด + ตารางเมนู
 *   - `bills` — บิลที่ส่งเข้าครัวไปแล้ว + ปุ่มปิดรอบโต๊ะ
 */
export default async function PosTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ view?: string; cat?: string }>;
}) {
  const staff = await getCurrentStaff();

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const { tableId } = await params;
  const detail = await getPosTable(staff.branchId, tableId);

  if (!detail) {
    notFound();
  }

  const { table, session, orders, runningTotal } = detail;
  const cart = orders.find((order) => order.status === "DRAFT") ?? null;
  const sentOrders = orders.filter((order) => order.status !== "DRAFT");
  const cartItemCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  const { view, cat } = await searchParams;
  const onBills = view === "bills";

  // ดึงเมนูเฉพาะตอนที่โต๊ะเปิดอยู่จริง — โต๊ะว่างแสดงแค่ฟอร์มเปิดโต๊ะ ไม่ต้อง query
  const menu = session
    ? (await getCustomerMenu(staff.branchId)).filter((category) => category.items.length > 0)
    : [];
  const activeCategory = menu.find((category) => category.id === cat) ?? menu[0] ?? null;
  const base = `/pos/table/${table.id}`;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[58px] flex-none items-stretch border-b-2 border-[var(--color-text)]">
        <Link
          href="/pos"
          aria-label="กลับไปผังโต๊ะ"
          className="flex w-14 flex-none items-center justify-center border-r-2 border-[var(--color-text)] text-xl leading-none transition-colors hover:bg-[var(--color-accent-100)]"
        >
          ‹
        </Link>

        <div className="flex flex-none items-center border-r-2 border-[var(--color-text)] px-6">
          <span className="display text-[19px] whitespace-nowrap">โต๊ะ {table.name}</span>
        </div>

        <div className="flex flex-1 items-center justify-between gap-6 px-6">
          <span className="kicker truncate">
            {session
              ? `${session.pax} คน · เปิดเมื่อ ${formatTime(session.openedAt, staff.branch.timezone)}`
              : "ยังไม่ได้เปิดโต๊ะ"}
            {" · QR "}
            {table.tableCode}
          </span>

          {session ? (
            <span className="flex items-baseline gap-3 whitespace-nowrap">
              <span className="kicker">ยอดสะสม</span>
              <span className="display text-[24px]">{formatBaht(runningTotal)}</span>
            </span>
          ) : null}
        </div>
      </div>

      {!session ? (
        <div className="flex flex-1 items-start justify-center overflow-auto p-8">
          <section className="panel w-full max-w-md p-6">
            <p className="kicker kicker-accent mb-4">โต๊ะว่าง</p>
            <h2 className="display mb-6 text-[28px]">เปิดโต๊ะ {table.name}</h2>
            <OpenTableForm tableId={table.id} seats={table.seats} />
          </section>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex h-[58px] flex-none items-stretch border-b-2 border-[var(--color-text)]">
              <Link
                href={base}
                className={`display flex flex-none items-center border-r-2 border-[var(--color-text)] px-5 text-[15px] whitespace-nowrap transition-colors ${
                  onBills ? "hover:bg-[var(--color-accent-100)]" : "bg-[var(--color-text)] text-white"
                }`}
              >
                เมนู
              </Link>
              <Link
                href={`${base}?view=bills`}
                className={`display flex flex-none items-center gap-2 border-r-2 border-[var(--color-text)] px-5 text-[15px] whitespace-nowrap transition-colors ${
                  onBills ? "bg-[var(--color-text)] text-white" : "hover:bg-[var(--color-accent-100)]"
                }`}
              >
                บิลที่ส่งแล้ว
                <span className={onBills ? "tag tag-solid" : "tag tag-neutral"}>
                  {sentOrders.length}
                </span>
              </Link>

              {onBills ? (
                <div className="flex flex-1 items-center px-6">
                  <span className="kicker">ยกเลิกรายการและปิดรอบโต๊ะทำได้ที่นี่</span>
                </div>
              ) : (
                <>
                  {menu.map((category) => (
                    <Link
                      key={category.id}
                      href={`${base}?cat=${category.id}`}
                      className={`display flex flex-none items-center border-r-2 border-[var(--color-text)] px-5 text-[15px] whitespace-nowrap transition-colors ${
                        category.id === activeCategory?.id
                          ? "bg-[var(--color-accent)] text-white"
                          : "hover:bg-[var(--color-accent-100)]"
                      }`}
                    >
                      {category.name}
                    </Link>
                  ))}
                  <div className="flex flex-1 items-center justify-end px-6">
                    <span className="kicker whitespace-nowrap">
                      {activeCategory?.items.length ?? 0} เมนู
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-6">
              {onBills ? (
                <div className="flex flex-col gap-6">
                  {sentOrders.length === 0 ? (
                    <p className="panel p-6 text-[var(--color-neutral-700)]">
                      ยังไม่มีบิลที่ส่งเข้าครัว — เลือกเมนูจากแท็บ &ldquo;เมนู&rdquo;
                      แล้วกดส่งจากตะกร้าทางขวา
                    </p>
                  ) : (
                    sentOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        timezone={staff.branch.timezone}
                        canCancel={canCancelOrderItem(staff.role)}
                      />
                    ))
                  )}

                  <div className="max-w-md">
                    <CloseTableForm sessionId={session.id} />
                  </div>
                </div>
              ) : !activeCategory ? (
                <p className="text-[var(--color-neutral-700)]">
                  ยังไม่มีเมนูที่เปิดขายในสาขานี้ — เปิด/ปิดเมนูได้ในหน้าหลังร้าน (บทที่ 13)
                </p>
              ) : (
                <ul className="ink-grid grid-cols-2 xl:grid-cols-3">
                  {activeCategory.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`${base}/menu/${item.id}`}
                        className="flex h-[134px] flex-col justify-between bg-[var(--color-bg)] p-[18px] transition-colors hover:bg-[var(--color-accent-100)] active:bg-[var(--color-accent-200)]"
                      >
                        <span className="display text-[19px] leading-tight text-pretty">
                          {item.name}
                        </span>
                        <span className="flex w-full items-end justify-between gap-2">
                          <span className="kicker">{item.hasOptions ? "มีตัวเลือก" : ""}</span>
                          <span className="display text-[19px]">
                            {formatBaht(item.basePrice)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <aside className="flex w-[412px] flex-none flex-col border-l-2 border-[var(--color-text)] bg-[var(--color-neutral-100)]">
            <div className="flex flex-none items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-6 py-4">
              <div className="flex flex-col gap-0.5">
                <span className="display text-[20px]">ตะกร้า</span>
                <span className="kicker">ยังไม่ส่งเข้าครัว</span>
              </div>
              <span className="display text-[20px]">{cartItemCount} รายการ</span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {!cart || cart.items.length === 0 ? (
                <p className="px-6 py-12 leading-relaxed text-[var(--color-neutral-600)]">
                  ยังไม่มีรายการ แตะเมนูทางซ้ายเพื่อเริ่ม
                  หรือรอลูกค้ากดสั่งจากมือถือ — ทั้งสองทางลงตะกร้าใบเดียวกัน
                </p>
              ) : (
                cart.items.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-start gap-3 border-b border-[var(--color-neutral-300)] px-6 py-4"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="display text-[16px]">{line.nameSnapshot}</span>
                      {line.modifiers.length > 0 ? (
                        <span className="text-xs leading-snug text-[var(--color-neutral-700)]">
                          {line.modifiers.map((modifier) => modifier.nameSnapshot).join(" · ")}
                        </span>
                      ) : null}
                      {line.note ? (
                        <span className="text-xs text-[var(--color-accent-700)]">
                          หมายเหตุ: {line.note}
                        </span>
                      ) : null}
                    </div>

                    <PosLineControls
                      tableId={table.id}
                      orderItemId={line.id}
                      quantity={line.quantity}
                    />

                    <span className="display w-16 shrink-0 text-right text-[16px] leading-[38px]">
                      {formatBaht(line.lineTotal)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-none flex-col gap-2 border-t-2 border-[var(--color-text)] px-6 py-4">
              <div className="flex justify-between text-[var(--color-neutral-700)]">
                <span>ค่าอาหาร</span>
                <span>{formatBaht(cart?.subtotal ?? 0)}</span>
              </div>
              <p className="kicker">เซอร์วิสชาร์จและ VAT คิดตอนเก็บเงิน (บทที่ 10)</p>

              <div className="rule my-2" />

              <div className="flex items-baseline justify-between">
                <span className="kicker">รวมตะกร้านี้</span>
                <span className="display text-[34px]">{formatBaht(cart?.subtotal ?? 0)}</span>
              </div>

              <div className="mt-2">
                <PosPlaceOrderForm
                  tableId={table.id}
                  itemCount={cartItemCount}
                  label={
                    cartItemCount === 0
                      ? "ยังไม่มีรายการ"
                      : `ส่ง ${cartItemCount} รายการเข้าครัว`
                  }
                />
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function OrderCard({
  order,
  timezone,
  canCancel,
}: {
  order: PosOrder;
  timezone: string;
  canCancel: boolean;
}) {
  return (
    <article className="panel flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b-2 border-[var(--color-text)] px-5 py-3">
        <span className="display text-[17px]">#{order.orderNumber}</span>
        <span className="kicker">
          {order.placedAt ? formatTime(order.placedAt, timezone) : "—"} ·{" "}
          {ORDER_STATUS_LABEL[order.status]} ·{" "}
          {order.placedByStaff ? order.placedByStaff.name : "ลูกค้าสั่งเอง"}
        </span>
      </div>

      <ul className="flex flex-col">
        {order.items.map((line) => {
          const cancelled = line.status === "CANCELLED";

          return (
            <li
              key={line.id}
              className="flex items-start justify-between gap-4 border-b border-[var(--color-neutral-300)] px-5 py-3"
            >
              <div
                className={`flex min-w-0 flex-col gap-1 ${cancelled ? "text-[var(--color-neutral-500)]" : ""}`}
              >
                <span className={cancelled ? "line-through" : "display text-[16px]"}>
                  {line.quantity}× {line.nameSnapshot}
                </span>
                {line.modifiers.length > 0 ? (
                  <span className="text-xs text-[var(--color-neutral-700)]">
                    {line.modifiers.map((modifier) => modifier.nameSnapshot).join(" · ")}
                  </span>
                ) : null}
                {line.note ? (
                  <span className="text-xs text-[var(--color-accent-700)]">
                    หมายเหตุ: {line.note}
                  </span>
                ) : null}
                {cancelled && line.cancelReason ? (
                  <span className="text-xs text-[var(--color-accent-700)]">
                    ยกเลิก: {line.cancelReason}
                  </span>
                ) : null}
                {!cancelled && canCancel ? <CancelItemForm orderItemId={line.id} /> : null}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                <span className="tag tag-neutral">{ORDER_ITEM_STATUS_LABEL[line.status]}</span>
                <span
                  className={
                    cancelled
                      ? "text-[var(--color-neutral-500)] line-through"
                      : "display text-[16px]"
                  }
                >
                  {formatBaht(line.lineTotal)}
                </span>
                {line.station ? <span className="kicker">{line.station.name}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-baseline justify-between px-5 py-3">
        <span className="kicker">รวมบิลนี้</span>
        <span className="display text-[20px]">{formatBaht(order.subtotal)}</span>
      </div>
    </article>
  );
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("th-TH", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    value,
  );
}
