import { notFound, redirect } from "next/navigation";

import { canAccessScreen } from "@/lib/rbac";
import { getT } from "@/lib/server/locale";
import { getPosTable } from "@/lib/server/pos";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { SalePointScreen } from "../../_components/sale-point-screen";

/**
 * จอสั่งอาหารของโต๊ะนั่ง (บทที่ 9)
 *
 * เหลือแค่ "หารอบของโต๊ะนี้แล้วส่งให้จอกลาง" — หน้าตาและตรรกะทั้งหมดอยู่ที่
 * `SalePointScreen` ซึ่งใช้ร่วมกับ `/pos/counter/[sessionId]` **ตัวเดียวกันจริง ๆ**
 *
 * โต๊ะนั่งหารอบจาก `tableId` ได้ตรง ๆ เพราะโต๊ะหนึ่งโต๊ะมีรอบเปิดได้ทีละรอบ
 * (`joinsExistingSession` ใน lib/sale-point.ts) — เคาน์เตอร์ทำแบบนี้ไม่ได้
 */
export default async function PosTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ view?: string; cat?: string }>;
}) {
  const { t, tc } = await getT();
  const staff = await getCurrentStaff("pos");

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const { tableId } = await params;
  const detail = await getPosTable(staff.branchId, tableId);

  if (!detail) {
    notFound();
  }

  const { view, cat } = await searchParams;
  const { table, session } = detail;

  return (
    <SalePointScreen
      staff={staff}
      detail={detail}
      base={`/pos/table/${table.id}`}
      backHref="/pos"
      heading={t("salePoint.tableNamed", { name: table.name })}
      subtitle={`${
        session
          ? `${tc("common.guests", session.pax)} · ${t("pos.subtitle.opened", {
              time: formatTime(session.openedAt, staff.branch.timezone),
            })}`
          : t("pos.subtitle.notOpen")
      } · ${t("pos.subtitle.qr", { code: table.tableCode })}`}
      view={view}
      cat={cat}
    />
  );
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    value,
  );
}
