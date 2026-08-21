/**
 * จอครัว (บทที่ 8)
 *
 * realtime ใช้ SSE ผ่าน Route Handler เท่านั้น — ห้ามใช้ WebSocket ตรง ๆ
 * เพราะ Route Handler ของ Next.js อัปเกรด connection เป็น WebSocket ไม่ได้
 * และ Vercel ถือ TCP connection ค้างไว้ไม่ได้
 */
export default function KdsPage() {
  return (
    <main className="flex flex-1 flex-col gap-2 p-6">
      <p className="text-xs tracking-wide text-neutral-400 uppercase">จอครัว</p>
      <h1 className="text-2xl font-semibold">KDS</h1>
      <p className="text-sm text-neutral-400">โครงหน้าจอ — SSE + แยกสถานีจะทำในบทที่ 8</p>
    </main>
  );
}
