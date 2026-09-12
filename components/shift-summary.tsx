import type { Currency, PaymentMethod } from "@/lib/generated/prisma/enums";
import { intlLocale, type Locale } from "@/lib/i18n/locales";
import { countKey } from "@/lib/i18n/translate";
import { formatMoney } from "@/lib/money";
import { paymentMethodKey } from "@/lib/payment-method";
import type { Translator } from "@/lib/server/locale";

/**
 * ใบสรุปกะ (Z report) — **component เดียวที่ใช้ทั้งจอ POS และจอหลังร้าน**
 *
 * ห้ามก๊อปเป็นสองชุด (ท่าเดียวกับ `receipt-document.tsx` ของบทที่ 12) —
 * สองชุดแปลว่าวันหนึ่งตัวเลขบนกระดาษกับตัวเลขบนจอผู้จัดการจะไม่ตรงกัน
 *
 * อ่านจาก **snapshot ในแถว Shift อย่างเดียว** ไม่ query สดซ้ำ: เปิดใบของเมื่อวาน
 * ดูปีหน้าต้องได้ตัวเลขเดิมเป๊ะ แม้อัตรา VAT จะเปลี่ยนไปแล้ว
 *
 * ⚠ เป็น server component โดยตั้งใจ — `Intl.DateTimeFormat` ที่นี่จึงปลอดภัย
 * (ถ้าย้ายไปฝั่ง client ต้องเลิกใช้ Intl ก่อน ไม่งั้น ICU ของ server กับ browser
 * ต่างกันแล้วเกิด hydration mismatch — กฎเดียวกับ `formatAmount()` ใน lib/money.ts)
 */
export function ShiftSummary({
  shift,
  currency,
  timezone,
  locale,
  t,
}: {
  shift: {
    id: string;
    openedAt: Date;
    closedAt: Date | null;
    openingFloat: number;
    countedCash: number | null;
    expectedCash: number | null;
    cashDifference: number | null;
    salesTotal: number | null;
    billCount: number | null;
    breakdown: unknown;
    note: string | null;
    openedByStaff: { name: string } | null;
    closedByStaff: { name: string } | null;
  };
  currency: Currency;
  timezone: string;
  locale: Locale;
  t: Translator["t"];
}) {
  const time = (value: Date | null) =>
    value === null
      ? t("shift.unknownStaff")
      : new Intl.DateTimeFormat(intlLocale(locale), {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: timezone,
        }).format(value);

  const breakdown = (shift.breakdown ?? {}) as {
    byMethod?: Record<string, { count: number; total: number }>;
  };

  return (
    <article className="panel receipt-doc flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <p className="kicker">{t("shift.summary.title")}</p>
        <p className="display text-[22px]">
          {time(shift.openedAt)} — {time(shift.closedAt)}
        </p>
        <p className="text-[14px] text-[var(--color-neutral-700)]">
          {t("shift.summary.staffLine", {
            opener: shift.openedByStaff?.name ?? t("shift.unknownStaff"),
            closer: shift.closedByStaff?.name ?? t("shift.unknownStaff"),
          })}
        </p>
      </header>

      <div className="rule" />

      <dl className="flex flex-col gap-2 text-[15px]">
        <Row
          label={t("shift.field.openingFloat")}
          value={formatMoney(shift.openingFloat, currency)}
        />
        <Row
          label={t("shift.field.salesTotal")}
          value={formatMoney(shift.salesTotal ?? 0, currency)}
        />
        <Row
          label={t("shift.field.billCount")}
          value={t(countKey("shift.bills", shift.billCount ?? 0), {
            count: shift.billCount ?? 0,
          })}
        />
        {/* ป้ายวิธีจ่ายมาจาก paymentMethodKey() ที่เดียวของระบบ ห้ามพิมพ์คำเองที่นี่ */}
        {Object.entries(breakdown.byMethod ?? {}).map(([method, bucket]) => (
          <Row
            key={method}
            label={t("shift.methodRow", {
              method: t(paymentMethodKey(method as PaymentMethod)),
              bills: t(countKey("shift.bills", bucket.count), { count: bucket.count }),
            })}
            value={formatMoney(bucket.total, currency)}
          />
        ))}
      </dl>

      <div className="rule" />

      <dl className="flex flex-col gap-2 text-[15px]">
        <Row
          label={t("shift.field.expectedCash")}
          value={formatMoney(shift.expectedCash ?? 0, currency)}
        />
        <Row
          label={t("shift.field.countedCash")}
          value={formatMoney(shift.countedCash ?? 0, currency)}
        />
        <Row
          label={t("shift.field.cashDifference")}
          value={formatMoney(shift.cashDifference ?? 0, currency)}
          strong={(shift.cashDifference ?? 0) !== 0}
        />
      </dl>

      {shift.note ? (
        <p className="text-[14px]">{t("shift.field.note", { note: shift.note })}</p>
      ) : null}

      {/* ระบบยังไม่มีการคืนเงิน — บอกตรง ๆ ดีกว่าใส่บรรทัดที่เป็น 0 ตลอดกาลให้เข้าใจผิด */}
      <p className="kicker">{t("shift.noRefunds")}</p>
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "display" : undefined}>{label}</dt>
      <dd className={strong ? "display text-[18px]" : undefined}>{value}</dd>
    </div>
  );
}
