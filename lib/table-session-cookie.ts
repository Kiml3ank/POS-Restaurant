/**
 * ชื่อ cookie ที่ถือ token ของ TableSession (บทที่ 5)
 *
 * แยกออกมาเป็นไฟล์เล็ก ๆ ไฟล์นี้เพราะ proxy.ts ต้องใช้ค่าเดียวกัน แต่ห้าม
 * import อะไรที่มี `server-only` หรือแตะ Prisma เข้าไปใน proxy เด็ดขาด
 * (proxy รันก่อน render และอาจถูก deploy ไปอยู่ที่ edge/CDN)
 *
 * ไฟล์นี้จึงต้องมีแค่ค่าคงที่ล้วน ๆ ห้ามเพิ่ม logic ที่ต้องพึ่ง Node API
 */
export const TABLE_SESSION_COOKIE = "pos_table_session";
