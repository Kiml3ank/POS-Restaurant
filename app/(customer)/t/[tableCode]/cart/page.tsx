import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { formatMoney } from "@/lib/money";
import { getCart } from "@/lib/server/cart";
import { resolveCustomerContext } from "@/lib/server/table-session";

import { CartLineControls } from "../_components/cart-line-controls";
import { CustomerHeader } from "../_components/customer-header";
import { PlaceOrderForm } from "../_components/place-order-form";

/**
 * ตะกร้า (บทที่ 7)
 *
 * ตะกร้าคือ Order ที่ status = DRAFT ในฐานข้อมูล ไม่ใช่ state ในเบราว์เซอร์
 * ผลที่ตามมาที่ตั้งใจให้เป็น: refresh ทิ้งแล้วกลับมาใหม่ของยังอยู่ครบ และ
 * เพื่อนที่โต๊ะเดียวกันเปิดหน้านี้จากอีกเครื่องก็เห็นตะกร้าใบเดียวกัน
 *
 * ยอดที่แสดงตรงนี้เป็น subtotal ล้วน ๆ ยังไม่รวมเซอร์วิสชาร์จกับ VAT
 * เพราะการคิดบิลเต็ม (ลำดับ service charge → VAT) เป็นงานของบทที่ 10
 * ที่ต้อง snapshot อัตราลงบิลตอนปิดการขาย
 */
export default async function CartPage({
  params,
}: {
  params: Promise<{ tableCode: string }>;
}) {
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

  const cart = await getCart(context.session.id);
  const lines = cart?.items ?? [];
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <>
      <CustomerHeader
        tableName={context.table.name}
        branchName={context.branch.name}
        currency={currency}
        backHref={`/t/${tableCode}`}
      />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4 pb-40">
        <h1 className="text-xl font-semibold">ตะกร้าของโต๊ะ {context.table.name}</h1>

        {lines.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-neutral-300 p-6">
            <p className="text-sm text-neutral-600">ยังไม่มีรายการในตะกร้า</p>
            <Link
              href={`/t/${tableCode}`}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              เลือกเมนู
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li
                key={line.id}
                className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium">{line.nameSnapshot}</span>

                  {line.modifiers.length > 0 ? (
                    <span className="text-sm text-neutral-500">
                      {line.modifiers.map((modifier) => modifier.nameSnapshot).join(" · ")}
                    </span>
                  ) : null}

                  {line.note ? (
                    <span className="text-sm text-amber-700">หมายเหตุ: {line.note}</span>
                  ) : null}

                  <span className="text-sm text-neutral-600">
                    {formatMoney(line.unitPriceSnapshot + line.modifierTotal, currency)} × {line.quantity} ={" "}
                    <span className="font-medium text-neutral-900">
                      {formatMoney(line.lineTotal, currency)}
                    </span>
                  </span>
                </div>

                <CartLineControls
                  tableCode={tableCode}
                  orderItemId={line.id}
                  quantity={line.quantity}
                />
              </li>
            ))}
          </ul>
        )}
      </main>

      {lines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-md border-t border-neutral-200 bg-white p-3">
          <div className="flex items-baseline justify-between pb-2 text-sm">
            <span className="text-neutral-600">ยอดรวมค่าอาหาร</span>
            <span className="text-lg font-semibold">{formatMoney(cart?.subtotal ?? 0, currency)}</span>
          </div>
          <p className="pb-2 text-xs text-neutral-500">
            ยังไม่รวมเซอร์วิสชาร์จและ VAT — คิดตอนเช็คบิลที่เคาน์เตอร์
          </p>

          <PlaceOrderForm
            tableCode={tableCode}
            subtotal={cart?.subtotal ?? 0}
            itemCount={itemCount}
            currency={currency}
          />
        </div>
      ) : null}
    </>
  );
}
