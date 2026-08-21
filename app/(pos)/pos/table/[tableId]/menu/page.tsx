import { redirect } from "next/navigation";

/**
 * เดิมหน้านี้เป็นตารางเมนูแยกหน้า แต่ design "Cafe POS" วางเมนูกับตะกร้าไว้จอเดียวกัน
 * ตารางเมนูจึงย้ายไปอยู่ที่ `/pos/table/[tableId]` แล้ว
 *
 * คงไฟล์นี้ไว้เป็นทางเปลี่ยนเส้นทาง เพราะเครื่อง POS หน้าร้านมักถูก bookmark ไว้
 * และหน้าเลือกตัวเลือก `menu/[itemId]` ยังอยู่ใต้เส้นทางนี้
 */
export default async function PosMenuRedirectPage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  redirect(`/pos/table/${tableId}`);
}
