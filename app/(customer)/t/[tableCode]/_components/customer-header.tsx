import Link from "next/link";

import { LocaleSwitcher } from "@/components/locale-switcher";
import type { Currency } from "@/lib/generated/prisma/enums";
import { formatMoney } from "@/lib/money";
import { getT } from "@/lib/server/locale";

/**
 * แถบหัวของหน้าจอลูกค้า — Server Component (บทที่ 6: ดัน client component
 * ให้เหลือเฉพาะจุดที่ต้อง interactive จริง ๆ) · ส่วนเดียวที่เป็น client คือ
 * ปุ่มสลับภาษา ซึ่งต้องอยู่บนทุกหน้าของลูกค้า เพราะลูกค้าถือมือถือของตัวเอง
 * และเลือกภาษาเองได้โดยไม่กระทบเครื่องพนักงาน (ภาษาอยู่ใน cookie ของเครื่อง)
 */
export async function CustomerHeader({
  tableName,
  branchName,
  backHref,
  cart,
  currency,
}: {
  tableName: string;
  branchName: string;
  backHref?: string;
  cart?: { href: string; itemCount: number; subtotal: number };
  /** สกุลเงินของสาขา — บังคับส่งเสมอ ห้ามเดาเป็นบาท (ดู lib/money.ts) */
  currency: Currency;
}) {
  const { t } = await getT();

  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
      {backHref ? (
        <Link
          href={backHref}
          aria-label={t("common.back")}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-lg leading-none"
        >
          ‹
        </Link>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs text-neutral-500">{branchName}</span>
        <span className="truncate font-semibold">{t("salePoint.tableNamed", { name: tableName })}</span>
      </div>

      <LocaleSwitcher className="shrink-0 text-neutral-700" />

      {cart && cart.itemCount > 0 ? (
        <Link
          href={cart.href}
          className="shrink-0 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium whitespace-nowrap text-white"
        >
          {t("customer.header.cart", {
            count: cart.itemCount,
            total: formatMoney(cart.subtotal, currency),
          })}
        </Link>
      ) : null}
    </header>
  );
}
