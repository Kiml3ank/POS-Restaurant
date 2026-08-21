import Link from "next/link";
import { redirect } from "next/navigation";

import { formatBaht } from "@/lib/money";
import { canAccessScreen } from "@/lib/rbac";
import { getPosTables, type PosTableSummary } from "@/lib/server/pos";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * ผังโต๊ะ — หน้าแรกของเครื่องพนักงาน (บทที่ 9)
 *
 * สิ่งที่พนักงานต้องอ่านออกภายในหนึ่งวินาทีจากระยะสองเมตร:
 *   1. โต๊ะไหนว่าง (กดเปิดได้เลย)
 *   2. โต๊ะไหนมีของ "พร้อมเสิร์ฟ" ค้างอยู่ (ต้องรีบไปยก)
 *   3. โต๊ะไหนยอดเท่าไหร่แล้ว (เตรียมคิดเงิน)
 *
 * design "Modernist" มีสี accent สีเดียว จึงเปลี่ยนวิธีสื่อสถานะจาก "สีการ์ด
 * หลายสี" (เขียว/เหลือง/ขาว แบบเดิม) มาเป็น **ลำดับความเข้ม**: โต๊ะที่ต้องรีบ
 * ไปยกของได้พื้น accent เต็ม ๆ ใบเดียวในจอ ที่เหลือเป็นกระดาษเปล่า —
 * อ่านง่ายกว่าเพราะตาจับ "ใบที่ต่างจากพวก" ได้เร็วกว่าจับเฉดสี
 */
export default async function PosTableMapPage() {
  const staff = await getCurrentStaff();

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const tables = await getPosTables(staff.branchId);
  const openTables = tables.filter((table) => table.session !== null);
  const totalOnFloor = openTables.reduce((sum, table) => sum + table.runningTotal, 0);
  const needAttention = tables.filter((table) => table.readyItems > 0).length;

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="kicker kicker-accent">
            {needAttention > 0 ? `มีของพร้อมเสิร์ฟค้างอยู่ ${needAttention} โต๊ะ` : "ไม่มีของค้างรอยก"}
          </p>
          <h1 className="display text-[40px]">ผังโต๊ะ</h1>
        </div>

        <div className="flex items-end gap-8">
          <div className="flex flex-col gap-1">
            <span className="kicker">เปิดอยู่</span>
            <span className="display text-[22px]">
              {openTables.length}/{tables.length} โต๊ะ
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="kicker">ยอดค้างบนโต๊ะรวม</span>
            <span className="display text-[22px]">{formatBaht(totalOnFloor)}</span>
          </div>
        </div>
      </div>

      <div className="rule" />

      {tables.length === 0 ? (
        <p className="text-[var(--color-neutral-700)]">
          สาขานี้ยังไม่มีโต๊ะ — เพิ่มได้ในหน้าหลังร้าน (บทที่ 13)
        </p>
      ) : (
        <ul className="ink-grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tables.map((table) => (
            <li key={table.id}>
              <TableCard table={table} />
            </li>
          ))}
        </ul>
      )}

      <p className="kicker mt-auto">
        ย้าย/รวมโต๊ะ และแยกบิล ยังไม่ได้ทำในก้อนนี้ · คิดเงินอยู่ในบทที่ 10
      </p>
    </main>
  );
}

function TableCard({ table }: { table: PosTableSummary }) {
  const isOpen = table.session !== null;
  const needsAttention = table.readyItems > 0;

  return (
    <Link
      href={`/pos/table/${table.id}`}
      className={`flex h-full min-h-[210px] flex-col gap-4 p-6 transition-colors ${
        needsAttention
          ? "bg-[var(--color-accent-100)] hover:bg-[var(--color-accent-200)]"
          : "bg-[var(--color-bg)] hover:bg-[var(--color-neutral-200)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="display text-[28px]">{table.name}</span>
        {needsAttention ? (
          <span className="tag tag-solid">พร้อมเสิร์ฟ {table.readyItems}</span>
        ) : isOpen ? (
          <span className="tag tag-outline">{table.session?.pax} คน</span>
        ) : (
          <span className="kicker">{table.seats} ที่นั่ง</span>
        )}
      </div>

      {isOpen ? (
        <>
          <div className="flex flex-1 flex-col gap-1 text-[var(--color-neutral-700)]">
            {table.pendingItems > 0 ? <span>ครัวกำลังทำ {table.pendingItems} ชิ้น</span> : null}
            {table.draftCount > 0 ? <span>มีตะกร้าที่ยังไม่ส่งเข้าครัว</span> : null}
            {table.pendingItems === 0 && table.draftCount === 0 && !needsAttention ? (
              <span>เสิร์ฟครบแล้ว รอคิดเงิน</span>
            ) : null}
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <span className="kicker">ยอดสะสม</span>
            <span className="display text-[24px]">{formatBaht(table.runningTotal)}</span>
          </div>

          {/* ปุ่มท้ายการ์ดตาม design ("Resume tab") — การ์ดทั้งใบเป็นลิงก์อยู่แล้ว
              ตัวนี้จึงเป็น <span> ที่หน้าตาเป็นปุ่ม ไม่ใช่ <button> ซ้อนในลิงก์
              มีไว้เพราะการ์ดที่เปิดอยู่ไม่เคยบอกเลยว่ากดแล้วเจออะไร */}
          <span className="btn btn-secondary btn-block h-11">
            {table.draftCount > 0 ? "ดูตะกร้า / สั่งเพิ่ม" : "สั่งอาหาร / ดูบิล"}
          </span>
        </>
      ) : (
        <>
          <div className="flex flex-1 items-start text-[var(--color-neutral-600)]">ว่าง</div>
          <span className="btn btn-secondary btn-block h-11">เปิดโต๊ะ</span>
        </>
      )}
    </Link>
  );
}
