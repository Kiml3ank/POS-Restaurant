# แผนก้อนถัดไป — บทที่ 12: ใบเสร็จ / ใบกำกับภาษีอย่างย่อ (ABB)

เขียน 2026-08-23 · design ผ่านการอนุมัติจากผู้ใช้แล้วทั้งสองส่วนก่อนเริ่มเขียนโค้ด

---

## 0. ขอบเขตที่ตกลงกับผู้ใช้แล้ว — อ่านก่อนอย่างอื่น

| ข้อ | ตกลงว่า |
|---|---|
| ชนิดเอกสาร | **ABB ใบเดียว** (ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ รวมเป็นใบเดียว) — ไม่ทำใบกำกับภาษีเต็มรูป ไม่ทำ e-Tax |
| เลขที่ | **ต่อเนื่องตลอดกาล ต่อสาขา ไม่รีเซ็ต** รูปแบบ `HQ-00000123` |
| รูปแบบพิมพ์ | **หน้าเว็บ + CSS print 80mm** ไม่สร้าง PDF ฝั่ง server ไม่ยิง ESC/POS |
| สาขา LAK/VND | **สลับคำหัวเอกสารตามสกุลเงิน** — THB = ABB มีเลขผู้เสียภาษี · อื่น ๆ = "ใบเสร็จรับเงิน" เฉย ๆ |
| หน้าค้นย้อนหลัง | **`/admin/receipts`** (หลังร้าน) |

**⚠ เนื้อหาภาษีในบทนี้ไม่ใช่คำแนะนำทางกฎหมาย** ต้องให้ผู้สอบบัญชี/สรรพากรตรวจก่อนใช้จริง
โดยเฉพาะวิธีปัดเศษที่กฎหมายไม่ได้บังคับตายตัว

---

## 1. สถานะปัจจุบัน (ของที่มีอยู่แล้ว ใช้ได้เลย)

- **`Payment`** — snapshot ครบทุกช่องที่ใบเสร็จต้องใช้: `subtotal` `discountAmount`
  `serviceChargeAmount` `vatAmount` `netAmount` `grandTotal` `receivedAmount` `changeAmount`
  `currency` `serviceChargeBp` `vatRateBp` `pricesIncludeVat` `paidByStaffId` `paidAt`
- **`getPayment()`** ใน `lib/server/payment.ts` — อ่าน Payment + บรรทัดสินค้าจาก snapshot ล้วน
  **ไม่แตะ `Branch` เลยยกเว้น timezone** ซึ่งเป็นรูปแบบที่ใบเสร็จต้องใช้ต่อ
- **`formatMoney(amount, currency)`** ใน `lib/money.ts` — รองรับ THB/LAK/VND แล้ว
- **`/pos/table/[id]/bill?paid=<id>`** — หน้าสรุปการรับเงินที่อ่านจาก snapshot อยู่แล้ว
  (บรรทัดที่เขียนคาไว้ว่า "ใบเสร็จ … อยู่ในบทที่ 12" คือจุดที่ต้องเปลี่ยนเป็นปุ่มจริง)
- **`Tenant.taxId`** มีคอลัมน์แล้ว **แต่ค่าว่าง** · **`Branch` ยังไม่มีที่อยู่/เบอร์โทร**
- ฐานข้อมูล dev ตอนนี้มี `Payment` อยู่ **1 แถว** สาขาเดียว (HQ/THB) → backfill ง่าย

---

## 2. การตัดสินใจเชิงออกแบบที่ทำไปแล้ว (ห้ามเปลี่ยนกลางทาง)

### 2.1 แยกตาราง `Receipt` ออกจาก `Payment`

`Payment` = **เงินที่ได้รับ** · `Receipt` = **เอกสารที่ออกให้ลูกค้า** แยกแล้วได้สามอย่าง
ที่รวมกันแล้วทำไม่ได้:

1. **snapshot ตัวตนผู้ขาย ณ วันที่ออก** — ร้านเปลี่ยนชื่อ/ย้ายที่อยู่/เพิ่งได้เลขผู้เสียภาษี
   ได้ แต่ใบที่พิมพ์ซ้ำปีหน้าต้องเหมือนใบที่ลูกค้าถืออยู่ (กฎเดียวกับที่ห้ามอ่านอัตราจาก `Branch`)
2. **นับ/สืบการพิมพ์ซ้ำ** (`printCount`, `firstPrintedAt`) — ไม่ใช่ข้อมูลการเงิน
3. **เอกสารใบถัดไปในอนาคต** — ใบลดหนี้ตอนทำ Refund จะเป็น `Receipt` อีกแถวที่อ้างใบเดิม
   **ไม่ใช่การแก้ใบเก่า** โครงนี้รองรับตั้งแต่ต้นโดยไม่ต้อง migrate ซ้ำ

### 2.2 เลขที่เดินด้วย `DocumentCounter` + increment ใน transaction เดียวกับการรับเงิน

```ts
const counter = await tx.documentCounter.update({
  where: { branchId_series: { branchId, series: "ABB" } },
  data:  { lastSeq: { increment: 1 } },
  select: { lastSeq: true },
});
```

สามสมบัติที่ได้มาจากการวางไว้ตรงนี้:

| สมบัติ | ได้มายังไง |
|---|---|
| เลขไม่ซ้ำแม้สองเครื่องกดพร้อมกัน | row lock ของ Postgres บนแถวเดียว |
| **เลขไม่ขาดเมื่อการรับเงินล้มเหลว** | `PaymentAbort` rollback ทั้ง transaction → increment ย้อนด้วย |
| ไม่มีบิลที่จ่ายแล้วแต่ไม่มีใบเสร็จ | commit พร้อมกันหรือไม่เกิดเลย |

**ออกใบอัตโนมัติตอนรับเงิน ไม่ใช่ตอนกดพิมพ์** — ถ้าให้ "กดพิมพ์ = ออกเลข"
แคชเชียร์เลี่ยงการออกใบได้ และเลขจะขาดเป็นรู ซึ่งเป็นสิ่งเดียวที่ตรวจสอบไม่ผ่านแน่ ๆ

**ราคาที่จ่าย:** การรับเงินของสาขาเดียวกันเข้าคิวกันที่แถว counter แถวเดียว —
เป็น **ต้นทุนที่หลีกเลี่ยงไม่ได้ของคำว่า "เลขต่อเนื่อง"** ไม่ใช่ข้อบกพร่องของ design

### 2.3 `kind` ถูก snapshot ตอนออกใบ ไม่ derive ตอน render

`currency === "THB"` → `TAX_ABB` · อื่น ๆ → `RECEIPT`
เพราะวันที่กฎหมายเปลี่ยนหรือสาขาเปลี่ยนสกุลเงิน ใบเก่าต้องไม่เปลี่ยนหัวตาม

### 2.4 สองเส้นทางบาง ๆ บนคอมโพเนนต์ตัวเดียว — ไม่สร้าง auth แบบที่สี่

```
app/(pos)/pos/receipt/[receiptId]/page.tsx        ← cookie pos
app/(admin)/admin/receipts/[receiptId]/page.tsx   ← cookie admin
        ↓ ทั้งคู่ render ตัวเดียวกัน
components/receipt-document.tsx
```

**ไม่ทำ `/receipt/[id]` ที่รับ cookie ใบไหนก็ได้** เพราะเป็นการเพิ่มรูปแบบ auth แบบที่สี่
เข้ามาในระบบที่มีกติกาเดียวชัด ๆ ว่า "หนึ่งจอ = หนึ่ง cookie = หนึ่งกฎใน `proxy.ts`"
→ **`proxy.ts` ไม่ต้องแก้เลย** · ท่าเดียวกับ `components/item-options-form.tsx`

### 2.5 สิทธิ์แยกเป็นสอง ไม่ใช่หนึ่ง

| ฟังก์ชัน | ใคร | เหตุผล |
|---|---|---|
| `canReprintReceipt` | OWNER · MANAGER · CASHIER | ลูกค้าขอใบซ้ำที่เคาน์เตอร์เป็นเรื่องปกติทุกวัน (ชุดเดียวกับ `canTakePayment`) |
| `canBrowseReceipts` | OWNER · MANAGER | ลิสต์ย้อนหลัง = **เห็นยอดขายทั้งสาขา** คนละเรื่องกับพิมพ์ใบของบิลที่เพิ่งรับเงิน |

---

## 3. งานที่ต้องทำ เรียงตามลำดับ

### 3.1 Schema + migration

- `enum ReceiptKind { TAX_ABB, RECEIPT }`
- `model Receipt` — `id` `branchId` `paymentId @unique` `series` `seq` `number @unique`
  `kind` · snapshot ผู้ขาย: `sellerName` `sellerTaxId` `sellerBranchName` `sellerAddress`
  `sellerPhone` · `issuedAt` `printCount` `firstPrintedAt` `lastPrintedAt`
  · `@@unique([branchId, series, seq])`
- `model DocumentCounter` — `branchId` `series` `lastSeq` · `@@unique([branchId, series])`
- `Branch` เพิ่ม `addressLine String?` `phone String?`
- **onDelete:** `Payment → Receipt` = **Restrict** (ลบการรับเงินแล้วเอกสารหายตามไม่ได้)
  `Branch → Receipt` = Cascade (สายความเป็นเจ้าของ)
- **migration ต้องเขียน SQL backfill เอง** — ออกเลขให้ `Payment` ที่มีอยู่เรียงตาม `paidAt`
  แล้วตั้ง `lastSeq` ให้ตรงกัน **ห้ามปล่อยให้มี Payment ที่ไม่มีใบเสร็จ**
- `prisma/seed.ts` — ใส่ `taxId`, ที่อยู่/เบอร์สาขา, แถว `DocumentCounter`

**⚠ รัน `prisma migrate` ขณะ `npm run dev` เปิดอยู่ = ต้องรีสตาร์ท dev server เสมอ**

### 3.2 ตรรกะ

- `lib/receipt.ts` *(ไม่มี `server-only` — client ใช้แสดงผล)*
  `formatReceiptNumber(branchCode, seq)` · `RECEIPT_KIND_TITLE` · `receiptKindForCurrency()`
- `lib/server/receipt.ts`
  - `issueReceipt(tx, ...)` — เรียกจากใน transaction เท่านั้น
  - `getReceipt(branchId, receiptId)` — คืน Receipt + Payment + บรรทัดสินค้า (ใช้ `getPayment` ซ้ำ)
  - `listReceipts(staff, filters)` — กรองวัน/วิธีจ่าย/เลขที่ + แบ่งหน้า + ตรวจ `canBrowseReceipts`
  - `recordReceiptPrint(staff, receiptId)` — ตรวจ `canReprintReceipt` → `printCount++` + AuditLog
- `lib/server/payment.ts` — เรียก `issueReceipt()` **ใน `$transaction` เดิม** หลังสร้าง `Payment`
- `lib/rbac.ts` — สองฟังก์ชันใน §2.5

### 3.3 หน้าจอ

- `components/receipt-document.tsx` — ตัวใบเสร็จ ใช้ร่วมสองเส้นทาง รับ prop `copy: boolean`
- `app/(pos)/pos/receipt/[receiptId]/page.tsx` · `app/(admin)/admin/receipts/[receiptId]/page.tsx`
- `app/(admin)/admin/receipts/page.tsx` — ลิสต์ + ตัวกรอง + แบ่งหน้า
- `app/(admin)/admin/_components/admin-nav.tsx` — เพิ่มลิงก์ "ใบเสร็จ"
- `app/(pos)/pos/table/[tableId]/bill/page.tsx` — เปลี่ยนข้อความคาไว้เป็นปุ่มจริง
- `app/globals.css` — บล็อก `@media print`

**⚠ กับดักที่ต้องแก้ก่อน ไม่ใช่หลัง:** เชลล์ของ `(pos)`/`(admin)` เป็น `h-dvh overflow-hidden`
สั่งพิมพ์ตรง ๆ จะได้หน้าเดียวเท่าความสูงจอแล้วตัดที่เหลือทิ้ง `@media print` ต้องปลดเชลล์
(`height: auto`, `overflow: visible`), ซ่อน `[data-print-hide]`, และตั้ง `@page { size: 80mm auto }`

**นับการพิมพ์ด้วยปุ่ม ไม่ใช่ `onafterprint`** (ยิงตอนกด Ctrl+P เองด้วย และแต่ละเบราว์เซอร์ไม่ตรงกัน)
ปุ่ม → Server Action → `printCount++` + AuditLog → **แล้วค่อย** `window.print()`
ใบที่พิมพ์ครั้งที่ 2 ขึ้นไปขึ้นคำว่า **"สำเนา"**

### 3.4 ทดสอบ — `npm run smoke:receipt` (ใช้โต๊ะ A4 เพื่อไม่ชนชุดเดิม)

1. เลขต่อเนื่องจริง — รับเงิน 3 ครั้งได้ 1,2,3 ไม่ข้าม
2. สองเครื่องกดพร้อมกัน (`Promise.all`) — ได้สองเลขต่างกัน ไม่ซ้ำ ไม่ข้าม
3. **การรับเงินที่ล้มเหลวไม่กินเลข** — ยิงเคส `PaymentAbort` แล้วรับเงินจริง ต้องได้เลขถัดไปพอดี
4. snapshot แข็งจริง — ออกใบ → เปลี่ยนชื่อ/ที่อยู่สาขา + `vatRateBp` → อ่านใบเดิมได้ค่าเดิมเป๊ะ
5. VND ได้ `RECEIPT` ไม่ใช่ `TAX_ABB` และไม่มีคำว่าภาษี/เลขผู้เสียภาษีบนใบ
6. ยอดบนใบ = `Payment` ไม่ใช่ผลบวก `Order` (assert ตรง ๆ)
7. `printCount` + AuditLog เพิ่มทีละ 1 · ใบที่ 2 ขึ้น "สำเนา"
8. RBAC — SERVER/KITCHEN เรียก `recordReceiptPrint`/`listReceipts` ตรง ๆ ต้องถูกปฏิเสธ

**และ:** ขับผ่าน HTTP จริงด้วย `dev:staff-cookie` · วัด overflow **ทั้งแนวนอนและแนวตั้ง**
· รัน smoke ทั้งหกชุดเดิมซ้ำ (299 เคส) ต้องไม่มีตัวไหนเสีย

### 3.5 เอกสาร

`report/2026-08-23-chapter-12-receipt.md` + อัปเดต `CLAUDE.md` หัวข้อ 6/7
+ อัปเดต `docs/admin/spec-vs-current.md` (§2 §15 §23)

---

## 4. กฎที่ห้ามพลาด (สรุปจากทุกก้อนที่ผ่านมา)

- เงินเป็น **จำนวนเต็มหน่วยย่อยของสกุลนั้น** ห้ามหาร 100 นอก `lib/money.ts`
  ห้ามเขียนสัญลักษณ์สกุลเงินตรง ๆ ต้อง `formatMoney(amount, currency)`
- ใบเสร็จอ่านยอดจาก **`Payment` เท่านั้น** ห้ามใช้ผลบวกของ `Order` ห้ามกลับไปอ่านอัตราจาก `Branch`
- `publishRealtimeEvent()` เรียก **หลัง commit** ห้ามเรียกใน `$transaction`
- ต้อง `throw` เพื่อ rollback ห้าม `return` ในกลาง transaction ของการรับเงิน
- ไฟล์ `"use server"` export ได้เฉพาะ async function
- `.pos-skin .xxx` มี specificity 0-2-0 **ชนะ utility คลาสเดียวของ Tailwind** —
  จะซ่อน/แสดงตามขนาดจอ ต้องครอบด้วย div เปล่า
- ทุกที่ที่ล้างโต๊ะต้องลบตามลำดับ **ออร์เดอร์ → การรับเงิน → รอบโต๊ะ**
  → **บทนี้เพิ่มชั้นใหม่: ใบเสร็จ → การรับเงิน** ต้องแก้ `dev:reset-table` และ smoke ทุกชุด
- วัด overflow ต้องวัด **แนวตั้งด้วย** ไม่ใช่แนวนอนอย่างเดียว (บทเรียนจากบั๊ก `sr-only`)
- **สคริปต์ที่ส่ง path เป็น argument ผ่าน Git Bash ต้องตั้ง `MSYS_NO_PATHCONV=1`**
  ไม่งั้น `/admin/menu` จะกลายเป็น `C:/Program Files/Git/admin/menu` แบบเงียบ ๆ
