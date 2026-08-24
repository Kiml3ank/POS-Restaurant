# Admin Back-Office Spec ↔ ของที่มีจริงในโปรเจกต์นี้

เขียน 2026-08-23 หลังผู้ใช้ส่ง `POS_Admin_Back_Office_Specification.md` (31 หัวข้อ) เข้ามา

ไฟล์นี้ทำหน้าที่เดียว: **บอกว่าแต่ละหัวข้อของ spec ตรงกับอะไรในระบบเรา ทำไปแล้วแค่ไหน
และอันไหนที่ "ไม่ควรทำตาม spec" เพราะเราเป็นร้านอาหาร ไม่ใช่ POS ทั่วไป**

คู่กับ `report/2026-08-22-admin-roadmap.md` (แผนที่เดิม เรียงตามหมวดของผู้ใช้)
— ไฟล์นี้เรียงตามเลขหัวข้อของ spec เพื่อให้ไล่ทีละข้อได้

สถานะ: ✅ ใช้ได้จริง · 🟡 มีข้อมูล/ตรรกะแล้ว รอหน้าจอ · 🔧 กำลังทำ · ❌ ยังไม่มี · ⛔ ตั้งใจไม่ทำตาม spec

---

## 1. ตารางเทียบทีละหัวข้อ

| § | หัวข้อใน spec | สถานะ | ตรงกับอะไรในระบบเรา / เหตุผลถ้าไม่ทำตาม |
|---|---|---|---|
| 1 | Dashboard | ❌ | ต้องมี Reports (บทที่ 15) ก่อน · Gross profit/Expenses ต้องมี cost price + โมดูลรายจ่าย |
| 2 | POS Monitoring | 🟡 | live orders ✅ · **reprint receipts ✅ (บทที่ 12)** · payments/voids ยังไม่มีหน้ารวม · refund ❌ ต้องออกแบบใหม่ |
| 3 | Order Management | 🟡 | ข้อมูลครบใน `Order`/`OrderItem` ยังไม่มีหน้าค้น · สถานะ spec ("Open/Preparing/Completed") ⛔ เราใช้ `OrderStatus` ของเล่มซึ่งละเอียดกว่าและผูกกับ KDS แล้ว **ห้ามเปลี่ยนชื่อสถานะตาม spec** |
| 4 | Product Management | ✅ / ⛔ | โมดูล 04 ทำแล้ว · **SKU/Barcode ⛔** เมนูอาหารไม่มีบาร์โค้ด (ของที่ต้องมี SKU คือ *วัตถุดิบ* ในบทที่ 14) · **Cost Price ❌ ต้องเพิ่ม** เพราะรายงานกำไรใช้ · Duplicate/Archive/Restore ❌ |
| 5 | Categories | ✅ | สร้าง/แก้/เรียง/ปิดขาย ครบ · Archive = `isAvailable=false` |
| 6 | Variants & Modifiers | ✅ | `ModifierGroup`/`Modifier` สามชั้น ครอบเคสของ spec ทั้งหมด · **⛔ ไม่ทำ "variant ที่เป็นสินค้าแยก SKU"** จนกว่าจะมีสต็อก |
| 7 | Inventory | ❌ | บทที่ 14 ทั้งหมวด |
| 8 | Recipes / Ingredients | ❌ | บทที่ 14 ขั้นสูง (spec เองก็บอกว่า optional) |
| 9 | Suppliers & Purchases | ❌ | **ของใหม่ที่ไม่มีทั้งใน e-book และ roadmap เดิม** ผูกกับสต็อก |
| 10 | Tables | 🟡 | สถานะ/ผังโต๊ะ ✅ · seats แก้จากจอไม่ได้ · **Transfer/Merge/Split ❌ ค้างจากบทที่ 9** · สถานะ `WAITING_PAYMENT`/`CLEANING` ยังไม่มีใน enum |
| 11 | Customers | ❌ | โมดูลใหม่ · **ต้องเป็นทางเลือก ไม่ใช่ทางบังคับ** และมีเรื่อง PDPA (ดู roadmap §3) |
| 12 | Employees | 🟡 | `Staff` + PIN hash มีแล้ว **เพิ่ม/แก้/รีเซ็ต PIN ได้จาก seed เท่านั้น** |
| 13 | Roles & Permissions | ✅ / ⛔ | `lib/rbac.ts` ตารางเดียวคุมทั้งระบบ · **⛔ ไม่ย้ายไป permission string แบบ `products.edit`** — ดูเหตุผลใน §3 |
| 14 | Shifts | ❌ | บทที่ 15 (X report / ปิดกะ / Z report) |
| 15 | Payments | ✅ / ⛔ | **มีหน้าจอแล้วที่ `/admin/receipts` (บทที่ 12)** — เลขที่ · เวลา · โต๊ะ · วิธีจ่าย · ยอด · คนรับเงิน + ตัวกรอง + แบ่งหน้า · **`PaymentStatus` ❌ ยังไม่มี** (โหมด demo ปิดบิลทันที) ต้องมีวันที่ต่อ gateway จริง · **E-wallet ⛔** |
| 16 | Expenses | ❌ | **ของใหม่ที่ไม่มีใน e-book** — เป็นงานบัญชี ต้องคุยขอบเขตก่อน (roadmap §3) |
| 17 | Promotions & Discounts | 🟡 | **ส่วนลดพนักงาน 10% ✅ (บทที่ 13a)** — ทุกตำแหน่งติดธงได้ บันทึกว่าใครกิน/ใครกด + AuditLog · **ปุ่มลดแบบกรอกเองยังไม่มี** (สูตรพร้อม รอเพดานตามตำแหน่ง + บังคับเหตุผล) · เอนจินโปรโมชันเต็มรูป ❌ |
| 18 | Reports | ❌ | บทที่ 15 · ข้อมูลดิบมีครบแล้วทุกตัว ยกเว้น product cost |
| 19 | Report Export | ❌ | CSV ทำได้ทันทีที่มี Reports · PDF/Excel ทีหลัง |
| 20 | Audit Logs | ✅ | **หน้าอ่านทำแล้วที่ `/admin/audit-logs` (บทที่ 13a)** — กรองวัน/action/พนักงาน/entityId + แบ่งหน้า + ไฮไลต์ action ที่ต้องจับตา · **เขียน `ipAddress` จริงแล้ว** · 9 action |
| 21 | Notifications | ❌ | **ของใหม่** · ท่อ SSE มีอยู่แล้วจึงถูกกว่าที่คิด |
| 22 | Settings | 🟡 | `Branch.currency/vatRateBp/serviceChargeBp/pricesIncludeVat/timezone` **ใช้งานจริงทั้งระบบแล้ว แต่แก้ได้จาก DB เท่านั้น** — ของถูกที่สุดที่ยังไม่ได้ทำ |
| 23 | Receipt & Hardware | ✅ / ⛔ | **บทที่ 12 เสร็จแล้ว** — ข้อมูลร้าน/ที่อยู่/เลขผู้เสียภาษี/ท้ายใบ/รูปแบบเลขที่ ครบบนใบ · **หน้าตั้งค่าให้แก้เองยังไม่มี** (แก้ได้จาก DB/seed) → รวมอยู่ในก้อน Settings · Printer/Cash drawer/Barcode ⛔ ต้องมีฮาร์ดแวร์จริง |
| 24 | Kitchen / KDS | ✅ / ❌ | จอครัว + routing ตามสถานี ✅ (บทที่ 8) · **หน้าตั้งค่า `Station` ❌** ตอนนี้แก้ได้จาก seed เท่านั้น |
| 25 | Backup & Data | ❌ | เป็นงาน ops ของ managed Postgres มากกว่างานในแอป · Data export = §19 |
| 26 | Security | ✅ / 🟡 | PIN hash (scrypt) ✅ · RBAC ฝั่ง server ✅ · Audit logs ✅ · **rate limit อยู่ใน memory ของ process ❌** · **ยกเลิก session ทันทีไม่ได้ ❌** ต้องมีตาราง `StaffSession` → **ทั้งสองอยู่ในก้อน 13b** |
| 27 | UX Principles | ✅ | design system "Modernist" ทำตามอยู่แล้ว (ตาราง/ฟอร์ม/ยืนยันก่อนทำสิ่งอันตราย/ข้อความสำเร็จ-ผิดพลาด) |
| 28 | Page Pattern | 🟡 | หน้าเดิมทำตามอยู่แล้ว ยกเว้น **Filters + Pagination ยังไม่มีที่ไหนเลย** เพราะยังไม่มีหน้าที่ข้อมูลเยอะ |
| 29 | MVP Scope | — | ดู §2 |
| 30 | Architecture | ✅ | backend เดียว (Prisma + `lib/server/*`) หน้าจอแยกตาม route group + cookie คนละใบ = ตรงกับ spec เป๊ะ |
| 31 | Definition of Done | 🟡 | ผ่านแล้ว **5/12** ข้อ (login · products · categories · payment records · **audit logs**) |

---

## 2. ของใหม่ที่ spec นี้เพิ่มเข้ามาจริง (ไม่มีทั้งใน e-book และ roadmap เดิม)

1. **Suppliers & Purchases** (§9) — ผูกกับสต็อก ทำพร้อมบทที่ 14
2. **Notifications** (§21) — ของหมด / ส่วนต่างเงินสด / รีฟันด์ก้อนใหญ่
3. **Backup & Data Management** (§25)
4. **Product Cost Price** (§4) — **จำเป็นจริง** เพราะ Dashboard/Reports ของ spec ขอ gross profit
5. **`PaymentStatus`** (§15) — Pending/Failed/Refunded
6. ~~**เขียนค่า `ipAddress` ลง AuditLog** (§20)~~ **ทำแล้วในบทที่ 13a**
7. **สถานะโต๊ะ `WAITING_PAYMENT` / `CLEANING`** (§10)
8. **หน้าตั้งค่าสถานีครัว** (§24)

ที่เหลือ (Customers · Promotions · Expenses · Recipes) roadmap เดิมระบุไว้แล้วว่าเป็นโมดูลนอกแผนเล่ม

---

## 3. สองข้อที่ตั้งใจ "ไม่ทำตาม spec" และเหตุผล

### 3.1 ⛔ ไม่ย้าย RBAC ไปเป็น permission string (`products.edit`, `pos.refund`, …)

spec §13 เสนอ permission แบบละเอียด ระบบเราใช้ **ตารางบทบาท → ความสามารถ** ใน `lib/rbac.ts`
ที่เดียวจบ และจะอยู่แบบนี้ต่อไป เพราะ:

- ร้านอาหารมีสี่ตำแหน่งที่นิยามชัดจากหน้าที่จริง (เจ้าของ/ผู้จัดการ/แคชเชียร์/เสิร์ฟ/ครัว)
  ไม่ใช่องค์กรที่ต้องประกอบสิทธิ์เองเป็นราย ๆ
- permission string ย้ายการตัดสินใจไปอยู่ใน **ข้อมูล** แปลว่า tsc ตรวจให้ไม่ได้อีกต่อไป
  ตอนนี้ถ้าเพิ่มหน้าจอใหม่แล้วลืมกำหนดสิทธิ์ **build พัง** ซึ่งเป็นสมบัติที่แลกทิ้งไม่คุ้ม
  (ตัวอย่างที่เกิดจริง: `Record<StaffScreen, string>` บังคับให้เติม cookie ของ admin ตอนโมดูล 04)
- เหตุผลของ *แต่ละ* ข้อจำกัดเขียนเป็นคอมเมนต์อยู่ข้าง ๆ กฎในไฟล์นั้น ซึ่งหายไปทันทีถ้าเป็นแถวใน DB

**สิ่งที่รับมาจาก spec แทน:** ประโยค *"Backend APIs must enforce permissions; hiding buttons
in the frontend is not sufficient"* — ข้อนี้ระบบเราทำอยู่แล้วทุกจุดและต้องทำต่อไป

### 3.2 ⛔ ไม่เปลี่ยนชื่อสถานะออร์เดอร์ตาม spec

spec §3 ใช้ `Draft/Open/Preparing/Ready/Completed/Cancelled/Refunded`
เราใช้ `DRAFT → PLACED → IN_PROGRESS → READY → SERVED → PAID` (+`CANCELLED`)
ซึ่งเป็น **data contract กลางที่ทั้งสี่หน้าจออ้างอิงร่วมกัน** และแยก `OrderItemStatus`
ออกมาต่างหากเพราะครัวทำงานที่ระดับรายการ — ละเอียดกว่าของ spec และเปลี่ยนไม่ได้แล้ว
โดยไม่รื้อ KDS ทั้งบท · `Refunded` จะมาเป็น **เอกสารใบใหม่** ไม่ใช่สถานะที่ย้อนบิลเดิม

---

## 4. ลำดับที่จะทำ (ปรับจาก roadmap §4 ให้ตรงกับ MVP Phase 1 ของ spec)

| # | ก้อน | ปลดล็อกหัวข้อไหนของ spec |
|---|---|---|
| 1 ✅ | **บทที่ 12 — ใบเสร็จ/ABB** (2026-08-23) | §2 (reprint) · §15 (payment records) · §23 (receipt) |
| 2a ✅ | **บทที่ 13a** — ส่วนลดพนักงาน · หน้าอ่าน AuditLog · เขียน IP (2026-08-23) | §17 (บางส่วน) · §20 |
| 2b 🔜 | **บทที่ 13b** — `StaffSession` · จัดการพนักงาน/รีเซ็ต PIN · ตัวนับ PIN ผิดลง DB | §12 · §13 · §26 |
| 3 | **หน้า Settings** — ธุรกิจ/ภาษี/สกุลเงิน/สถานีครัว | §22 · §24 · §23 (บางส่วน) — **ถูกที่สุดในลิสต์ ข้อมูลพร้อมหมดแล้ว** |
| 4 | **บทที่ 15 — รายงาน/ปิดกะ** + Export CSV | §1 · §14 · §18 · §19 |
| 5 | **ค้างจากบทที่ 9** — ย้าย/รวมโต๊ะ · แยกบิล | §10 |
| 6 | **บทที่ 14 — สต็อก (รุ่นเรียบง่าย)** + cost price | §4 (cost) · §7 · §9 |
| 7 | **Refunds** | §2 · §15 · §18 |
| 8 | Customers · Promotions · Expenses · Notifications | §11 · §16 · §17 · §21 |

**ข้อ 1-4 = "Definition of Done" ของ spec ครบเกือบทั้งหมด**
