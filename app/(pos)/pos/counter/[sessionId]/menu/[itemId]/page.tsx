import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ItemOptionsForm, type OptionGroupView } from "@/components/item-options-form";
import { formatMoney } from "@/lib/money";
import { canAccessScreen } from "@/lib/rbac";
import { salePointDisplayName } from "@/lib/sale-point";
import { getT } from "@/lib/server/locale";
import { getCustomerMenuItem } from "@/lib/server/menu";
import { getPosSession } from "@/lib/server/pos";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { posAddToCartAction } from "../../../../actions";

/**
 * เลือกตัวเลือกของเมนูสำหรับบิลซื้อกลับ
 *
 * แฝดของ `/pos/table/[tableId]/menu/[itemId]` — ต่างกันแค่ **หาบิลจาก sessionId
 * ไม่ใช่จาก tableId** และแนบ `sessionId` เข้าไปในฟอร์มเพื่อให้ action รู้ว่าใบไหน
 *
 * กฎ required/minSelect/maxSelect และการคิดราคาอยู่ใน `<ItemOptionsForm>`
 * ตัวเดียวกับหน้าลูกค้าและหน้าโต๊ะ — ไม่มีสำเนาที่สอง
 */
export default async function PosCounterMenuItemPage({
  params,
}: {
  params: Promise<{ sessionId: string; itemId: string }>;
}) {
  const { t } = await getT();
  const staff = await getCurrentStaff("pos");

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const { sessionId, itemId } = await params;
  const currency = staff.branch.currency;
  const detail = await getPosSession(staff.branchId, sessionId);

  if (!detail?.session) {
    notFound();
  }

  const item = await getCustomerMenuItem(staff.branchId, itemId);

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
    <main className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-4 lg:p-8">
      <div className="modal w-full max-w-[640px]">
        <div className="flex flex-none items-baseline justify-between gap-4 border-b-2 border-[var(--color-text)] p-4 lg:p-6">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="kicker truncate">
              {salePointDisplayName(detail.table, detail.session, t)} · {item.category.name}
            </span>
            <h1 className="display text-[28px] leading-tight">{item.name}</h1>
          </div>
          <span className="display shrink-0 text-[22px]">{formatMoney(item.basePrice, currency)}</span>
        </div>

        <div className="flex flex-col gap-6 p-4 lg:p-6">
          <ItemOptionsForm
            action={posAddToCartAction}
            /**
             * `sessionId` คือสิ่งที่บอก action ว่าเป็นบิลใบไหน — ขาดไปเมื่อไหร่
             * action จะปฏิเสธ (เคาน์เตอร์มีหลายบิลเปิดพร้อมกัน จึงไม่ยอมเดา)
             */
            hiddenFields={{
              tableId: detail.table.id,
              sessionId: detail.session.id,
              menuItemId: item.id,
            }}
            basePrice={item.basePrice}
            groups={groups}
            currency={currency}
            submitLabel={t("pos.item.addToTakeaway")}
            skin="pos"
          />

          <Link
            href={`/pos/counter/${sessionId}?cat=${item.category.id}`}
            className="btn btn-secondary h-12 justify-center"
          >
            {t("pos.item.backToMenu")}
          </Link>
        </div>
      </div>
    </main>
  );
}
