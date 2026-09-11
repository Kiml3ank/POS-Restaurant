import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveRefresh } from "@/components/live-refresh";
import type { PaymentMethod, SalePointKind } from "@/lib/generated/prisma/enums";
import { formatMoney } from "@/lib/money";
import { paymentMethodKey } from "@/lib/payment-method";
import { canAccessScreen, canReadAuditLog, canViewDashboard } from "@/lib/rbac";
import { salePointKey } from "@/lib/sale-point";
import { getDashboard } from "@/lib/server/dashboard";
import { getT } from "@/lib/server/locale";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * หลังร้าน — หน้าแรก (spec §1)
 *
 * ── ทำไมเปลี่ยนจาก redirect เป็นหน้าจริง ────────────────────────────────
 * เดิมหน้านี้ redirect ไป /admin/menu พร้อมคอมเมนต์ว่า "หน้ารวมที่มีปุ่มเดียวคือ
 * หน้าที่ทุกคนต้องกดผ่านโดยไม่ได้อะไร" — ตอนนั้นมีโมดูลเดียว **ตอนนี้มีหก**
 * และสิ่งที่หน้านี้ให้ไม่ใช่ลิงก์ (แถบซ้ายทำหน้าที่นั้นอยู่แล้ว) แต่เป็น
 * **ตัวเลขของวันนี้** ซึ่งไม่มีที่ไหนในระบบตอบให้ได้เลย
 *
 * ── ตำแหน่งที่ดูยอดขายไม่ได้ ยังเข้าหน้านี้ได้ แค่ถูกพาไปที่งานของตัวเอง ──
 * พ่อครัวที่เข้ามากด "ของหมด" ต้องไม่เจอหน้าที่เขียนว่า "คุณไม่มีสิทธิ์" —
 * พาไป /admin/menu เหมือนเดิม ซึ่งเป็นหน้าที่เขาตั้งใจจะไปอยู่แล้ว
 *
 * ── ตัวเลขบนหน้านี้เป็นของ "วันของสาขา" ไม่ใช่ของเครื่อง server ──────────
 * ร้านที่ปิดตีสองต้องเห็นยอดของกะเดียวกันทั้งกะ (เหตุผลเดียวกับเลขบิล/เลขคิว)
 */
export default async function AdminHomePage() {
  const { t } = await getT();
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  if (!canViewDashboard(staff.role)) {
    redirect("/admin/menu");
  }

  const result = await getDashboard(staff);

  if (!result.ok) {
    redirect("/admin/menu");
  }

  const { day, currency, sales, now, topItems, sensitiveEvents } = result.data;
  const money = (amount: number) => formatMoney(amount, currency);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
        <div className="flex items-baseline gap-3">
          <span className="display text-[19px]">Today&apos;s summary</span>
          <span className="kicker tabular-nums">{day}</span>
        </div>

        {/*
          ต่อท่อ realtime เส้นเดียวกับจอหน้าร้าน — ตัวเลขบนหน้านี้ขยับทุกครั้งที่มี
          บิลปิดหรือครัวกดเปลี่ยนสถานะ ถ้าไม่ต่อ เจ้าของร้านที่เปิดจอนี้ทิ้งไว้
          จะเห็นยอดค้างอยู่ที่เวลาที่เปิดหน้า ซึ่งอันตรายกว่าไม่มีตัวเลขให้ดู
        */}
        <LiveRefresh src="/api/realtime" className="text-[var(--color-accent-700)]" />
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
          <section className="panel flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="kicker">Today&apos;s sales (received)</span>
                <span className="display text-[38px] leading-none tabular-nums">
                  {money(sales.total)}
                </span>
              </div>

              <div className="flex gap-6">
                <Stat label="Bills" value={`${sales.billCount}`} />
                <Stat label="Average/bill" value={money(sales.average)} />
              </div>
            </div>

            <div className="rule" />

            <div className="grid gap-4 sm:grid-cols-2">
              <Breakdown
                title="Payment method"
                rows={sales.byMethod.map((row) => ({
                  label: t(paymentMethodKey(row.method as PaymentMethod)),
                  count: row.count,
                  amount: row.amount,
                }))}
                money={money}
              />
              <Breakdown
                title="Sales channel"
                rows={sales.byChannel.map((row) => ({
                  label: t(salePointKey(row.kind as SalePointKind)),
                  count: row.count,
                  amount: row.amount,
                }))}
                money={money}
              />
            </div>

            {sales.staffMeal.billCount > 0 ? (
              <p className="kicker">
                ในนี้เป็นบิลพนักงาน {sales.staffMeal.billCount} ใบ · ส่วนลดรวม{" "}
                {money(sales.staffMeal.discountAmount)}
              </p>
            ) : null}
          </section>

          <section className="panel flex flex-col gap-4 p-5">
            <span className="display text-[17px]">ตอนนี้ที่หน้าร้าน</span>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="บิลที่เปิดอยู่"
                value={`${now.openBills}`}
                hint={`นั่ง ${now.openDineIn} · ซื้อกลับ ${now.openTakeaway}`}
              />
              <Stat label="ยังไม่ได้เก็บ" value={money(now.openSubtotal)} hint="ค่าอาหาร ยังไม่รวม VAT" />
              <Stat label="ครัวกำลังทำ" value={`${now.kitchenPending}`} hint="ชิ้น" />
              <Stat label="พร้อมเสิร์ฟ" value={`${now.kitchenReady}`} hint="ชิ้น รอยกไปให้ลูกค้า" />
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/pos" className="btn btn-secondary h-10 text-[14px]">
                ผังโต๊ะ
              </Link>
              <Link href="/pos/counter" className="btn btn-secondary h-10 text-[14px]">
                คิวซื้อกลับ
              </Link>
              <Link href="/admin/receipts" className="btn btn-secondary h-10 text-[14px]">
                ใบเสร็จวันนี้
              </Link>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="panel flex flex-col gap-4 p-5">
              <span className="display text-[17px]">เมนูขายดีวันนี้</span>

              {topItems.length === 0 ? (
                <p className="text-[var(--color-neutral-700)]">ยังไม่มีของที่ส่งเข้าครัววันนี้</p>
              ) : (
                <ul className="flex flex-col">
                  {topItems.map((item) => (
                    <li
                      key={item.name}
                      className="flex items-baseline justify-between gap-3 border-b border-[var(--color-divider)] py-2 last:border-b-0"
                    >
                      <span className="min-w-0 truncate">{item.name}</span>
                      <span className="flex shrink-0 items-baseline gap-3">
                        <span className="display text-[16px] tabular-nums">{item.quantity}</span>
                        <span className="kicker tabular-nums">{money(item.amount)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel flex flex-col gap-4 p-5">
              <span className="display text-[17px]">ที่ต้องจับตาวันนี้</span>

              <div className="flex items-baseline gap-3">
                <span className="display text-[38px] leading-none tabular-nums">
                  {sensitiveEvents}
                </span>
                <span className="kicker">
                  ยกเลิกรายการ · ติดธงส่วนลดพนักงาน · ปิดรอบทิ้ง · แก้อัตราภาษี · จัดการบัญชีพนักงาน
                </span>
              </div>

              {canReadAuditLog(staff.role) ? (
                <Link href="/admin/audit-logs" className="btn btn-secondary h-10 text-[14px]">
                  เปิดบันทึกการใช้งาน
                </Link>
              ) : null}

              <p className="kicker">
                เครื่องที่ล็อกอินค้างอยู่ {now.activeStaffSessions} เครื่อง
              </p>
            </section>
          </div>

          {/*
            บอกตรง ๆ ว่าอะไรยังไม่มีและเพราะอะไร ดีกว่าปล่อยช่องว่างหรือใส่ตัวเลขปลอม
            — ช่องที่ขึ้น "—" ตลอดกาลทำให้คนเลิกดูทั้งหน้า
          */}
          <p className="kicker">
            ยังไม่มีบนหน้านี้: กำไรขั้นต้น (ต้องมีต้นทุนต่อเมนูก่อน) · ของใกล้หมด (บทที่ 14) ·
            กราฟย้อนหลังหลายวัน (บทที่ 15)
          </p>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="kicker">{label}</span>
      <span className="display text-[22px] tabular-nums">{value}</span>
      {hint ? <span className="kicker">{hint}</span> : null}
    </div>
  );
}

function Breakdown({
  title,
  rows,
  money,
}: {
  title: string;
  rows: { label: string; count: number; amount: number }[];
  money: (amount: number) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="kicker">{title}</span>

      {rows.length === 0 ? (
        <span className="text-[var(--color-neutral-700)]">ยังไม่มีบิลที่ปิดวันนี้</span>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex items-baseline justify-between gap-3 border-b border-[var(--color-divider)] py-1.5 last:border-b-0"
            >
              <span>
                {row.label}
                <span className="kicker"> · {row.count} ใบ</span>
              </span>
              <span className="tabular-nums">{money(row.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
