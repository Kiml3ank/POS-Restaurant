/**
 * Layout ของเครื่องพนักงาน (POS) — แท็บเล็ต/จอสัมผัสแนวนอน
 * บทที่ 13 จะเพิ่มการล็อกจอ + ตรวจ PIN พนักงานคร่อม layout นี้
 */
export default function PosLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
