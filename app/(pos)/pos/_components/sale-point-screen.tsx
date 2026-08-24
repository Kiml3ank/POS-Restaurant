import Link from "next/link";

import { LiveRefresh } from "@/components/live-refresh";
import type { Currency } from "@/lib/generated/prisma/enums";
import { formatMoney } from "@/lib/money";
import { ORDER_ITEM_STATUS_LABEL, ORDER_STATUS_LABEL } from "@/lib/order-status";
import { canCancelOrderItem, canServeOrderItem } from "@/lib/rbac";
import { showsInTableMap } from "@/lib/sale-point";
import { getCustomerMenu } from "@/lib/server/menu";
import { type PosOrder, type PosTableDetail } from "@/lib/server/pos";
import type { CurrentStaff } from "@/lib/server/staff-session";

import { CartPanel } from "./cart-panel";
import {
  CancelItemForm,
  CloseTableForm,
  OpenTableForm,
  PosLineControls,
  PosPlaceOrderForm,
  ServeItemForm,
} from "./table-actions";

/**
 * จอสั่งอาหารของ "จุดขายหนึ่งจุด" — จอหลักที่พนักงานอยู่กับมันทั้งกะ (บทที่ 9)
 *
 * ── ทำไมเป็น component ไม่ใช่ page ──────────────────────────────────────
 * จอนี้ใช้ร่วมกันสองเส้นทาง และ **ต้องเป็นโค้ดชุดเดียวกันจริง ๆ** ไม่ใช่ก๊อปสองไฟล์:
 *   - `/pos/table/[tableId]`      — โต๊ะนั่ง (หารอบจากโต๊ะ)
 *   - `/pos/counter/[sessionId]`  — ซื้อกลับ (ระบุรอบมาตรง ๆ เพราะมีหลายบิลพร้อมกัน)
 *
 * ต่างกันแค่ **ที่อยู่ของลิงก์ (`base`) กับข้อความบนหัวจอ** ตรรกะทั้งหมด
 * เหมือนกันเป๊ะ ถ้าแยกเป็นสองไฟล์ วันหนึ่งจะมีที่หนึ่งที่ลืมแก้ แล้วซื้อกลับกับ
 * นั่งที่ร้านจะเริ่มทำงานไม่เหมือนกันโดยไม่มีใครตั้งใจ
 * (ท่าเดียวกับ `components/receipt-document.tsx` ในบทที่ 12)
 *
 * `sessionId` ที่ส่งเข้าไปในทุกฟอร์มคือสิ่งที่ทำให้ action รู้ว่าบิลไหน —
 * โต๊ะนั่งส่ง undefined ได้เพราะมีรอบเปิดทีละรอบ (ดู resolveOpenTarget ใน actions.ts)
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
export async function SalePointScreen({
  staff,
  detail,
  base,
  backHref,
  heading,
  subtitle,
  view,
  cat,
}: {
  staff: CurrentStaff;
  detail: PosTableDetail;
  /** ที่อยู่ตั้งต้นของทุกลิงก์ในจอนี้ เช่น `/pos/table/xxx` หรือ `/pos/counter/yyy` */
  base: string;
  /** ปุ่ม ‹ มุมซ้ายบนกลับไปไหน — ผังโต๊ะ หรือแถบคิวซื้อกลับ */
  backHref: string;
  /** ข้อความบนหัวจอ เช่น "โต๊ะ A1" หรือ "ซื้อกลับ · คิว 12" */
  heading: string;
  /** บรรทัดอ้างอิงเล็ก ๆ ที่ตัดทิ้งบนจอแคบ (จำนวนคน/เวลาเปิด/รหัส QR) */
  subtitle: string;
  view?: string;
  cat?: string;
}) {
  const currency = staff.branch.currency;
  const { table, session, orders, runningTotal } = detail;
  const cart = orders.find((order) => order.status === "DRAFT") ?? null;
  const sentOrders = orders.filter((order) => order.status !== "DRAFT");
  const cartItemCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  const onBills = view === "bills";

  /**
   * ฟอร์มทุกใบต้องบอก action ว่าเป็นบิลใบไหน — ยกเว้นโต๊ะนั่งที่มีรอบเปิดทีละรอบ
   * ส่งไปก็ไม่ผิด แต่ส่ง undefined ไว้เพื่อให้เส้นทางเดิมของบทที่ 9 ไม่เปลี่ยนพฤติกรรมเลย
   */
  const sessionId = session && !showsInTableMap(table.kind) ? session.id : undefined;

  // ดึงเมนูเฉพาะตอนที่โต๊ะเปิดอยู่จริง — โต๊ะว่างแสดงแค่ฟอร์มเปิดโต๊ะ ไม่ต้อง query
  const menu = session
    ? (await getCustomerMenu(staff.branchId)).filter((category) => category.items.length > 0)
    : [];
  const activeCategory = menu.find((category) => category.id === cat) ?? menu[0] ?? null;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[58px] flex-none items-stretch border-b-2 border-[var(--color-text)]">
        <Link
          href={backHref}
          aria-label="กลับ"
          className="flex w-14 flex-none items-center justify-center border-r-2 border-[var(--color-text)] text-xl leading-none transition-colors hover:bg-[var(--color-accent-100)]"
        >
          ‹
        </Link>

        <div className="flex flex-none items-center border-r-2 border-[var(--color-text)] px-4 lg:px-6">
          <span className="display text-[19px] whitespace-nowrap">{heading}</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 lg:gap-6 lg:px-6">
          {/*
            จำนวนคน/เวลาเปิด/รหัส QR เป็นข้อมูลอ้างอิงที่ดูนาน ๆ ครั้ง ไม่ใช่ของที่
            ต้องเห็นตลอด — จอแคบตัดทิ้งเพื่อให้ "ยอดสะสม" กับไฟสถานะ realtime
            ซึ่งเป็นสองอย่างที่พนักงานเหลือบมองทุกนาที ไม่ถูกเบียดจนหาย
          */}
          <span className="kicker hidden truncate lg:inline">{subtitle}</span>

          <span className="ml-auto flex items-center gap-3 whitespace-nowrap lg:gap-6">
            {/*
              จอนี้ต้อง realtime มากกว่าทุกจอในระบบ (บทที่ 8) เพราะเป็นจอเดียวที่
              "สองคนแก้ของชิ้นเดียวกันพร้อมกัน" ได้จริง: ลูกค้ากดใส่ตะกร้าจากมือถือ
              ขณะที่พนักงานยืนถือเครื่องอยู่ที่โต๊ะเดียวกัน — ตะกร้าเป็นใบเดียวกัน
              ถ้าจอไม่อัปเดตเอง พนักงานจะกดสั่งซ้ำของที่ลูกค้าเพิ่งใส่ไปเอง
            */}
            <LiveRefresh src="/api/realtime" className="text-[var(--color-accent-700)]" />

            {session ? (
              <span className="flex items-baseline gap-2 lg:gap-3">
                {/* ป้าย "ยอดสะสม" ตัดทิ้งบนจอแคบ — ตัวเลขที่มีสัญลักษณ์เงินนำหน้า
                    อยู่ตรงมุมนี้ อ่านออกอยู่แล้วว่าคือยอดของโต๊ะ ไม่ต้องมีป้ายบอก */}
                <span className="kicker hidden sm:inline">ยอดสะสม</span>
                <span className="display text-[18px] lg:text-[24px]">
                  {formatMoney(runningTotal, currency)}
                </span>
              </span>
            ) : null}
          </span>
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
        /* จอแคบวางตะกร้าไว้ใต้เมนูเป็นแถบสรุป · จอกว้างวางไว้ขวาแบบ design เดิม */
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* แถบหมวดเมนูเลื่อนแนวนอนได้เมื่อหมวดเยอะเกินความกว้างจอ
                (ร้านที่มี 12 หมวดบนแท็บเล็ตแนวตั้งคือเคสปกติ ไม่ใช่เคสสุดโต่ง) */}
            <div className="flex h-[58px] flex-none items-stretch overflow-x-auto border-b-2 border-[var(--color-text)]">
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

              {/*
                ทางเข้าหน้าคิดเงิน/รับชำระ (บทที่ 10-11) — โผล่เฉพาะตอนมีของให้คิดเงินจริง
                ไม่ใช่ปุ่มที่อยู่ตลอดเวลาแล้วกดไปเจอหน้าเปล่า

                เป็น accent เต็มใบเพราะเป็นปลายทางของทั้งรอบโต๊ะ และเป็นปุ่มที่
                พนักงานหาอยู่ตอนลูกค้าเรียก "เช็คบิล" ซึ่งเป็นจังหวะที่รีบที่สุดของกะ
              */}
              {sentOrders.length > 0 ? (
                <Link
                  href={`${base}/bill`}
                  className="display flex flex-none items-center border-r-2 border-[var(--color-text)] bg-[var(--color-accent)] px-5 text-[15px] whitespace-nowrap text-white transition-colors hover:bg-[var(--color-accent-600)]"
                >
                  คิดเงิน
                </Link>
              ) : null}

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
                        canServe={canServeOrderItem(staff.role)}
                        currency={currency}
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
                <ul className="ink-grid ink-grid-sparse grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
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
                            {formatMoney(item.basePrice, currency)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <CartPanel itemCount={cartItemCount} totalLabel={formatMoney(cart?.subtotal ?? 0, currency)}>
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
                      sessionId={sessionId}
                      orderItemId={line.id}
                      quantity={line.quantity}
                    />

                    <span className="display w-16 shrink-0 text-right text-[16px] leading-[38px]">
                      {formatMoney(line.lineTotal, currency)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-none flex-col gap-2 border-t-2 border-[var(--color-text)] px-6 py-4">
              <div className="flex justify-between text-[var(--color-neutral-700)]">
                <span>ค่าอาหาร</span>
                <span>{formatMoney(cart?.subtotal ?? 0, currency)}</span>
              </div>
              <p className="kicker">เซอร์วิสชาร์จและ VAT คิดตอนเก็บเงิน (บทที่ 10)</p>

              <div className="rule my-2" />

              <div className="flex items-baseline justify-between">
                <span className="kicker">รวมตะกร้านี้</span>
                <span className="display text-[34px]">{formatMoney(cart?.subtotal ?? 0, currency)}</span>
              </div>

              <div className="mt-2">
                <PosPlaceOrderForm
                  tableId={table.id}
                  sessionId={sessionId}
                  itemCount={cartItemCount}
                  label={
                    cartItemCount === 0
                      ? "ยังไม่มีรายการ"
                      : `ส่ง ${cartItemCount} รายการเข้าครัว`
                  }
                />
              </div>
            </div>
          </CartPanel>
        </div>
      )}
    </main>
  );
}

function OrderCard({
  order,
  timezone,
  canCancel,
  canServe,
  currency,
}: {
  order: PosOrder;
  timezone: string;
  canCancel: boolean;
  canServe: boolean;
  currency: Currency;
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
                  {formatMoney(line.lineTotal, currency)}
                </span>
                {line.station ? (
                  <span className="kicker">{line.station.name}</span>
                ) : (
                  // ของที่ไม่ผูกสถานี = หยิบจากตู้เย็นหน้าร้าน ไม่เคยขึ้นจอครัว
                  // (ดู lib/server/cart.ts ตอน placeOrder) จึงบอกไว้ตรงนี้ให้ชัด
                  // ว่าไม่ต้องรอครัว
                  <span className="kicker">หยิบเอง</span>
                )}

                {/* ปุ่มเสิร์ฟอยู่ทั้งที่นี่และบนจอครัว — ที่นี่คือทางเดียวที่ปิด
                    รายการซึ่งไม่ผ่านครัวได้ (บทที่ 8) */}
                {line.status === "READY" && canServe ? (
                  <ServeItemForm orderItemId={line.id} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-baseline justify-between px-5 py-3">
        <span className="kicker">รวมบิลนี้</span>
        <span className="display text-[20px]">{formatMoney(order.subtotal, currency)}</span>
      </div>
    </article>
  );
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("th-TH", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    value,
  );
}
