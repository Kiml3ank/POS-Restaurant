/**
 * Layout ของหน้าจอลูกค้า (มือถือ, เข้าจากการสแกน QR ที่โต๊ะ)
 *
 * ข้อจำกัดที่ต้องยึดตลอดในบทที่ 6-7: ลูกค้าใช้เน็ตมือถือที่อาจอ่อนมาก
 * หน้านี้จึงต้องเป็น React Server Component ให้มากที่สุด และดันเป็น client
 * component เฉพาะจุดที่ต้อง interactive จริง ๆ เท่านั้น
 */
export default function CustomerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">{children}</div>;
}
