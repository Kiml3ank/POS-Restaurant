-- สกุลเงินของสาขา: String -> enum Currency (บทที่ 10)
--
-- เขียน migration นี้ด้วยมือแทนที่จะให้ prisma generate ให้ เพราะตัว generator
-- เลือกวิธี "DROP คอลัมน์เดิมแล้วสร้างใหม่" ซึ่งทำให้ค่าที่มีอยู่หายทั้งตาราง
-- (บนเครื่อง dev มีสาขาเดียวจึงไม่รู้สึก แต่บน production คือสาขาทั้งหมด
--  กลับไปเป็นค่า default พร้อมกัน = ทุกสาขาที่ขายเป็นกีบ/ดอง กลายเป็นบาททันที)
--
-- ท่าที่ปลอดภัยคือ cast ในที่ ซึ่งทำได้เพราะค่าเดิมทุกค่าเป็นชื่อที่ตรงกับสมาชิก
-- ของ enum อยู่แล้ว ถ้ามีแถวไหนเป็นค่าอื่น คำสั่งนี้จะ error แล้ว transaction
-- ทั้งก้อน rollback — ซึ่งเป็นสิ่งที่ต้องการ ดีกว่าเงียบ ๆ แล้วข้อมูลเพี้ยน

CREATE TYPE "Currency" AS ENUM ('THB', 'LAK', 'VND');

ALTER TABLE "branches"
  ALTER COLUMN "currency" DROP DEFAULT,
  ALTER COLUMN "currency" TYPE "Currency" USING ("currency"::"Currency"),
  ALTER COLUMN "currency" SET DEFAULT 'THB';
