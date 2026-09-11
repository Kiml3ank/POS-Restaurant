import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LiveRefresh } from "@/components/live-refresh";
import { dailyOrderNumber } from "@/lib/order-number";
import { formatMoney } from "@/lib/money";
import { orderItemStatusKey, orderStatusKey } from "@/lib/order-status";
import { getPlacedOrders } from "@/lib/server/cart";
import { getT } from "@/lib/server/locale";
import { resolveCustomerContext } from "@/lib/server/table-session";

import { CustomerHeader } from "../_components/customer-header";

/**
 * หน้าติดตามออร์เดอร์ของโต๊ะ — ปลายทางหลังกดส่งเข้าครัว (บทที่ 7)
 *
 * สถานะจากครัว push มาเองแบบ realtime แล้ว (บทที่ 8) ผ่าน SSE ที่ /api/realtime
 * — ไม่ใช่ WebSocket เพราะ Route Handler ของ Next.js อัปเกรด connection ไม่ได้
 * (CLAUDE.md หัวข้อ 2) ตัวรับอยู่ที่ <LiveRefresh> ด้านล่าง
 *
 * สถานะที่แสดงเป็นระดับ "รายการ" ไม่ใช่ระดับบิล เพราะของในบิลเดียวกันเสร็จ
 * ไม่พร้อมกัน (น้ำมาก่อน ครัวร้อนตามมาทีหลัง)
 */
export default async function TableOrdersPage({
  params,
}: {
  params: Promise<{ tableCode: string }>;
}) {
  const { t, tc } = await getT();
  const { tableCode } = await params;
  const context = await resolveCustomerContext(tableCode);

  if (!context) {
    notFound();
  }

  // สกุลเงินมาจากสาขาเสมอ ห้าม hardcode บาท — สาขาลาว/เวียดนามใช้คนละสกุล
  const currency = context.branch.currency;

  if (!context.session) {
    redirect(`/t/${tableCode}`);
  }

  const orders = await getPlacedOrders(context.session.id);
  const runningTotal = orders
    .filter((order) => order.status !== "CANCELLED")
    .reduce((sum, order) => sum + order.subtotal, 0);

  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: context.branch.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <CustomerHeader
        tableName={context.table.name}
        branchName={context.branch.name}
        currency={currency}
        backHref={`/t/${tableCode}`}
      />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4 pb-24">
        <h1 className="text-xl font-semibold">{t("customer.orders.title", { name: context.table.name })}</h1>

        {orders.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-neutral-300 p-6">
            <p className="text-sm text-neutral-600">{t("customer.orders.empty")}</p>
            <Link
              href={`/t/${tableCode}`}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              {t("customer.browseMenu")}
            </Link>
          </div>
        ) : (
          <>
            <p className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <span>{tc("customer.orders.sent", orders.length)}</span>
              {/*
                สถานะจากครัววิ่งมาเองผ่าน SSE (บทที่ 8) — ลูกค้าไม่ต้องกดโหลดใหม่
                และไม่ต้องเรียกพนักงานมาถามว่า "อาหารถึงไหนแล้ว" ซึ่งเป็นเหตุผล
                ครึ่งหนึ่งที่หน้านี้มีอยู่ตั้งแต่แรก

                ต่อสายด้วย ?table= เพื่อให้ฝั่ง server กรองให้เหลือเฉพาะ event ของ
                โต๊ะนี้ (ดู app/api/realtime/route.ts) — มือถือของลูกค้าโต๊ะนี้
                ต้องไม่ได้รับแม้แต่สัญญาณเปล่าของโต๊ะอื่น
              */}
              <LiveRefresh src={`/api/realtime?table=${tableCode}`} className="text-emerald-800" />
            </p>

            <ul className="flex flex-col gap-3">
              {orders.map((order) => (
                <li
                  key={order.id}
                  className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">#{dailyOrderNumber(order.orderNumber)}</span>
                    <span className="text-sm text-neutral-500">
                      {order.placedAt ? timeFormatter.format(order.placedAt) : "—"} ·{" "}
                      {t(orderStatusKey(order.status))}
                    </span>
                  </div>

                  <ul className="flex flex-col gap-1">
                    {order.items.map((line) => (
                      <li key={line.id} className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium">{line.quantity}×</span>{" "}
                          {line.nameSnapshot}
                          {line.modifiers.length > 0 ? (
                            <span className="block text-neutral-500">
                              {line.modifiers.map((modifier) => modifier.nameSnapshot).join(" · ")}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-neutral-500">
                          {t(orderItemStatusKey(line.status))}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex justify-between border-t border-neutral-100 pt-2 text-sm">
                    <span className="text-neutral-600">{t("customer.orders.orderTotal")}</span>
                    <span className="font-medium">{formatMoney(order.subtotal, currency)}</span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex justify-between rounded-xl bg-neutral-100 px-3 py-3">
              <span className="text-sm text-neutral-600">{t("customer.orders.tableTotal")}</span>
              <span className="font-semibold">{formatMoney(runningTotal, currency)}</span>
            </div>
          </>
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-md border-t border-neutral-200 bg-white p-3">
        <Link
          href={`/t/${tableCode}`}
          className="block rounded-lg bg-neutral-900 px-4 py-3 text-center text-sm font-medium text-white"
        >
          {t("customer.orders.orderMore")}
        </Link>
      </nav>
    </>
  );
}
