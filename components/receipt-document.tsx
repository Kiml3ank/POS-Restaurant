import { formatBp } from "@/lib/bill";
import { formatMoney } from "@/lib/money";
import { paymentMethodKey } from "@/lib/payment-method";
import { receiptKindTitleKey } from "@/lib/receipt";
import { dailyOrderNumber } from "@/lib/order-number";
import { salePointDisplayName, salePointFieldLabel, showsInTableMap } from "@/lib/sale-point";
import { getT } from "@/lib/server/locale";
import type { ReceiptDetail } from "@/lib/server/receipt";

/**
 * ตัวใบเสร็จ / ใบกำกับภาษีอย่างย่อ (บทที่ 12)
 *
 * ── ใช้ร่วมสองเส้นทาง ────────────────────────────────────────────────────
 * `/pos/receipt/[id]` (cookie ของ POS) และ `/admin/receipts/[id]` (cookie หลังร้าน)
 * render ตัวเดียวกันนี้ — **ห้ามก๊อปไปเขียนซ้ำสองที่** ไม่งั้นวันหนึ่งใบที่พิมพ์
 * จากสองจอจะไม่เหมือนกัน ซึ่งเป็นเอกสารคนละใบในสายตาผู้ตรวจสอบ
 * (ท่าเดียวกับ components/item-options-form.tsx ที่ลูกค้ากับ POS ใช้ร่วมกัน)
 *
 * ── ทุกตัวเลขมาจาก snapshot ────────────────────────────────────────────
 * ตัวตนผู้ขายอ่านจาก `receipt.seller*` (ค่า ณ วันที่ออกใบ) **ไม่ใช่จาก Branch/Tenant**
 * ยอดเงินอ่านจาก `payment.*` (ค่า ณ วันที่รับเงิน) **ไม่ใช่ผลบวกของ Order**
 * ร้านเปลี่ยนชื่อ ย้ายที่อยู่ หรือขึ้น VAT แล้ว ใบนี้ต้องพิมพ์ออกมาเหมือนเดิมเป๊ะ
 *
 * ── ความกว้าง 80mm ─────────────────────────────────────────────────────
 * บนจอแสดงเป็นกระดาษกว้างเท่ากับที่จะออกจริง ตอนพิมพ์ `@media print` ใน
 * globals.css จะซ่อนทุกอย่างที่ไม่ใช่ `.receipt-doc` แล้วปลดเชลล์ `h-dvh
 * overflow-hidden` ของ route group ออก — **ไม่มีเลย์เอาต์สองชุด** ชุดเดียว
 * เปลี่ยนพฤติกรรมตอนพิมพ์
 *
 * ⚠ รูปแบบเอกสารนี้ไม่ใช่คำแนะนำทางกฎหมาย ต้องให้ผู้สอบบัญชี/สรรพากรตรวจก่อนใช้จริง
 */
export async function ReceiptDocument({ detail }: { detail: ReceiptDetail }) {
  const { t } = await getT();
  const { receipt, payment, lines } = detail;
  const currency = payment.currency;
  const isTaxDoc = receipt.kind === "TAX_ABB";

  /**
   * "สำเนา" ตัดสินจาก printCount ที่บันทึกไว้แล้ว ไม่ใช่จากว่ากำลังจะพิมพ์ครั้งที่เท่าไหร่
   * — ใบแรกที่พิมพ์คือต้นฉบับ ทุกใบหลังจากนั้นคือสำเนา และตัวเลขนี้ถูกเพิ่ม
   * ก่อนที่กล่องพิมพ์จะเปิด (ดู components/receipt-print-button.tsx)
   */
  const isCopy = receipt.printCount > 1;
  const isDineIn = showsInTableMap(payment.tableSession.table.kind);

  const orderNumbers = [...new Set(lines.map((line) => line.orderNumber))];

  return (
    <article className="receipt-doc mx-auto w-full max-w-[302px] bg-white px-4 py-5 text-[var(--color-text)]">
      {/* ── หัวเอกสาร: ตัวตนผู้ขาย ณ วันที่ออกใบ ───────────────────────── */}
      <header className="flex flex-col items-center gap-1 text-center">
        <span className="display text-[16px] leading-tight">{receipt.sellerName}</span>
        <span className="text-[11px] leading-snug">{receipt.sellerBranchName}</span>

        {receipt.sellerAddress ? (
          <span className="text-[11px] leading-snug">{receipt.sellerAddress}</span>
        ) : null}

        {receipt.sellerPhone ? (
          <span className="text-[11px] leading-snug">โทร. {receipt.sellerPhone}</span>
        ) : null}

        {/* เลขผู้เสียภาษีถูกตัดตั้งแต่ตอนเขียนลงฐานสำหรับสาขานอกไทย (receipt-issue.ts)
            เงื่อนไขตรงนี้จึงเป็นชั้นที่สอง ไม่ใช่ชั้นเดียวที่กันไว้ */}
        {isTaxDoc && receipt.sellerTaxId ? (
          <span className="text-[11px] leading-snug">
            เลขประจำตัวผู้เสียภาษี {receipt.sellerTaxId}
          </span>
        ) : null}
      </header>

      <div className="my-3 border-t-2 border-dashed border-[var(--color-text)]" />

      <div className="flex flex-col items-center gap-1 text-center">
        <span className="display text-[13px] leading-tight">
          {t(receiptKindTitleKey(receipt.kind))}
        </span>
        {isCopy ? (
          <span className="tag tag-outline text-[11px]">{t("receipt.copy")}</span>
        ) : null}
      </div>

      <div className="my-3 border-t-2 border-dashed border-[var(--color-text)]" />

      {/* ── ข้อมูลใบ ─────────────────────────────────────────────────── */}
      <dl className="flex flex-col gap-1 text-[11px]">
        <Line label="เลขที่" value={receipt.number} strong />
        <Line label="วันที่" value={formatDateTime(payment.paidAt, payment.branch.timezone)} />
        {/*
          ป้ายกับค่าต้องเปลี่ยนตามช่องทาง ไม่ใช่เขียน "โต๊ะ" ตายตัว —
          บิลซื้อกลับเคยพิมพ์ออกมาว่า "โต๊ะ: เคาน์เตอร์ซื้อกลับ" ซึ่งผิดสองชั้น
          (เรียกสิ่งที่ไม่ใช่โต๊ะว่าโต๊ะ + บอกชื่อช่องแทนที่จะบอกว่าเป็นบิลของใคร)
        */}
        <Line
          label={salePointFieldLabel(payment.tableSession.table.kind, t)}
          value={
            isDineIn
              ? payment.tableSession.table.name
              : salePointDisplayName(payment.tableSession.table, payment.tableSession, t)
          }
        />
        {/*
          จำนวนลูกค้ามีความหมายเฉพาะบิลที่นั่งกินที่ร้าน — ของซื้อกลับที่พิมพ์ว่า
          "จำนวนลูกค้า 1 คน" ทุกใบคือบรรทัดที่ไม่ได้บอกอะไรเลย และกินพื้นที่
          กระดาษ 80mm ที่มีจำกัด
        */}
        {isDineIn ? (
          <Line label="จำนวนลูกค้า" value={`${payment.tableSession.pax} คน`} />
        ) : null}
        {payment.paidByStaff ? <Line label="พนักงาน" value={payment.paidByStaff.name} /> : null}
        <Line label="อ้างอิงบิล" value={orderNumbers.map((number) => `#${dailyOrderNumber(number)}`).join(" ")} />
      </dl>

      <div className="my-3 border-t-2 border-dashed border-[var(--color-text)]" />

      {/* ── รายการ ────────────────────────────────────────────────────
          จำนวน × ราคาต่อหน่วย อยู่ใต้ชื่อ ไม่ใช่คอลัมน์แยก — ที่ความกว้าง 80mm
          สามคอลัมน์ทำให้ชื่อเมนูไทยแตกเป็นสามบรรทัดทุกบรรทัด */}
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.id} className="flex items-start justify-between gap-2 text-[11px]">
            <div className="flex min-w-0 flex-col">
              <span className="display text-[12px] leading-tight">{line.name}</span>
              {line.modifiers.length > 0 ? (
                <span className="leading-snug">{line.modifiers.join(" · ")}</span>
              ) : null}
              <span className="tabular-nums">
                {line.quantity} × {formatMoney(line.unitPrice, currency)}
              </span>
            </div>
            <span className="shrink-0 tabular-nums">{formatMoney(line.lineTotal, currency)}</span>
          </li>
        ))}
      </ul>

      <div className="my-3 border-t-2 border-dashed border-[var(--color-text)]" />

      {/* ── ยอดเงิน — ทุกตัวเป็น snapshot ใน Payment ห้ามคิดใหม่ตรงนี้ ──── */}
      <dl className="flex flex-col gap-1 text-[11px]">
        <Line label="ค่าอาหาร" value={formatMoney(payment.subtotal, currency)} />

        {/*
          ส่วนลดพนักงาน (บทที่ 13) — **ชื่อคนกินอยู่บนเอกสารที่ลูกค้าถือ**
          ไม่ใช่แค่ในฐานข้อมูล เพราะใบเสร็จคือสิ่งที่ผู้ตรวจสอบเห็นก่อน
          และเปอร์เซ็นต์อ่านจาก `discountBp` ที่ snapshot ไว้ ไม่ได้คำนวณย้อนจากตัวเลข
        */}
        {payment.discountAmount > 0 ? (
          <Line
            label={
              payment.staffCustomer
                ? `ส่วนลดพนักงาน · ${payment.staffCustomer.name}${
                    payment.discountBp > 0 ? ` ${formatBp(payment.discountBp)}` : ""
                  }`
                : "ส่วนลด"
            }
            value={`-${formatMoney(payment.discountAmount, currency)}`}
          />
        ) : null}

        {payment.serviceChargeBp > 0 ? (
          <Line
            label={`เซอร์วิสชาร์จ ${formatBp(payment.serviceChargeBp)}`}
            value={formatMoney(payment.serviceChargeAmount, currency)}
          />
        ) : null}
      </dl>

      <div className="my-2 border-t border-[var(--color-text)]" />

      <div className="flex items-baseline justify-between gap-2">
        <span className="display text-[13px]">รวมทั้งสิ้น</span>
        <span className="display text-[18px] tabular-nums">
          {formatMoney(payment.grandTotal, currency)}
        </span>
      </div>

      <div className="my-2 border-t border-[var(--color-text)]" />

      {/*
        ── การแยก VAT บนใบกำกับภาษีอย่างย่อ ─────────────────────────────
        แสดงเฉพาะเอกสารไทย เพราะสาขา LAK/VND ไม่ได้อยู่ใต้ VAT ของไทย
        และคำว่า "มูลค่าสินค้าก่อน VAT" บนใบที่ไม่ใช่เอกสารภาษีจะทำให้เข้าใจผิด

        `pricesIncludeVat` เปลี่ยน **ถ้อยคำ** ไม่ใช่ตัวเลข — ตัวเลขถูกคิดไว้แล้ว
        ตอนรับเงินด้วยสูตรที่ต่างกันสองสูตร (ดู lib/bill.ts) ที่นี่แค่บอกลูกค้าว่า
        VAT ที่เห็นถูกถอดออกมาจากราคา หรือบวกเพิ่มจากราคา
      */}
      {isTaxDoc ? (
        <dl className="flex flex-col gap-1 text-[11px]">
          <Line label="มูลค่าสินค้า" value={formatMoney(payment.netAmount, currency)} />
          <Line
            label={`ภาษีมูลค่าเพิ่ม ${formatBp(payment.vatRateBp)}`}
            value={formatMoney(payment.vatAmount, currency)}
          />
          <p className="mt-1 leading-snug">
            {payment.pricesIncludeVat
              ? "ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว"
              : "ภาษีมูลค่าเพิ่มคิดเพิ่มจากราคาสินค้า"}
          </p>
        </dl>
      ) : null}

      <div className="my-3 border-t-2 border-dashed border-[var(--color-text)]" />

      {/* ── การชำระเงิน ─────────────────────────────────────────────── */}
      <dl className="flex flex-col gap-1 text-[11px]">
        <Line label="ชำระโดย" value={t(paymentMethodKey(payment.method))} />

        {payment.receivedAmount !== null ? (
          <>
            <Line label="รับเงิน" value={formatMoney(payment.receivedAmount, currency)} />
            <Line
              label="เงินทอน"
              value={formatMoney(payment.changeAmount ?? 0, currency)}
              strong
            />
          </>
        ) : null}
      </dl>

      <div className="my-3 border-t-2 border-dashed border-[var(--color-text)]" />

      <footer className="flex flex-col items-center gap-1 text-center text-[11px]">
        {/*
          ข้อความท้ายใบมาจาก snapshot ของใบนั้น ไม่ใช่จากค่าตั้งปัจจุบันของสาขา —
          ร้านเปลี่ยนข้อความแล้วใบที่ออกไปแล้วต้องพิมพ์ซ้ำได้เหมือนเดิมเป๊ะ
          (เหตุผลเดียวกับชื่อร้าน/ที่อยู่ที่อยู่ในกลุ่ม seller* ทั้งหมด)
          · null = ใบเก่าก่อนมีคอลัมน์นี้ หรือร้านยังไม่ได้ตั้ง → ใช้ข้อความเริ่มต้น
        */}
        <span className="leading-snug whitespace-pre-line">
          {receipt.sellerFooter ?? "ขอบคุณที่ใช้บริการ"}
        </span>
        {/*
          โหมดสาธิตต้องเขียนไว้บนตัวเอกสาร ไม่ใช่แค่บนหน้าจอ — ใบที่พิมพ์ออกมาแล้ว
          จะถูกอ่านโดยคนที่ไม่เคยเห็นหน้าจอนี้ และต้องรู้ได้เองว่ามันไม่ใช่ของจริง
        */}
        <span className="leading-snug">
          เอกสารตัวอย่างจากระบบสาธิต — ไม่ใช่หลักฐานทางภาษีที่ใช้ได้จริง
        </span>
        {receipt.printCount > 0 ? (
          <span className="leading-snug">พิมพ์ครั้งที่ {receipt.printCount}</span>
        ) : null}
      </footer>
    </article>
  );
}

/** หนึ่งบรรทัด ป้ายซ้าย–ค่าขวา ที่ใช้ซ้ำทั้งใบ */
function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0">{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? "display text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}

/**
 * วันเวลาตามเวลาของสาขา
 *
 * ใช้ Intl ได้ที่นี่ (ต่างจาก lib/money.ts ที่ห้าม) เพราะสตริงนี้ถูก render บน
 * server ที่เดียวแล้วส่งเป็น HTML — component นี้ไม่มี "use client" จึงไม่มีการ
 * render ซ้ำฝั่ง browser ที่จะทำให้ hydration ไม่ตรง
 */
function formatDateTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(at);
}
