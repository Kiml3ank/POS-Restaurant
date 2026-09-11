import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ItemOptionsForm, type OptionGroupView } from "@/components/item-options-form";
import { formatMoney } from "@/lib/money";
import { canAccessScreen } from "@/lib/rbac";
import { getT } from "@/lib/server/locale";
import { getCustomerMenuItem } from "@/lib/server/menu";
import { getPosTable } from "@/lib/server/pos";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { posAddToCartAction } from "../../../../actions";

/**
 * เลือกตัวเลือกของเมนูจากเครื่อง POS (บทที่ 9)
 *
 * ใช้ <ItemOptionsForm> ตัวเดียวกับหน้าลูกค้า ต่างกันแค่ action ที่ส่งเข้าไป —
 * ฝั่งลูกค้าตรวจสิทธิ์ด้วย cookie ของรอบโต๊ะ ฝั่งนี้ตรวจด้วย session พนักงาน
 * กฎ required/minSelect/maxSelect และการคิดราคาจึงเหมือนกันเป๊ะทั้งสองทาง
 * โดยไม่ต้องเขียนซ้ำ (ส่ง skin="pos" เพื่อเปลี่ยนแค่หน้าตา ไม่แตะกฎ)
 *
 * design วางขั้นนี้เป็น modal ทับจอสั่งของ ที่นี่เป็นคนละ route จึงทำเป็น
 * แผ่นกลางจอหน้าตาเหมือน modal แทน — ตั้งใจไม่ทำ modal จริงเพราะการเลือก
 * ตัวเลือกต้องมี URL ของตัวเอง (พนักงานกดปุ่ม back ของเบราว์เซอร์เป็นประจำ)
 */
export default async function PosMenuItemPage({
  params,
}: {
  params: Promise<{ tableId: string; itemId: string }>;
}) {
  const { t } = await getT();
  const staff = await getCurrentStaff("pos");

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const { tableId, itemId } = await params;
  const currency = staff.branch.currency;
  const detail = await getPosTable(staff.branchId, tableId);

  if (!detail) {
    notFound();
  }

  if (!detail.session) {
    redirect(`/pos/table/${tableId}`);
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
              {t("salePoint.tableNamed", { name: detail.table.name })} · {item.category.name}
            </span>
            <h1 className="display text-[28px] leading-tight">{item.name}</h1>
          </div>
          <span className="display shrink-0 text-[22px]">{formatMoney(item.basePrice, currency)}</span>
        </div>

        <div className="flex flex-col gap-6 p-4 lg:p-6">
          <ItemOptionsForm
            action={posAddToCartAction}
            hiddenFields={{ tableId, menuItemId: item.id }}
            basePrice={item.basePrice}
            groups={groups}
            currency={currency}
            submitLabel={t("pos.item.addToTable")}
            skin="pos"
          />

          <Link
            href={`/pos/table/${tableId}?cat=${item.category.id}`}
            className="btn btn-secondary h-12 justify-center"
          >
            {t("pos.item.backToMenu")}
          </Link>
        </div>
      </div>
    </main>
  );
}
