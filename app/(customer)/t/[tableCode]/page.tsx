import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatBaht } from "@/lib/money";
import { getCart } from "@/lib/server/cart";
import { getCustomerMenu } from "@/lib/server/menu";
import { resolveCustomerContext } from "@/lib/server/table-session";

import { CustomerHeader } from "./_components/customer-header";
import { OpenSessionForm } from "./_components/open-session-form";

/**
 * หน้าเมนูลูกค้า — ปลายทางของ QR ประจำโต๊ะ (บทที่ 5-6)
 *
 * ทั้งหน้าเป็น React Server Component ยกเว้นฟอร์มเปิดโต๊ะ เพราะลูกค้าอยู่บน
 * เน็ตมือถือที่อาจอ่อนมาก ยิ่งส่ง JS ไปน้อยยิ่งเห็นเมนูเร็ว
 *
 * ข้อมูลเมนูดึงจาก Prisma ครั้งเดียวจบด้วย getCustomerMenu() ไม่ยิงทีละหมวด
 * และกรอง isAvailable = true ทุกชั้นตั้งแต่ใน query ไม่ใช่มากรองทีหลังใน JS
 *
 * หน้านี้เป็น dynamic โดยอัตโนมัติเพราะ resolveCustomerContext() อ่าน cookie
 * ซึ่งเป็น request-time API จึงไม่ถูก prerender ตอน build
 */
export default async function CustomerMenuPage({
  params,
}: {
  params: Promise<{ tableCode: string }>;
}) {
  const { tableCode } = await params;
  const context = await resolveCustomerContext(tableCode);

  // QR ที่ชี้ไปโต๊ะที่ถูกลบ/ปิดใช้งาน หรือรหัสมั่ว — ไม่บอกรายละเอียดว่าพลาดตรงไหน
  if (!context) {
    notFound();
  }

  const { table, branch, session } = context;

  if (!session) {
    return (
      <main className="flex flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <p className="text-xs tracking-wide text-neutral-500 uppercase">{branch.name}</p>
          <h1 className="text-3xl font-semibold">โต๊ะ {table.name}</h1>
          <p className="text-sm text-neutral-600">
            ยินดีต้อนรับครับ กดเริ่มสั่งอาหารเพื่อเปิดโต๊ะนี้
          </p>
        </div>

        <OpenSessionForm
          tableCode={table.tableCode}
          tableName={table.name}
          defaultPax={Math.min(table.seats, 8)}
        />
      </main>
    );
  }

  const [menu, cart] = await Promise.all([getCustomerMenu(branch.id), getCart(session.id)]);
  const cartItemCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return (
    <>
      <CustomerHeader
        tableName={table.name}
        branchName={branch.name}
        cart={{
          href: `/t/${table.tableCode}/cart`,
          itemCount: cartItemCount,
          subtotal: cart?.subtotal ?? 0,
        }}
      />

      <main className="flex flex-1 flex-col gap-6 px-4 py-4 pb-28">
        <nav className="flex gap-2 overflow-x-auto pb-1">
          {menu.map((category) => (
            <a
              key={category.id}
              href={`#category-${category.id}`}
              className="shrink-0 rounded-full border border-neutral-300 px-3 py-1.5 text-sm"
            >
              {category.name}
            </a>
          ))}
        </nav>

        {menu.length === 0 ? (
          <p className="text-sm text-neutral-600">ตอนนี้ยังไม่มีเมนูเปิดขาย กรุณาเรียกพนักงาน</p>
        ) : null}

        {menu.map((category) => (
          <section key={category.id} id={`category-${category.id}`} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{category.name}</h2>

            <ul className="flex flex-col gap-2">
              {category.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/t/${table.tableCode}/item/${item.id}`}
                    className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3"
                  >
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt=""
                        width={64}
                        height={64}
                        className="size-16 shrink-0 rounded-lg object-cover"
                      />
                    ) : null}

                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{item.name}</span>
                      {item.description ? (
                        <span className="truncate text-sm text-neutral-500">
                          {item.description}
                        </span>
                      ) : null}
                      {item.hasOptions ? (
                        <span className="text-xs text-neutral-400">มีตัวเลือกให้เลือก</span>
                      ) : null}
                    </div>

                    <span className="shrink-0 font-medium">{formatBaht(item.basePrice)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      <nav className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md gap-2 border-t border-neutral-200 bg-white p-3">
        <Link
          href={`/t/${table.tableCode}/orders`}
          className="flex-1 rounded-lg border border-neutral-300 px-4 py-3 text-center text-sm font-medium"
        >
          ออร์เดอร์ของโต๊ะ
        </Link>
        <Link
          href={`/t/${table.tableCode}/cart`}
          aria-disabled={cartItemCount === 0}
          className={`flex-1 rounded-lg px-4 py-3 text-center text-sm font-medium ${
            cartItemCount === 0
              ? "pointer-events-none bg-neutral-200 text-neutral-500"
              : "bg-neutral-900 text-white"
          }`}
        >
          {cartItemCount === 0 ? "ตะกร้าว่าง" : `ดูตะกร้า (${cartItemCount})`}
        </Link>
      </nav>
    </>
  );
}
