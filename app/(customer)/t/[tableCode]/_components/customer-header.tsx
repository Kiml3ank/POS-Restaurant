import Link from "next/link";

import type { Currency } from "@/lib/generated/prisma/enums";
import { formatMoney } from "@/lib/money";

/**
 * แถบหัวของหน้าจอลูกค้า — Server Component ล้วน ไม่มี JS ส่งไปฝั่ง client เลย
 * (บทที่ 6: ดัน client component ให้เหลือเฉพาะจุดที่ต้อง interactive จริง ๆ)
 */
export function CustomerHeader({
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
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
      {backHref ? (
        <Link
          href={backHref}
          aria-label="Back"
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-lg leading-none"
        >
          ‹
        </Link>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs text-neutral-500">{branchName}</span>
        <span className="truncate font-semibold">Table {tableName}</span>
      </div>

      {cart && cart.itemCount > 0 ? (
        <Link
          href={cart.href}
          className="shrink-0 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Cart {cart.itemCount} · {formatMoney(cart.subtotal, currency)}
        </Link>
      ) : null}
    </header>
  );
}
