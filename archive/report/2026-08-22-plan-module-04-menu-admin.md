# แผนก้อนถัดไป — โมดูล 04: จอหลังร้าน + จัดการเมนู (บทที่ 13 บางส่วน)

เขียนไว้ 2026-08-22 เพื่อส่งต่อข้าม session · **อ่านไฟล์นี้ก่อนเริ่มเขียนโค้ด**
ต่อจาก `report/2026-08-22-chapter-11-payment.md`

---

## 0. ขอบเขตที่ตกลงกับผู้ใช้แล้ว — อ่านก่อนอย่างอื่น

**อยู่ในก้อนนี้:**

- จอที่สี่ของระบบ: route group `(admin)` + หน้าล็อกจอ + cookie ใบที่สาม + RBAC
- CRUD เมนูครบสามชั้น: `MenuCategory` → `MenuItem` → `ModifierGroup`/`Modifier`
  (รวมการผูกกลุ่มตัวเลือกเข้ากับเมนูแบบ many-to-many)
- ปุ่มกด "ของหมด / มีของ" ที่กดได้จากหน้าลิสต์โดยตรง
- event realtime `menu.changed` ให้มือถือลูกค้าที่เปิดเมนูค้างอยู่เห็นเอง

**ไม่อยู่ในก้อนนี้** (แยกเป็นก้อนของตัวเองภายหลัง):

- ปุ่มส่วนลดบนหน้าคิดเงิน (สูตรพร้อมแล้ว รอ UI + จำกัดสิทธิ์ + เหตุผล + AuditLog)
- หน้าอ่าน `AuditLog`
- ตาราง `StaffSession` (เตะพนักงานออกทุกเครื่อง) และการย้าย rate limit PIN ไป Postgres
- จัดการพนักงาน (เพิ่ม/ลบ/เปลี่ยน PIN) — ยังใช้ seed อยู่
- ระบบอัปโหลดรูป (ตัดสินใจแล้วว่า **ใช้ช่องกรอก URL + พรีวิว** เพราะยังไม่มีที่เก็บไฟล์
  และ `images.remotePatterns` ยังต้องแคบในบทที่ 16 อยู่ดี)

**เหตุผลที่ตัดออก:** CLAUDE.md หัวข้อ 7 เขียนไว้เองว่า "ทำต่อทีละก้อน อย่าสั่งรวดเดียว
หลายบท (context จะเต็มแล้วเริ่มหลุดกฎ)" — ห้าชิ้นนี้แยกกันได้จริงและไม่มีชิ้นไหน
บล็อกอีกชิ้น

---

## 1. สิทธิ์ — ตกลงแล้ว

| ตำแหน่ง | เข้าจอ admin | กด "ของหมด/มีของ" | สร้าง/แก้/ลบ |
|---|---|---|---|
| OWNER | ✅ | ✅ | ✅ |
| MANAGER | ✅ | ✅ | ✅ |
| CASHIER | ✅ | ✅ | ❌ |
| SERVER | ✅ | ✅ | ❌ |
| KITCHEN | ✅ | ✅ | ❌ |

**ทำไมหน้าร้าน/ครัวต้องกดของหมดได้:** ของหมดเกิดกลางกะ คนที่รู้ก่อนคือคนที่ยืนอยู่
ในร้าน ไม่ใช่เจ้าของที่อยู่บ้าน ถ้าต้องโทรหาผู้จัดการเพื่อปิดเมนูหนึ่งตัว สุดท้าย
ร้านจะไม่ปิด แล้วลูกค้าจะสั่งของที่ไม่มี — ซึ่งแพงกว่าความเสี่ยงของการให้กด toggle ได้

**ทำไมครัวเข้าจอนี้ได้ ทั้งที่เข้า POS ไม่ได้:** ครัวคือคนแรกที่รู้ว่าวัตถุดิบหมด
(เห็นตู้เย็นก่อนใคร) ส่วนเหตุผลที่ครัวเข้า POS ไม่ได้คือ "ไม่ได้รับเงินและไม่ได้เปิดโต๊ะ"
ซึ่งเป็นคนละเรื่องกับการปิดเมนู

**ต้องเพิ่มใน `lib/rbac.ts`:**

```ts
export type StaffScreen = "pos" | "kds" | "admin";   // เพิ่ม "admin"

const SCREEN_ROLES = { ..., admin: ["OWNER","MANAGER","CASHIER","SERVER","KITCHEN"] };

/** สร้าง/แก้/ลบเมนู — เปลี่ยนราคาคือเปลี่ยนสิ่งที่ลูกค้าต้องจ่าย */
export function canEditMenu(role: StaffRole): boolean {
  return role === "OWNER" || role === "MANAGER";
}

/** กดของหมด/มีของ — ทุกคนที่เข้าจอได้ กดได้ (ดูเหตุผลด้านบน) */
export function canToggleMenuAvailability(role: StaffRole): boolean {
  return canAccessScreen(role, "admin");
}
```

⚠ พอเติม `"admin"` เข้า `StaffScreen` แล้ว **`tsc` จะพังทันที** ที่
`lib/staff-session-cookie.ts` เพราะ `Record<StaffScreen, string>` ยังไม่มีคีย์ `admin`
— นี่คือสิ่งที่ตั้งใจไว้ตั้งแต่บทที่ 8 ให้ compiler เตือนเอง ให้เติม
`admin: "admin_staff_session"` แล้วมันจะไล่ไปเองว่าต้องแก้ที่ไหนอีกบ้าง

---

## 2. รูปหน้าจอ — เลือกทางเลือก A แล้ว

**A. หน้าแยกต่อ entity + toggle ในบรรทัด** (RSC ล้วน, ฟอร์มยิง Server Action แล้ว redirect)

```
/admin/login                      ล็อกจอ (PIN) — คนละ cookie กับ POS/KDS
/admin                            หน้าแรก: ลิงก์ไปแต่ละโมดูล + สรุปสั้น ๆ
/admin/menu                       ลิสต์หมวด+เมนูทั้งหมด · toggle ของหมดในบรรทัด
/admin/menu/category/new|[id]     ฟอร์มหมวด
/admin/menu/item/new|[id]         ฟอร์มเมนู (ราคา/หมวด/สถานี/รูป/กลุ่มตัวเลือกที่ผูก)
/admin/modifiers                  ลิสต์กลุ่มตัวเลือก · toggle
/admin/modifiers/new|[id]         ฟอร์มกลุ่ม + ตัวเลือกย่อยในกลุ่มเดียวกัน
```

ที่ไม่เลือก B (master-detail จอเดียว) เพราะกลุ่มตัวเลือกเป็น many-to-many ที่ต้อง
กดข้ามเมนู พอยัดลงแพเนลเดียวจะพัน และ client state จะโตกว่าที่โปรเจกต์นี้เคยมี
ที่ไม่เลือก C (แก้ในบรรทัดทั้งหมด) เพราะ `required`/`minSelect`/`maxSelect`
ยัดลงบรรทัดไม่ไหว ต้องมี modal อยู่ดี

**ยืมข้อดีของ C มาจุดเดียว:** หน้าลิสต์มีปุ่ม toggle "ของหมด" เป็นฟอร์มเล็กในแถว
เพราะนั่นคือสิ่งเดียวที่พนักงานหน้าร้าน/ครัวทำได้ และเป็นงานที่ต้องกดกลางกะ

**หน้าตา:** ใช้ design system เดิม — แปะ `pos-skin` ที่ `app/(admin)/layout.tsx`
**จุดเดียว** เหมือนที่ `(pos)` กับ `(kds)` ทำ · **ห้ามย้าย token ขึ้น `:root`**
(CLAUDE.md หัวข้อ 6) · ไม่ต้องมี skin ใหม่ จอหลังร้านใช้ลุคเดียวกับ POS ได้

---

## 3. งานที่ต้องทำ เรียงตามลำดับ

### 3.1 จอที่สี่ (auth + shell)
- [ ] `lib/rbac.ts` — `"admin"` เข้า `StaffScreen`, `canEditMenu`, `canToggleMenuAvailability`
- [ ] `lib/staff-session-cookie.ts` — เติม `admin: "admin_staff_session"` (tsc บังคับ)
- [ ] `proxy.ts` — เพิ่ม `ADMIN_SESSION_REQUIRED = /^\/admin(?!\/login(\/|$))(\/|$)/`
      **ทดสอบด้วย `curl -o /dev/null -w "%{http_code} %{redirect_url}"` เสมอ** (CLAUDE.md หัวข้อ 4)
- [ ] `app/(admin)/admin/login/page.tsx` — ใช้ `components/pin-form.tsx` ที่มีอยู่แล้ว
- [ ] `app/(admin)/layout.tsx` — `pos-skin` + แถบข้าง/แถบบนของหลังร้าน
- [ ] `app/(admin)/admin/actions.ts` — `loginAction` / `logoutAction` ของจอนี้

### 3.2 ตรรกะ (`lib/server/menu-admin.ts` ใหม่)

**ห้ามยัดลง `lib/server/menu.ts`** — ไฟล์นั้นเป็นทาง "อ่าน" ของหน้าลูกค้าที่กรอง
`isAvailable` ทุกชั้นตั้งแต่ใน query ส่วนหลังร้านต้องเห็นของที่ปิดขายอยู่ด้วย
ถ้าเอามารวมไฟล์เดียวจะมี flag `includeUnavailable` วิ่งไปทุกฟังก์ชัน แล้ววันหนึ่ง
จะมีใครลืมส่ง แล้วเมนูที่ปิดอยู่จะโผล่บนมือถือลูกค้า

ฟังก์ชันที่ต้องมี (ทุกตัวรับ `staff: CurrentStaff` และกรอง `staff.branchId` เสมอ):

```ts
getMenuTree(branchId)                    // หมวด → เมนู (รวมที่ปิดขาย) + จำนวนกลุ่มตัวเลือก
getMenuItemForEdit(branchId, id)         // + กลุ่มตัวเลือกที่ผูกอยู่ + สถานีทั้งหมดให้เลือก
getModifierGroups(branchId)              // กลุ่ม + ตัวเลือกย่อย + จำนวนเมนูที่ใช้กลุ่มนี้
upsertCategory / upsertMenuItem / upsertModifierGroup
setMenuItemAvailability / setCategoryAvailability / setModifierAvailability
setMenuItemModifierGroups(itemId, groupIds[])   // ทั้งชุดในทรานแซกชันเดียว
moveSortOrder(entity, id, "up" | "down")
deleteEntity(...)                        // ดูกฎการลบข้อ 4.2
```

### 3.3 Realtime
- [ ] `lib/realtime-events.ts` — เพิ่ม `"menu.changed"`
- [ ] ยิงหลัง commit ทุกครั้งที่เมนู/หมวด/ตัวเลือกเปลี่ยน (`tableId: null` = ทั้งสาขา)
- [ ] **หน้าเมนูลูกค้า `/t/[tableCode]` ยังไม่มี `<LiveRefresh>` — ต้องเพิ่ม**
      ตรวจแล้ว: ตอนนี้มีอยู่ที่ `/t/[tableCode]/orders`, `(kds)/layout`, `/pos`,
      `/pos/table/[id]` และ `/pos/table/[id]/bill` เท่านั้น
      → หน้าโต๊ะของ POS จึงเห็นเมนูที่เพิ่งปิดขายเองอยู่แล้ว ไม่ต้องแก้อะไร
      ⚠ หน้าเมนูลูกค้าคือหน้าที่ถูกเปิดค้างไว้นานที่สุดในระบบ (ลูกค้านั่งอ่านเมนู)
      และโต๊ะหนึ่งมีหลายเครื่อง — `LiveRefresh` ถือ EventSource ค้างไว้ทุกเครื่อง
      ต้องยืนยันก่อนว่า SSE route รับ connection ค้างจำนวนนั้นไหว ถ้าไม่แน่ใจ
      ให้เลื่อนข้อนี้ออกไปก่อน แล้วปล่อยให้ลูกค้าเห็นของที่ปิดขายตอนกดเข้าเมนูรอบถัดไป
      (ตัว `addToCart()` กันของที่ `isAvailable=false` อยู่แล้ว จึงไม่มีทางสั่งของที่หมดได้จริง)

### 3.4 ทดสอบ
- [ ] `scripts/smoke-menu.ts` + `"smoke:menu"` — **สร้างข้อมูลของตัวเองแล้วลบทิ้ง
      ห้ามแตะเมนู seed** (สคริปต์อื่นทั้งหมดพึ่ง `seed-item-krapao` / `seed-item-water` อยู่)
- [ ] รัน smoke ทั้งห้าชุดเดิมให้ผ่านครบ (การเพิ่ม `"admin"` เข้า `StaffScreen` กระทบ
      `getCurrentStaff` ที่ทุกจอเรียก)
- [ ] audit ล้นแนวนอน 4 ความกว้าง (สคริปต์ CDP — ดู §6)

### 3.5 เอกสาร
- [ ] `report/2026-08-22-module-04-menu-admin.md`
- [ ] อัปเดต CLAUDE.md §6 (เพิ่มหัวข้อ) และ §7 (ชี้ก้อนถัดไป)
- [ ] `pos-sidebar.tsx` — โมดูล 04 ใส่ `href: "/admin/menu"` + `screen: "admin"`
      แล้วมันจะกดได้เอง (เป็นที่เดียวที่ต้องแก้ — ดูคอมเมนต์ในไฟล์)

---

## 4. การตัดสินใจเชิงออกแบบที่ต้องรู้ก่อนเขียนโค้ด

### 4.1 ไม่มี migration ในก้อนนี้

schema เมนูสามชั้นออกแบบไว้ครบตั้งแต่บทที่ 4 แล้ว (`sortOrder`, `isAvailable`,
`required`/`minSelect`/`maxSelect`, ตารางกลาง `MenuItemModifierGroup` ที่มี
`sortOrder` เฉพาะคู่เมนู-กลุ่ม) ก้อนนี้จึงเป็นการ **สร้าง UI ให้ของที่มีอยู่แล้ว**
ไม่ต้องแตะ `prisma/schema.prisma` เลย — ถ้าพบว่าต้องเพิ่มคอลัมน์ ให้หยุดคิดก่อนว่า
กำลังทำงานเกินขอบเขตอยู่หรือเปล่า

### 4.2 "ลบ" มีสองแบบ และต้องเลือกให้ถูกอัตโนมัติ

`onDelete: Restrict` ผูกไว้ทุกจุดที่ชนประวัติบิล (`OrderItem.menuItemId`,
`OrderItemModifier.modifierId`) — ถ้าเรียก `delete` ตรง ๆ กับเมนูที่เคยถูกสั่ง
Postgres จะโยน FK error ออกมาเป็นข้อความอังกฤษดิบ ๆ ให้พนักงานอ่าน

กติกา: **นับ `OrderItem` ที่อ้างถึงในทรานแซกชันก่อนเสมอ**

| เคยถูกสั่ง | สิ่งที่ทำ |
|---|---|
| 0 ครั้ง | ลบจริง (เมนูที่พิมพ์ผิด/สร้างทดลอง ต้องลบทิ้งได้ ไม่งั้นค้างตลอดกาล) |
| ≥ 1 ครั้ง | ปฏิเสธ พร้อมบอกว่า "เมนูนี้เคยถูกสั่งแล้ว ใช้ 'ปิดขาย' แทน" |

หมวดที่ยังมีเมนูอยู่ข้างใน → ห้ามลบ (บอกให้ย้ายเมนูออกก่อน) ·
กลุ่มตัวเลือกที่ยังผูกกับเมนู → ห้ามลบ (บอกว่าผูกอยู่กี่เมนู)

### 4.3 `parseMoneyInput()` ยังรับเลขติดลบไม่ได้

`Modifier.priceDelta` ติดลบได้โดยตั้งใจ ("ไม่เอาเนื้อ −10 บาท") แต่
`parseMoneyInput()` ที่เขียนไว้ในบทที่ 11 ตรวจด้วย `/^\d+$/` จึงคืน `null`
ทันทีที่เจอเครื่องหมายลบ → ต้องขยายให้รับ `-` นำหน้าได้ **พร้อมเคสทดสอบ**
และ `basePrice` ของเมนูต้อง **ไม่** ติดลบ (ตรวจที่ชั้นบน ไม่ใช่ในตัว parser)

### 4.4 กฎความถูกต้องของกลุ่มตัวเลือกที่ต้องกันไว้ฝั่ง server

ตรวจใน `upsertModifierGroup()` ทุกครั้ง (การซ่อนปุ่มไม่ใช่การกันสิทธิ์ และฟอร์ม
ถูกยิงตรงด้วย POST ได้):

- `maxSelect >= minSelect` และทั้งคู่ `>= 0`
- `required === true` → บังคับ `minSelect >= 1` (ไม่งั้นคำว่า "บังคับ" ไม่มีความหมาย)
- `maxSelect >= 1` เสมอ (กลุ่มที่เลือกอะไรไม่ได้เลยคือกลุ่มที่ไม่ควรมี)
- `minSelect <= จำนวนตัวเลือกที่ `isAvailable` ในกลุ่ม` — ไม่งั้นลูกค้าจะติดอยู่
  หน้าเลือกตัวเลือกโดยกดต่อไม่ได้ตลอดกาล **นี่คือเคสที่พังเงียบที่สุดในทั้งก้อนนี้**
  เพราะมันพังที่ "หน้าลูกค้า" ไม่ใช่ที่หน้าที่กดแก้

### 4.5 การเปลี่ยนราคาไม่กระทบบิลเก่า — แต่ต้องยืนยันด้วยเทสต์

ทุกคอลัมน์ที่ลงท้ายด้วย `Snapshot` ใน `OrderItem` ถูกคัดลอกไว้ตอนสั่งแล้ว
การขึ้นราคาจึงไม่ควรขยับบิลที่ปิดไปแล้ว — **ต้องมีเคสทดสอบยืนยันข้อนี้จริง ๆ**
(สร้างบิล → ปิดบิล → ขึ้นราคาเมนู → อ่านบิลเดิมแล้วยอดต้องเท่าเดิมทุกช่อง)
เป็นข้อที่ "เชื่อว่าถูกอยู่แล้ว" แต่ไม่เคยมีใครทดสอบ

### 4.6 AuditLog

เขียนทุกการเปลี่ยนแปลงเมนู ในทรานแซกชันเดียวกับการแก้:
`menu.item.create` · `menu.item.update` · `menu.item.availability` · `menu.item.delete`
(และชุดเดียวกันของ `category` / `modifier_group` / `modifier`)

metadata ต้องเก็บ **ค่าก่อนและหลังของราคา** เสมอ — เพราะการแอบขึ้น-ลงราคาชั่วคราว
คือช่องโกงที่เล่มยกไว้ในบทที่ 13 และเป็นสิ่งที่ตอบไม่ได้เลยถ้าไม่เก็บ ณ ตอนนั้น

### 4.7 `sortOrder` ด้วยปุ่มขึ้น/ลง ไม่ใช่ drag-and-drop

สลับค่ากับเพื่อนบ้านในทรานแซกชันเดียว · ทำงานได้แม้ JS ยังไม่โหลด · ไม่ต้องมี
client state · และไม่ต้องเขียน `sortOrder` ใหม่ทั้งตารางทุกครั้งที่ขยับหนึ่งแถว

⚠ `sortOrder` ของ seed ตั้งเป็น 1,2,3… แต่ **ไม่มีอะไรบังคับให้ไม่ซ้ำ** —
ถ้าเจอค่าซ้ำกันสองแถว การสลับจะไม่เกิดอะไรขึ้นเลยและดูเหมือนปุ่มเสีย
ให้ `moveSortOrder()` เรียงลำดับปัจจุบันด้วย `[sortOrder, id]` เสมอ แล้วเขียน
ค่าที่คำนวณใหม่ให้ทั้งคู่ ไม่ใช่สลับค่าเดิมมั่ว ๆ

---

## 5. กฎที่ห้ามพลาด (สรุปจากทุกก้อนที่ผ่านมา)

1. **ทุก Server Action ตรวจสิทธิ์เองบรรทัดแรก** — `getCurrentStaff("admin")`
   ต้องระบุหน้าจอเสมอ (cookie แยกใบต่อจอ)
2. **แก้หลายตารางพร้อมกัน = `$transaction` จริง** (ผูกกลุ่มตัวเลือก, สลับลำดับ, ลบ)
3. **`publishRealtimeEvent()` เรียกหลัง commit เท่านั้น**
4. **ไฟล์ `"use server"` export ได้เฉพาะ async function**
5. **คลาส design system (`ink-row`/`panel`/`btn`) + `hidden`/`lg:flex` = ไม่ทำงาน**
   (specificity 0-2-0 ชนะ utility 0-1-0) ถ้าต้องซ่อนตามขนาดจอ ให้ครอบด้วย `<div>` เปล่า
6. **เงินเป็นจำนวนเต็มหน่วยย่อยของสกุลสาขา** ห้ามหาร/คูณ 100 นอก `lib/money.ts`
   ห้ามเขียน "฿" ลงจอตรง ๆ — ใช้ `formatMoney(amount, branch.currency)`
7. **`lib/server/*` ต้องมี `import "server-only"`** และรันนอก Next ได้ด้วย
   `tsx --conditions=react-server`
8. **regex ใน `config.matcher` ของ `proxy.ts` ต้อง escape สองชั้น** (`"\\."`)
9. **รัน `prisma generate`/`migrate` ขณะ dev server เปิดอยู่ → ต้องรีสตาร์ท dev server**
   (ก้อนนี้ไม่มี migration จึงไม่น่าเจอ แต่ถ้าเจอ error `Jest worker ... retry limit`
   ให้ดู CLAUDE.md หัวข้อ 4)

---

## 6. คำสั่งที่ใช้บ่อย

```bash
npm run dev
npm run smoke:order && npm run smoke:pos && npm run smoke:kds && npm run smoke:bill && npm run smoke:payment
npm run dev:staff-cookie 001     # 001 เจ้าของ · 002 แคชเชียร์ · 003 เสิร์ฟ · 004 ครัว
npx tsc --noEmit && npx eslint && npm run build
```

**สคริปต์ audit ล้นแนวนอน** อยู่ใน scratchpad ของ session ก่อน (ไม่ได้ commit)
วิธี: เปิด Chrome `--headless=new --remote-debugging-port=9222` แล้วคุย CDP ผ่าน
`WebSocket` ที่มีใน Node 24 → `Network.setCookie` → `Emulation.setDeviceMetricsOverride`
(390/768/1024/1440) → `Runtime.evaluate` วัด `documentElement.scrollWidth > innerWidth`
Chrome อยู่ที่ `C:/Program Files/Google/Chrome/Application/chrome.exe`
⚠ ใน Git Bash ต้องนำหน้าด้วย `MSYS_NO_PATHCONV=1` ไม่งั้น path อย่าง `/admin/menu`
จะถูกแปลงเป็น `C:/Program Files/Git/admin/menu` แล้วผลที่วัดได้จะไม่มีความหมาย

---

## 7. หลังก้อนนี้เหลืออะไร

| ก้อน | เรื่อง |
|---|---|
| บทที่ 12 | ใบเสร็จ/ใบกำกับภาษีอย่างย่อ — เลขที่เดินต่อเนื่องแขวนที่ `Payment` |
| บทที่ 13 (ที่เหลือ) | ปุ่มส่วนลด · หน้าอ่าน AuditLog · `StaffSession` · จัดการพนักงาน |
| โมดูล 05 (บทที่ 14) | สต็อกวัตถุดิบรุ่นเรียบง่าย |
| โมดูล 06 (บทที่ 15) | X/Z report · ปิดกะนับเงินสด |
| บทที่ 16 | Deploy · `REALTIME_DRIVER=postgres` · แคบ `images.remotePatterns` |
