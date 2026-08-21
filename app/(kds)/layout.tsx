/**
 * Layout ของจอครัว (KDS) — จอใหญ่ ห้องครัวแสงจ้า มือเปื้อน กดยาก
 * จึงใช้พื้นหลังเข้ม ตัวอักษรใหญ่ และปุ่มขนาดใหญ่เป็นค่าเริ่มต้น
 */
export default function KdsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex min-h-dvh flex-col bg-neutral-900 text-neutral-50">{children}</div>;
}
