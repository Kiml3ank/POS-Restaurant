/**
 * หน้าเมนูลูกค้า — ปลายทางของ QR ประจำโต๊ะ (บทที่ 5-7)
 *
 * ตอนนี้ยังเป็นโครง: ยังไม่ตรวจ TableSession และยังไม่ดึงเมนูจาก Prisma
 *  - บทที่ 5: ตรวจ tableCode + TableSession ที่ยังไม่หมดอายุ (ผ่าน proxy.ts)
 *  - บทที่ 6: ดึง MenuCategory → MenuItem → ModifierGroup → Modifier ครั้งเดียว
 *  - บทที่ 7: ตะกร้าฝั่ง server + ส่งออร์เดอร์แบบกันกดซ้ำ
 */
export default async function CustomerMenuPage({
  params,
}: {
  params: Promise<{ tableCode: string }>;
}) {
  const { tableCode } = await params;

  return (
    <main className="flex flex-1 flex-col gap-2 p-4">
      <p className="text-xs tracking-wide text-neutral-500 uppercase">หน้าจอลูกค้า (QR)</p>
      <h1 className="text-2xl font-semibold">โต๊ะ {tableCode}</h1>
      <p className="text-sm text-neutral-600">
        ยังไม่ได้ต่อเมนูจริง — จะทำในบทที่ 6 (หน้าเมนู) และบทที่ 7 (ตะกร้า + ส่งออร์เดอร์)
      </p>
    </main>
  );
}
