/**
 * หน้า POS พนักงาน (บทที่ 9-12)
 * เปิดโต๊ะ / สั่งแทนลูกค้า / ย้าย-รวมโต๊ะ / แยกบิล / คิดเงิน / รับเงิน
 *
 * ข้อควรระวัง: ย้ายและรวมโต๊ะต้องทำใน `prisma.$transaction()` เดียว
 * เพราะต้องย้ายออร์เดอร์ที่ยังไม่จ่ายทั้งชุดไปด้วย ไม่ใช่แค่เปลี่ยนเลขโต๊ะ
 */
export default function PosPage() {
  return (
    <main className="flex flex-1 flex-col gap-2 p-6">
      <p className="text-xs tracking-wide text-neutral-500 uppercase">เครื่องพนักงาน</p>
      <h1 className="text-2xl font-semibold">POS</h1>
      <p className="text-sm text-neutral-600">โครงหน้าจอ — เนื้อหาจริงอยู่ในบทที่ 9-12</p>
    </main>
  );
}
