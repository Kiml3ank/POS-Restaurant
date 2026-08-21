/**
 * Layout ของหลังร้าน (admin/report) — ใช้บนเดสก์ท็อปเป็นหลัก
 * บทที่ 13 จะคุมด้วย RBAC ว่าใครเห็นรายงานตัวไหนได้บ้าง
 */
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col">{children}</div>;
}
