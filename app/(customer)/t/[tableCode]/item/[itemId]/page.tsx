import Image from "next/image";
import { notFound, redirect } from "next/navigation";

import { formatMoney } from "@/lib/money";
import { getCustomerMenuItem } from "@/lib/server/menu";
import { resolveCustomerContext } from "@/lib/server/table-session";

import { ItemOptionsForm, type OptionGroupView } from "@/components/item-options-form";
import { addToCartAction } from "../../actions";
import { CustomerHeader } from "../../_components/customer-header";

/**
 * หน้ารายละเอียดเมนู + เลือกตัวเลือก (บทที่ 6-7)
 *
 * แยกเป็นคนละ route กับหน้ารวมเมนู ไม่ทำเป็น modal ฝั่ง client เพราะ
 *   - ปุ่มย้อนกลับของมือถือทำงานตามที่ลูกค้าคาดหวัง
 *   - หน้ารวมเมนูไม่ต้องแบก JS ของฟอร์มตัวเลือกทุกเมนูติดไปตั้งแต่แรก
 *
 * โครงข้อมูลตัวเลือกมาจาก DB ล้วน (MenuItem → ModifierGroup → Modifier)
 * ไม่มีการ hardcode ว่าเมนูไหนมีขนาด/ความหวาน (CLAUDE.md หัวข้อ 4)
 */
export default async function MenuItemPage({
  params,
}: {
  params: Promise<{ tableCode: string; itemId: string }>;
}) {
  const { tableCode, itemId } = await params;
  const context = await resolveCustomerContext(tableCode);

  if (!context) {
    notFound();
  }

  // สกุลเงินมาจากสาขาเสมอ ห้าม hardcode บาท — สาขาลาว/เวียดนามใช้คนละสกุล
  const currency = context.branch.currency;

  // ยังไม่ได้เปิดโต๊ะ (หรือรอบหมดอายุ) — กลับไปเริ่มที่หน้าแรกของโต๊ะก่อน
  if (!context.session) {
    redirect(`/t/${tableCode}`);
  }

  const item = await getCustomerMenuItem(context.branch.id, itemId);

  if (!item) {
    notFound();
  }

  const groups: OptionGroupView[] = item.modifierGroups.map((link) => ({
    id: link.modifierGroup.id,
    name: link.modifierGroup.name,
    required: link.modifierGroup.required,
    minSelect: link.modifierGroup.minSelect,
    maxSelect: link.modifierGroup.maxSelect,
    modifiers: link.modifierGroup.modifiers.map((modifier) => ({
      id: modifier.id,
      name: modifier.name,
      priceDelta: modifier.priceDelta,
    })),
  }));

  return (
    <>
      <CustomerHeader
        tableName={context.table.name}
        branchName={context.branch.name}
        currency={currency}
        backHref={`/t/${tableCode}`}
      />

      <main className="flex flex-1 flex-col gap-5 px-4 py-4">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt=""
            width={768}
            height={432}
            className="aspect-video w-full rounded-xl object-cover"
            priority
          />
        ) : null}

        <div className="flex flex-col gap-1">
          <p className="text-xs text-neutral-500">{item.category.name}</p>
          <h1 className="text-2xl font-semibold">{item.name}</h1>
          {item.description ? (
            <p className="text-sm text-neutral-600">{item.description}</p>
          ) : null}
          <p className="pt-1 text-lg font-medium">{formatMoney(item.basePrice, currency)}</p>
        </div>

        <ItemOptionsForm
          action={addToCartAction}
          hiddenFields={{ tableCode, menuItemId: item.id }}
          basePrice={item.basePrice}
          groups={groups}
          currency={currency}
        />
      </main>
    </>
  );
}
