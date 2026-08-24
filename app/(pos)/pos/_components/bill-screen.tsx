import Link from "next/link";

import { LiveRefresh } from "@/components/live-refresh";
import { formatBp } from "@/lib/bill";
import { formatMoney } from "@/lib/money";
import { ORDER_ITEM_STATUS_LABEL } from "@/lib/order-status";
import { PAYMENT_METHOD_LABEL } from "@/lib/payment-method";
import { canSetStaffMeal, canTakePayment } from "@/lib/rbac";
import { salePointDisplayName } from "@/lib/sale-point";
import type { TableBill } from "@/lib/server/billing";
import type { PaymentReceipt } from "@/lib/server/payment";
import { prisma } from "@/lib/server/db";
import type { CurrentStaff } from "@/lib/server/staff-session";

import { PaymentPanel } from "./payment-panel";
import { StaffMealPanel } from "./staff-meal-panel";

/**
 * หน้าคิดเงินและรับเงินของโต๊ะ (บทที่ 10 คิด · บทที่ 11 รับ)
 *
 * ── หน้าเดียว สองโหมด ───────────────────────────────────────────────────
 * ไม่มี `?paid` = บิลที่ยังไม่ปิด (อ่านยอด + รับเงิน)
 * มี `?paid=<id>` = สรุปการรับเงินที่เพิ่งเกิดขึ้น (อ่านจาก snapshot ล้วน)
 *
 * ต้องเป็นหน้าเดียวกันเพราะพอปิดบิลแล้ว **รอบโต๊ะถูกปิดไปด้วย** หน้าคิดเงิน
 * ปกติจะไม่มีอะไรให้แสดงอีกเลย (getTableBill คืน session = null) ถ้าไม่มีโหมด
 * ที่สอง แคชเชียร์จะกดยืนยันแล้วเจอหน้า "โต๊ะนี้ยังไม่ได้เปิด" ซึ่งอ่านแล้ว
 * เหมือนระบบพัง ทั้งที่เพิ่งรับเงินสำเร็จ — และจะไม่มีที่ให้ดูเงินทอนด้วย
 *
 * ── ⚠ การรับเงินในก้อนนี้เป็นโหมดสาธิต ─────────────────────────────────
 * ไม่ได้ต่อกับ payment gateway จริง แคชเชียร์กดยืนยันเองว่าได้รับเงินแล้ว
 * (ดูรายละเอียดและสิ่งที่ต้องแก้วันที่ต่อของจริงใน lib/server/payment.ts)
 *
 * ── ทำไมต้องแยกเป็นหน้าใหม่ ทั้งที่ CLAUDE.md ห้ามแยกเมนูกับตะกร้า ──────
 * กฎข้อนั้นคุมจังหวะ "รับออร์เดอร์" ซึ่งพนักงานคุยกับลูกค้าไปกดไป จอเปลี่ยน
 * ไม่ได้ · การคิดเงินเป็นจังหวะคนละแบบ: หยุดคุย ยืนอ่านตัวเลขด้วยกันกับลูกค้า
 * แล้วจอควรมีแต่ตัวเลขบิล ไม่มีเมนูให้กดพลาด — เป็นคนละงานจึงเป็นคนละหน้า
 */
export async function BillScreen({
  staff,
  detail,
  base,
  heading,
  sessionId,
}: {
  staff: CurrentStaff;
  detail: TableBill;
  /** ที่อยู่ของจอสั่งอาหารที่บิลนี้สังกัด — ปุ่ม ‹ และปุ่ม "ยังไม่รับเงิน" กลับไปที่นี่ */
  base: string;
  /** ข้อความบนหัวจอ เช่น "คิดเงิน · โต๊ะ A1" หรือ "คิดเงิน · ซื้อกลับ คิว 12" */
  heading: string;
  /** บิลใบไหน — จำเป็นเฉพาะจุดขายที่มีหลายบิลเปิดพร้อมกัน (เคาน์เตอร์ซื้อกลับ) */
  sessionId?: string;
}) {
  const { table, session, lines, bill, discountBp, unservedCount, isEmpty } = detail;
  const currency = detail.branch.currency;

  /**
   * รายชื่อพนักงานสำหรับช่อง "ใครกิน" (บทที่ 13)
   *
   * เฉพาะคนที่ยัง active ในสาขานี้ — คนที่ลาออกแล้วต้องไม่โผล่ในลิสต์
   * (server ตรวจซ้ำอีกชั้นใน setStaffMeal() การกรองตรงนี้เป็นแค่เรื่องหน้าจอ)
   */
  const staffOptions = session
    ? await prisma.staff.findMany({
        where: { branchId: staff.branchId, isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, name: true, code: true },
      })
    : [];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[58px] flex-none items-stretch border-b-2 border-[var(--color-text)]">
        <Link
          href={base}
          aria-label="ย้อนกลับ"
          className="flex w-14 flex-none items-center justify-center border-r-2 border-[var(--color-text)] text-xl leading-none transition-colors hover:bg-[var(--color-accent-100)]"
        >
          ‹
        </Link>

        <div className="flex flex-none items-center border-r-2 border-[var(--color-text)] px-4 lg:px-6">
          <span className="display text-[19px] whitespace-nowrap">{heading}</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 px-4 lg:px-6">
          {/* ยอดเปลี่ยนได้ระหว่างที่ยืนอ่านอยู่ ถ้าลูกค้ากดสั่งเพิ่มจากมือถือ (บทที่ 8) */}
          <LiveRefresh src="/api/realtime" className="text-[var(--color-accent-700)]" />
        </div>
      </div>

      {!session ? (
        <EmptyState
          title="โต๊ะนี้ยังไม่ได้เปิด"
          detail="ไม่มีรอบโต๊ะที่เปิดอยู่ จึงยังไม่มีอะไรให้คิดเงิน"
          href={base}
        />
      ) : isEmpty ? (
        <EmptyState
          title="ยังไม่มีรายการในบิล"
          detail="โต๊ะเปิดอยู่แต่ยังไม่ได้ส่งอะไรเข้าครัว"
          href={base}
        />
      ) : (
        /*
          จอกว้าง: สองแพเนลเลื่อนแยกกัน (ยอดรวมต้องอยู่กับที่ตลอดเวลา)
          จอแคบ: เลื่อนเป็นหน้าเดียวยาว ๆ — ถ้าแบ่งเป็นสองกล่องที่เลื่อนแยกกัน
          บนจอสูง 800px ตารางรายการจะเหลือพื้นที่แค่ประมาณหนึ่งบรรทัดครึ่ง
          แล้วพนักงานต้องเลื่อนในกล่องจิ๋ว ๆ เพื่ออ่านบิลให้ลูกค้าฟัง
        */
        <div className="flex min-h-0 flex-1 flex-col overflow-auto xl:flex-row xl:overflow-hidden">
          {/* ── ซ้าย: รายการทั้งหมดในรอบโต๊ะนี้ ───────────────────────── */}
          <section className="flex min-w-0 flex-none flex-col xl:min-h-0 xl:flex-1">
            <div className="p-4 lg:p-6 xl:min-h-0 xl:flex-1 xl:overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>รายการ</th>
                    <th className="w-16 text-right sm:w-20">จำนวน</th>
                    {/* จอแคบตัดคอลัมน์นี้ทิ้งแล้วไปแสดงใต้ชื่อเมนูแทน — สี่คอลัมน์
                        ที่ 390px ทำให้ชื่อเมนูแตกเป็นสามบรรทัดจนอ่านยากกว่าเดิม */}
                    <th className="hidden w-32 text-right sm:table-cell">ราคา/หน่วย</th>
                    <th className="w-28 text-right sm:w-32">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <span className="display text-[15px]">{line.name}</span>
                        {line.modifiers.length > 0 ? (
                          <span className="block text-xs text-[var(--color-neutral-700)]">
                            {line.modifiers.join(" · ")}
                          </span>
                        ) : null}
                        {line.note ? (
                          <span className="block text-xs text-[var(--color-accent-700)]">
                            หมายเหตุ: {line.note}
                          </span>
                        ) : null}
                        {/* ต้องเป็น block — บรรทัดที่ไม่มีตัวเลือก/หมายเหตุมาคั่น
                            จะมีเลขบิลไปต่อท้ายชื่อเมนูในบรรทัดเดียวกัน อ่านเป็น
                            "น้ำเปล่า#20260822-0003" ซึ่งดูเหมือนชื่อเมนูเพี้ยน */}
                        <span className="kicker block">
                          #{line.orderNumber} · {ORDER_ITEM_STATUS_LABEL[line.status]}
                        </span>
                        {/* ราคา/หน่วยของจอแคบ ที่ตัดคอลัมน์ทิ้งไป */}
                        <span className="block text-xs text-[var(--color-neutral-700)] sm:hidden">
                          หน่วยละ {formatMoney(line.unitPrice, currency)}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{line.quantity}</td>
                      <td className="hidden text-right tabular-nums sm:table-cell">
                        {formatMoney(line.unitPrice, currency)}
                      </td>
                      <td className="display text-right tabular-nums">
                        {formatMoney(line.lineTotal, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/*
                ── สรุปยอดอยู่ใต้รายการอาหาร ไม่ใช่ในแพเนลขวา ────────────────
                นี่คือลำดับที่บิลกระดาษใช้อยู่แล้ว: รายการ → ยอดย่อย → ภาษี
                และมันแก้ปัญหาพื้นที่พร้อมกัน — คอลัมน์ซ้ายว่างเกือบทั้งจอ ส่วนแพเนลขวา
                ต้องยัด ยอดรวม + วิธีจ่าย + ช่องรับเงิน + ปุ่มลัด + เงินทอน + ปุ่มยืนยัน
                จนเหลือที่ให้รายละเอียดแค่บรรทัดเดียว (ผู้ใช้รายงานว่าอ่านไม่ได้)

                แพเนลขวาจึงเหลือเฉพาะสิ่งที่ต้องเห็นตลอดเวลาตอนรับเงิน:
                คำเตือน · ยอดรวม · แผงรับเงิน

                จำกัดความกว้างไว้ เพราะแถว "ป้าย ... จำนวนเงิน" ที่กว้าง 900px
                ทำให้สายตาลากจากป้ายไปหาตัวเลขไม่ถึง
              */}
              <div className="mt-6 flex max-w-[520px] flex-col gap-3">
                <Row label="ค่าอาหาร" value={formatMoney(bill.subtotal, currency)} />

                {bill.discountAmount > 0 ? (
                  <Row
                    label={
                      session?.staffCustomer
                        ? `ส่วนลดพนักงาน · ${session.staffCustomer.name} ${formatBp(discountBp)}`
                        : "ส่วนลด"
                    }
                    value={`-${formatMoney(bill.discountAmount, currency)}`}
                    accent
                  />
                ) : null}

                {bill.serviceChargeBp > 0 ? (
                  <Row
                    label={`เซอร์วิสชาร์จ ${formatBp(bill.serviceChargeBp)}`}
                    value={formatMoney(bill.serviceChargeAmount, currency)}
                  />
                ) : null}

                <div className="rule my-1" />

                {/*
                ข้อความ VAT ต่างกันตามว่าราคารวม VAT แล้วหรือยัง
                ไม่ใช่แค่ถ้อยคำ — ตัวเลขที่ได้มาจากคนละสูตร (ดู lib/bill.ts)
                และบรรทัดนี้คือสิ่งที่ต้องตรงกับใบกำกับภาษีในบทที่ 12
              */}
                {bill.pricesIncludeVat ? (
                  <>
                    <Row
                      label="มูลค่าสินค้า (ก่อน VAT)"
                      value={formatMoney(bill.netAmount, currency)}
                      muted
                    />
                    <Row
                      label={`VAT ${formatBp(bill.vatRateBp)} (รวมในราคาแล้ว)`}
                      value={formatMoney(bill.vatAmount, currency)}
                      muted
                    />
                  </>
                ) : (
                  <Row
                    label={`VAT ${formatBp(bill.vatRateBp)}`}
                    value={formatMoney(bill.vatAmount, currency)}
                  />
                )}

                {/*
                ── แผงติดธงพนักงานอยู่ท้ายสรุปยอด ในคอลัมน์ซ้าย ────────────────
                ห้ามย้ายกลับไปแพเนลขวา: รอบแรกวางไว้เหนือปุ่มรับเงินซึ่งเป็นโซน
                `flex-none` ผลคือโซนยอดเงินถูกบีบจาก 336px เหลือ 148px แล้ว
                **"รวมทั้งสิ้น" หลุดออกนอกจอ** ที่จอเตี้ยกว่า 900px

                **กฎ: อะไรที่เพิ่มเข้าไปในโซน `flex-none` ของแพเนลที่มีโซน
                `overflow-auto` อยู่ด้วย จะไปกินพื้นที่ของโซนนั้นเสมอ**

                เส้นคั่นด้านล่างบังคับต้องมี — ถ้าไม่มี ฟอร์มจะไปต่อท้ายแถว VAT
                แล้วถูกอ่านเป็น "แถวยอดเงินอีกแถว" (ผู้ใช้รายงานเข้ามาจริงว่า
                เข้าใจว่าทุกบิลถูกลด 10% ไปแล้ว)
              */}
                <div className="rule my-1" />

                <StaffMealPanel
                  tableId={table.id}
                  sessionId={sessionId}
                  staffOptions={staffOptions}
                  currentStaffCustomer={session.staffCustomer}
                  discountLabel={formatBp(detail.branch.staffMealDiscountBp)}
                  canEdit={canSetStaffMeal(staff.role)}
                />
              </div>
            </div>
          </section>

          {/* ── ขวา: ยอดที่ต้องจ่าย ───────────────────────────────────── */}
          {/* กว้างเท่าตะกร้าในหน้าโต๊ะเสมอ — สองแพเนลนี้อยู่ตำแหน่งเดียวกันบนจอ
              พนักงานสลับไปมาระหว่างสองหน้านี้ตลอดเวลา ความกว้างที่ขยับไปมาทำให้สายตาเสียจังหวะ */}
          <aside className="flex flex-none flex-col border-t-2 border-[var(--color-text)] bg-[var(--color-neutral-100)] xl:w-1/3 xl:max-w-[560px] xl:min-w-[412px] xl:border-t-0 xl:border-l-2">
            <div className="flex flex-none items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-6 py-4">
              <span className="display text-[20px]">ยอดที่ต้องจ่าย</span>
              <span className="kicker">{session.pax} คน</span>
            </div>

            {/*
              ── แพเนลขวาเหลือเฉพาะของที่ต้องเห็นตลอดตอนรับเงิน ────────────────
              คำเตือน · ยอดรวม · แผงรับเงิน — รายละเอียดยอดย้ายไปอยู่ใต้รายการอาหาร
              ในคอลัมน์ซ้ายแล้ว (ดูเหตุผลที่นั่น)

              ประวัติที่ต้องรู้ก่อนย้ายอะไรกลับเข้ามา: ตอนที่แพเนลนี้ถือทั้งรายละเอียด
              และแผงรับเงิน โซน `overflow-auto` เหลือ 121px จากที่ต้องการ 321px
              ที่จอสูง 700px แล้ว **ยอดรวมถูกตัดหายโดยไม่มีอะไรล้น** —
              เทสต์วัด overflow จึงตอบว่า "ผ่าน" มาตลอด

              `overflow-auto` ตรงนี้เป็นตาข่ายรองรับ ไม่ใช่พฤติกรรมปกติ:
              เนื้อหาที่เหลือสูงราว 550px ซึ่งพอดีทุกจอตั้งแต่ 700px ขึ้นไป
            */}
            <div className="flex flex-col gap-3 border-t-2 border-[var(--color-text)] px-6 py-4 xl:min-h-0 xl:flex-1 xl:overflow-auto">
              {unservedCount > 0 ? (
                <p role="status" className="alert">
                  ยังมีของที่ยังไม่ได้เสิร์ฟ {unservedCount} ชิ้น — ตรวจกับลูกค้าก่อนเก็บเงิน
                </p>
              ) : null}

              <div className="flex items-baseline justify-between gap-3">
                <span className="kicker">รวมทั้งสิ้น</span>
                <span className="display text-[34px]">
                  {formatMoney(bill.grandTotal, currency)}
                </span>
              </div>

              <PaymentPanel
                tableId={table.id}
                sessionId={sessionId}
                currency={currency}
                grandTotal={bill.grandTotal}
                canTake={canTakePayment(staff.role)}
              />
              <Link href={base} className="btn btn-ghost btn-block h-10 text-[13px]">
                ย้อนกลับโดยยังไม่รับเงิน
              </Link>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

/**
 * สรุปหลังรับเงินเสร็จ (บทที่ 11)
 *
 * **ทุกตัวเลขบนหน้านี้อ่านจาก snapshot ในแถว Payment เท่านั้น** ไม่ได้คิดใหม่และ
 * ไม่ได้อ่านอัตราจาก Branch — เป็นรูปแบบเดียวกับที่ใบเสร็จย้อนหลังในบทที่ 12
 * ต้องใช้ ถ้าวันนี้ร้านขึ้นเซอร์วิสชาร์จ หน้านี้ของบิลเมื่อวานต้องไม่ขยับตาม
 */
export function PaidSummary({ receipt, base }: { receipt: PaymentReceipt; base: string }) {
  const { payment, lines } = receipt;
  const currency = payment.currency;
  /**
   * หัวเรื่องของหน้าสรุปต้องพูดภาษาของช่องทางที่ขาย ไม่ใช่ "โต๊ะ" เสมอ
   * — บิลซื้อกลับที่ขึ้นว่า "โต๊ะ เคาน์เตอร์ซื้อกลับ" อ่านแล้วสะดุดทุกครั้ง
   */
  const tableName = salePointDisplayName(payment.tableSession.table, payment.tableSession);

  /**
   * เลขบิลอยู่ "หัวเอกสารครั้งเดียว" ไม่ใช่ต่อท้ายทุกบรรทัด
   *
   * ต่างจากหน้าคิดเงิน (ที่บิลยังเปิดอยู่) ซึ่งแปะเลขไว้ทุกบรรทัดโดยตั้งใจ เพราะ
   * ที่นั่นลูกค้ากำลังไล่เทียบว่า "รอบที่สั่งตอนแรก" กับ "ที่สั่งเพิ่มทีหลัง" ตรงไหม
   * แต่พอจ่ายจบแล้วมันคือเอกสารใบเดียว การเห็นเลขเดิมซ้ำสี่บรรทัดทำให้อ่านเป็น
   * "สรุปของออร์เดอร์" แทนที่จะเป็น "บิล" — รอบโต๊ะที่มีหลายออร์เดอร์จึงลิสต์
   * เลขทั้งหมดไว้ที่หัวแทน
   */
  const orderNumbers = [...new Set(lines.map((line) => line.orderNumber))];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[58px] flex-none items-stretch border-b-2 border-[var(--color-text)]">
        <div className="flex flex-none items-center border-r-2 border-[var(--color-text)] px-4 lg:px-6">
          <span className="display text-[19px] whitespace-nowrap">
            รับเงินแล้ว · {tableName}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 px-4 lg:px-6">
          <span className="tag tag-solid">{PAYMENT_METHOD_LABEL[payment.method]}</span>
        </div>
      </div>

      {/*
        ── ใบบิลใบเดียว ไม่ใช่สองแพเนล ──────────────────────────────────
        หน้าคิดเงิน (ก่อนจ่าย) แบ่งซ้าย-ขวาเพราะฝั่งขวาคือ "แป้นรับเงิน" ที่ต้องกด
        แต่พอจ่ายจบแล้วไม่เหลืออะไรให้กดอีก หน้านี้จึงเป็น **เอกสาร** —
        รายการกับยอดรวมต้องไหลต่อกันในคอลัมน์เดียวแบบใบเสร็จจริง เพื่อให้อ่าน
        ไล่จากบนลงล่างทีเดียวจบ และยื่นจอให้ลูกค้าดูได้โดยไม่ต้องอธิบายว่า
        ตัวเลขฝั่งขวามาจากรายการฝั่งซ้ายยังไง
      */}
      <div className="min-h-0 flex-1 overflow-auto bg-[var(--color-neutral-100)] p-4 lg:p-8">
        <article className="panel mx-auto w-full max-w-[560px]">
          <header className="flex flex-col gap-1 border-b-2 border-[var(--color-text)] px-5 py-4 sm:px-6">
            <div className="flex items-baseline justify-between gap-3">
              <span className="display text-[20px]">บิล · {tableName}</span>
              <span className="kicker tabular-nums">{payment.tableSession.pax} คน</span>
            </div>
            <span className="kicker tabular-nums">
              {orderNumbers.map((number) => `#${number}`).join(" · ")}
            </span>
            <span className="kicker">
              {formatPaidAt(payment.paidAt, payment.branch.timezone)}
              {payment.paidByStaff ? ` · ${payment.paidByStaff.name}` : ""}
            </span>
          </header>

          {/* ── รายการ ─────────────────────────────────────────────────
              วาง "จำนวน × ราคาต่อหน่วย" ไว้ใต้ชื่อ ไม่ใช่แยกเป็นคอลัมน์ของตัวเอง
              เพราะที่ความกว้าง 390px สี่คอลัมน์ทำให้ชื่อเมนูไทยแตกเป็นสามบรรทัด
              แบบนี้ได้ข้อมูลชุดเดียวกันแต่อ่านได้ทั้งบนมือถือและบนจอ 1440 */}
          <ul className="flex flex-col">
            {lines.map((line) => (
              <li
                key={line.id}
                className="flex items-start justify-between gap-4 border-b border-[var(--color-divider)] px-5 py-3 sm:px-6"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="display text-[15px]">{line.name}</span>
                  {line.modifiers.length > 0 ? (
                    <span className="text-xs text-[var(--color-neutral-700)]">
                      {line.modifiers.join(" · ")}
                    </span>
                  ) : null}
                  <span className="kicker tabular-nums">
                    {line.quantity} × {formatMoney(line.unitPrice, currency)}
                  </span>
                </div>
                <span className="display shrink-0 text-right text-[15px] tabular-nums">
                  {formatMoney(line.lineTotal, currency)}
                </span>
              </li>
            ))}
          </ul>

          {/* ── ยอดเงิน ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 px-5 py-4 sm:px-6">
            <Row label="ค่าอาหาร" value={formatMoney(payment.subtotal, currency)} />

            {payment.discountAmount > 0 ? (
              <Row
                label="ส่วนลด"
                value={`-${formatMoney(payment.discountAmount, currency)}`}
                accent
              />
            ) : null}

            {payment.serviceChargeBp > 0 ? (
              <Row
                label={`เซอร์วิสชาร์จ ${formatBp(payment.serviceChargeBp)}`}
                value={formatMoney(payment.serviceChargeAmount, currency)}
              />
            ) : null}

            <Row
              label="มูลค่าสินค้า (ก่อน VAT)"
              value={formatMoney(payment.netAmount, currency)}
              muted
            />
            <Row
              label={`VAT ${formatBp(payment.vatRateBp)}${
                payment.pricesIncludeVat ? " (รวมในราคาแล้ว)" : ""
              }`}
              value={formatMoney(payment.vatAmount, currency)}
              muted
            />
          </div>

          <div className="flex flex-col gap-3 border-t-2 border-[var(--color-text)] px-5 py-4 sm:px-6">
            <div className="flex items-baseline justify-between gap-3">
              <span className="kicker">รวมทั้งสิ้น</span>
              <span className="display text-[30px] tabular-nums">
                {formatMoney(payment.grandTotal, currency)}
              </span>
            </div>

            {/* เอกสารต้องบอกได้ด้วยตัวเองว่าจ่ายด้วยอะไร ไม่ใช่ต้องไปอ่านป้ายบนแถบหัวจอ
                (แถบหัวจอเป็นของ "หน้าจอ" ไม่ใช่ของ "บิล") */}
            <Row label="ชำระโดย" value={PAYMENT_METHOD_LABEL[payment.method]} muted />

            {payment.receivedAmount !== null ? (
              <>
                <Row label="เงินสดที่รับมา" value={formatMoney(payment.receivedAmount, currency)} />
                {/* เงินทอนคือตัวเลขที่แคชเชียร์ต้องนับตามจริง จึงใหญ่รองจากยอดรวม */}
                <div className="flex items-baseline justify-between gap-3 border-t-2 border-[var(--color-text)] pt-3">
                  <span className="kicker">เงินทอน</span>
                  <span className="display text-[26px] tabular-nums">
                    {formatMoney(payment.changeAmount ?? 0, currency)}
                  </span>
                </div>
              </>
            ) : null}

            {payment.method === "QR" ? (
              <p role="status" className="alert">
                โหมดสาธิต — ระบบไม่ได้ยืนยันยอดกับธนาคาร บันทึกนี้มาจากการกดยืนยันของพนักงาน
              </p>
            ) : null}
          </div>

          {/*
            เลขที่เอกสารอยู่บนตัวบิล ไม่ใช่แค่บนปุ่ม — คนที่ยื่นจอให้ลูกค้าดูต้อง
            อ่านเลขให้ฟังได้โดยไม่ต้องกดเข้าไปอีกหน้า (บทที่ 12)
          */}
          {receipt.payment.receipt ? (
            <p className="kicker border-t-2 border-[var(--color-text)] px-5 py-3 tabular-nums sm:px-6">
              ใบเสร็จเลขที่ {receipt.payment.receipt.number}
            </p>
          ) : null}
        </article>

        {/* ปุ่มอยู่นอกกระดาษบิล — มันคือการกระทำของพนักงาน ไม่ใช่ส่วนหนึ่งของเอกสาร */}
        <div className="mx-auto mt-4 flex w-full max-w-[560px] flex-col gap-2 sm:flex-row">
          {/*
            ปุ่มใบเสร็จมาก่อนปุ่มกลับผังโต๊ะ เพราะลำดับที่เกิดจริงหลังกดรับเงินคือ
            "ยื่นใบให้ลูกค้า" แล้วค่อยเดินไปโต๊ะถัดไป — ปุ่มแรกควรเป็นสิ่งที่จะกดต่อ
            ไม่ใช่สิ่งที่จบงาน
          */}
          {receipt.payment.receipt ? (
            <Link
              href={`/pos/receipt/${receipt.payment.receipt.id}`}
              className="btn btn-primary display h-12 flex-1"
            >
              ใบเสร็จ
            </Link>
          ) : null}
          <Link href="/pos" className="btn btn-secondary h-12 flex-1">
            กลับไปผังโต๊ะ
          </Link>
          <Link href={base} className="btn btn-secondary h-12 flex-1">
            เปิดโต๊ะนี้ใหม่
          </Link>
        </div>
      </div>
    </main>
  );
}

/**
 * เวลาที่รับเงินตามเวลาของสาขา
 *
 * ใช้ Intl ได้ที่นี่ (ต่างจาก lib/money.ts ที่ห้าม) เพราะสตริงนี้ถูก render
 * บน server ที่เดียวแล้วส่งเป็น HTML ไม่มีการ render ซ้ำฝั่ง client จึงไม่มีทาง
 * เกิด hydration mismatch — และการระบุ timeZone ตรง ๆ ทำให้ผลลัพธ์ไม่ขึ้นกับ
 * เครื่องที่รัน (server ที่ตั้งเป็น UTC ต้องแสดงเวลาไทยให้ถูก)
 */
function formatPaidAt(paidAt: Date, timezone: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(paidAt);
}

function Row({
  label,
  value,
  muted = false,
  accent = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        muted ? "text-[var(--color-neutral-600)]" : ""
      } ${accent ? "text-[var(--color-accent-700)]" : ""}`}
    >
      <span className={muted ? "text-[13px]" : ""}>{label}</span>
      <span className={`tabular-nums ${muted ? "text-[13px]" : "display text-[16px]"}`}>
        {value}
      </span>
    </div>
  );
}

function EmptyState({ title, detail, href }: { title: string; detail: string; href: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <p className="display text-[28px]">{title}</p>
      <p className="text-[var(--color-neutral-700)]">{detail}</p>
      <Link href={href} className="btn btn-secondary mt-2 h-11">
        ย้อนกลับ
      </Link>
    </div>
  );
}
