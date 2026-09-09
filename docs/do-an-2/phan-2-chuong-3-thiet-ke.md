## CHƯƠNG 3: PHÁT TRIỂN PHẦN MỀM HỆ THỐNG

### 3.1. Tổng quan về thiết kế hệ thống

Sau khi hoàn thành giai đoạn phân tích và đặc tả yêu cầu phần mềm, giai đoạn thiết kế hệ thống đóng vai trò chuyển đổi các yêu cầu đó thành một mô hình kỹ thuật cụ thể nhằm phục vụ cho việc triển khai hệ thống.

Đối với hệ thống POS nhà hàng, việc thiết kế phần mềm không chỉ tập trung vào các chức năng riêng lẻ mà còn phải đảm bảo sự liên kết chặt chẽ, đồng bộ theo thời gian thực giữa các thành phần như màn hình khách hàng, màn hình bếp và màn hình nhân viên. Do đó, hệ thống được thiết kế theo hướng module hóa theo nghiệp vụ (thực đơn, bàn, bếp, thanh toán, hóa đơn, nhân viên, cấu hình, báo cáo), trong đó mỗi module được xây dựng thành các hàm nghiệp vụ riêng biệt trong lớp xử lý phía máy chủ, nhưng vẫn tương tác nhất quán thông qua một cơ sở dữ liệu chung.

Việc thiết kế hệ thống cần đảm bảo các tiêu chí sau:

- Tính chính xác và đầy đủ theo yêu cầu, đặc biệt là độ chính xác tuyệt đối trong tính toán tiền tệ
- Tính dễ mở rộng và bảo trì
- Tính hiệu quả trong đồng bộ dữ liệu thời gian thực giữa nhiều màn hình
- Tính bảo mật và phân quyền rõ ràng theo từng vai trò nhân viên

### 3.2. Thiết kế kiến trúc hệ thống

Hệ thống được xây dựng trên nền tảng **Next.js (App Router)** — một framework full-stack cho phép giao diện và mã xử lý phía máy chủ cùng tồn tại trong một dự án duy nhất. Kiến trúc hệ thống vẫn được tổ chức theo mô hình phân lớp gồm ba lớp, ánh xạ trực tiếp vào cấu trúc thư mục của dự án:

**a) Lớp giao diện (Presentation Layer)**

- Được xây dựng bằng React Server Components và Client Components.
- Phần lớn giao diện là Server Component (đọc dữ liệu trực tiếp và render sẵn HTML trên máy chủ), chỉ những phần cần tương tác tức thời (giỏ hàng, biểu mẫu, nút bấm) mới là Client Component.
- Tương ứng với bốn nhóm màn hình: khách hàng (`app/(customer)`), nhân viên phục vụ/thu ngân (`app/(pos)`), bếp (`app/(kds)`), và hậu đài (`app/(admin)`).

**b) Lớp xử lý nghiệp vụ (Business Logic Layer)**

- Nằm trong thư mục `lib/server/`, mỗi tệp phụ trách một nhóm nghiệp vụ (thực đơn, giỏ hàng, bàn, bếp, tính tiền, thanh toán, hóa đơn, nhân viên, cấu hình...).
- Được gọi từ giao diện thông qua **Server Actions** (hàm bất đồng bộ đánh dấu `"use server"`), là cơ chế của Next.js cho phép giao diện gọi thẳng hàm phía máy chủ mà không cần tự dựng REST API.
- Đảm bảo các quy tắc nghiệp vụ, ví dụ: không cho tạo đơn hàng nếu chưa có phiên gọi món hợp lệ; không cho thanh toán nếu giỏ hàng còn món chưa gửi bếp; không cho truy cập màn hình nhân viên nếu chưa đăng nhập bằng mã PIN.

**c) Lớp truy cập dữ liệu (Data Layer)**

- Sử dụng **Prisma ORM** để giao tiếp với cơ sở dữ liệu **PostgreSQL**.
- Toàn bộ truy cập dữ liệu đi qua một client Prisma dùng chung (`lib/server/db.ts`), được đánh dấu `import "server-only"` để đảm bảo không có Client Component nào vô tình import trực tiếp vào cơ sở dữ liệu.
- Thực hiện các thao tác CRUD, và với các nghiệp vụ ảnh hưởng nhiều bảng cùng lúc (chuyển bàn, gộp bàn, thanh toán và phát hành hóa đơn), toàn bộ được bọc trong một giao dịch cơ sở dữ liệu (`$transaction`) duy nhất để đảm bảo tính toàn vẹn.

Mô hình phân lớp này giúp tách biệt các thành phần của hệ thống: khi cần thay đổi giao diện (ví dụ thiết kế lại màn hình bếp), lớp xử lý nghiệp vụ và lớp dữ liệu không cần thay đổi.

### 3.3. Thiết kế chi tiết các module

Hệ thống được chia thành các module nghiệp vụ chính như sau, tương ứng với các tệp trong `lib/server/`:

#### 3.3.1. Module xác thực và phân quyền

- Đăng nhập/đăng xuất bằng mã số nhân viên và mã PIN (không dùng mật khẩu truyền thống)
- Giới hạn số lần nhập sai PIN liên tiếp, tạm khóa đăng nhập khi vượt ngưỡng
- Phân quyền theo 5 vai trò: Chủ quán, Quản lý, Thu ngân, Phục vụ, Bếp
- Phiên đăng nhập có thể bị thu hồi ngay lập tức từ xa (đặt lại PIN hoặc vô hiệu hóa tài khoản)

#### 3.3.2. Module quản lý thực đơn

- Quản lý thực đơn ba lớp: danh mục → món ăn → nhóm tùy chọn (kèm tùy chọn con có thể cộng/trừ giá)
- Thêm/sửa món ăn, danh mục, nhóm tùy chọn; tìm kiếm và lọc theo danh mục
- Ngừng bán món thay vì xóa nếu món đã từng được đặt (bảo toàn dữ liệu lịch sử)

#### 3.3.3. Module quản lý bàn và điểm bán hàng

- Tạo bàn mới, sinh mã QR ngẫu nhiên duy nhất, phát hành lại mã QR khi cần
- Chuyển bàn, gộp bàn trong một giao dịch duy nhất (không tách rời từng phần)
- Quản lý điểm bán không phải bàn ngồi (quầy mang về, tính theo số thứ tự, không tính phí dịch vụ)

#### 3.3.4. Module gọi món và quản lý đơn hàng (POS)

- Mở bàn, tham gia/gộp phiên gọi món khi nhiều khách cùng bàn
- Gọi món thay khách hàng, xem giỏ hàng, gửi đơn vào bếp
- Đánh dấu món đã phục vụ lên bàn; hủy món (giới hạn theo vai trò, bắt buộc nhập lý do, ghi nhật ký)

#### 3.3.5. Module quản lý bếp (Kitchen Display System)

- Hiển thị danh sách món cần chế biến theo từng trạm, cập nhật theo thời gian thực qua Server-Sent Events (SSE)
- Chuyển trạng thái món theo một chiều: đã nhận → đang làm → đã xong
- Trạng thái tổng thể của đơn hàng được suy ra tự động từ trạng thái các món con

#### 3.3.6. Module tính tiền, thanh toán và hóa đơn

- Tính hóa đơn theo đúng thứ tự phí dịch vụ trước, thuế sau, toàn bộ bằng số nguyên
- Thanh toán bằng tiền mặt hoặc mã QR (chế độ minh họa), có cơ chế chống thanh toán trùng
- Phát hành hóa đơn với số thứ tự liên tục theo chi nhánh, lưu cố định thông tin người bán tại thời điểm phát hành; hỗ trợ in lại

#### 3.3.7. Module quản lý nhân viên

- Tạo, chỉnh sửa thông tin, đặt lại mã PIN, vô hiệu hóa tài khoản nhân viên
- Gán vai trò theo nguyên tắc chỉ được gán vai trò thấp hơn hoặc bằng cấp của người thao tác
- Không cho phép nhân viên tự sửa hoặc tự vô hiệu hóa chính tài khoản mình từ màn hình quản lý

#### 3.3.8. Module hậu đài và báo cáo doanh thu

- Trang tổng quan hiển thị doanh thu trong ngày (tính theo số tiền thực thu), món ăn bán chạy, tình trạng bàn hiện tại
- Tra cứu danh sách hóa đơn đã phát hành theo thời gian

#### 3.3.9. Module cấu hình hệ thống và nhật ký kiểm toán

- Cấu hình thông tin quán, trạm chế biến, thuế VAT, phí dịch vụ, tỉ lệ giảm giá nhân viên, đơn vị tiền tệ
- Ghi nhật ký kiểm toán cho mọi thao tác nhạy cảm liên quan đến tiền bạc, kèm giá trị trước và sau khi thay đổi

> **Ghi chú:** module quản lý tồn kho/giá vốn nguyên liệu theo đúng nghĩa (nhập/xuất kho, cảnh báo hết hàng theo số lượng) **chưa được triển khai đầy đủ** trong phạm vi đề tài — hiện tại chỉ dừng ở mức đánh dấu món "còn bán/ngừng bán". Đây là hướng phát triển được trình bày ở Phần III.

### 3.4. Thiết kế cơ sở dữ liệu

Cơ sở dữ liệu được thiết kế trên PostgreSQL thông qua Prisma ORM. **Toàn bộ cột lưu giá trị tiền tệ đều dùng kiểu số nguyên (Int)**, biểu diễn theo đơn vị nhỏ nhất của tiền tệ (ví dụ 6000 = 60.000 ₫ hoặc 60,00 ฿ tùy chi nhánh), **không sử dụng kiểu số thực/thập phân** cho bất kỳ giá trị tiền nào, nhằm loại bỏ hoàn toàn sai số làm tròn trong tính toán tài chính — đây là nguyên tắc thiết kế bắt buộc xuyên suốt toàn bộ hệ thống.

#### 3.4.1. Bảng BRANCH (Chi nhánh)

| Tên trường | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | String (cuid) | PRIMARY KEY | Mã định danh chi nhánh |
| tenantId | String | FOREIGN KEY, NOT NULL | Tham chiếu đến chủ sở hữu hệ thống |
| code | String | NOT NULL | Mã chi nhánh (duy nhất trong một tenant) |
| name | String | NOT NULL | Tên chi nhánh |
| currency | Enum | NOT NULL, DEFAULT 'THB' | Đơn vị tiền tệ (THB/LAK/VND) |
| vatRateBp | Int | NOT NULL | Thuế VAT tính theo phần vạn (basis point) |
| serviceChargeBp | Int | NOT NULL | Phí dịch vụ tính theo phần vạn |
| pricesIncludeVat | Boolean | NOT NULL | Giá niêm yết đã gồm VAT hay chưa |
| timezone | String | NOT NULL | Múi giờ của chi nhánh |

#### 3.4.2. Bảng RESTAURANT_TABLE (Bàn / điểm bán hàng)

| Tên trường | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | String (cuid) | PRIMARY KEY | Mã định danh bàn |
| branchId | String | FOREIGN KEY, NOT NULL | Chi nhánh sở hữu |
| name | String | NOT NULL, UNIQUE (theo branchId) | Tên bàn hiển thị |
| tableCode | String | UNIQUE (toàn hệ thống) | Mã QR duy nhất, sinh ngẫu nhiên |
| seats | Int | DEFAULT 4 | Số chỗ ngồi |
| kind | Enum | DEFAULT 'DINE_IN' | Loại điểm bán: bàn ngồi / quầy mang về / ship |
| isActive | Boolean | DEFAULT true | Còn hoạt động hay đã ngừng |

#### 3.4.3. Bảng TABLE_SESSION (Phiên gọi món)

| Tên trường | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | String (cuid) | PRIMARY KEY | Mã phiên gọi món |
| branchId | String | FOREIGN KEY, NOT NULL | Chi nhánh |
| tableId | String | FOREIGN KEY, NOT NULL | Bàn/điểm bán liên kết |
| token | String | UNIQUE | Mã phiên, lưu trong cookie trình duyệt khách hàng |
| status | Enum | NOT NULL | OPEN / CLOSED / ABANDONED / MERGED |
| pax | Int | NOT NULL | Số lượng khách |
| expiresAt | DateTime | NOT NULL | Thời điểm hết hạn (chỉ áp dụng cho phía khách hàng) |
| queueNumber | Int | NULLABLE | Số thứ tự (chỉ dùng cho quầy mang về) |

#### 3.4.4. Bảng MENU_CATEGORY (Danh mục món)

| Tên trường | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | String (cuid) | PRIMARY KEY | Mã danh mục |
| branchId | String | FOREIGN KEY, NOT NULL | Chi nhánh |
| name | String | NOT NULL | Tên danh mục |
| sortOrder | Int | DEFAULT 0 | Thứ tự hiển thị |
| isAvailable | Boolean | DEFAULT true | Còn hiển thị cho khách hay không |

#### 3.4.5. Bảng MENU_ITEM (Món ăn)

| Tên trường | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | String (cuid) | PRIMARY KEY | Mã món ăn |
| branchId | String | FOREIGN KEY, NOT NULL | Chi nhánh |
| categoryId | String | FOREIGN KEY, NOT NULL | Danh mục thuộc về |
| stationId | String | FOREIGN KEY, NULLABLE | Trạm chế biến (NULL = không qua bếp) |
| name | String | NOT NULL | Tên món |
| description | String | NULLABLE | Mô tả món |
| basePrice | Int | NOT NULL | Giá gốc (số nguyên, đơn vị nhỏ nhất) |
| isAvailable | Boolean | DEFAULT true | Còn bán hay đã ngừng bán |

#### 3.4.6. Bảng MODIFIER_GROUP / MODIFIER (Nhóm tùy chọn / Tùy chọn)

| Tên trường | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id (MODIFIER_GROUP) | String (cuid) | PRIMARY KEY | Mã nhóm tùy chọn (VD: "Độ cay") |
| required | Boolean | NOT NULL | Bắt buộc chọn hay không |
| minSelect / maxSelect | Int | NOT NULL | Số lượng chọn tối thiểu / tối đa |
| id (MODIFIER) | String (cuid) | PRIMARY KEY | Mã tùy chọn con (VD: "Cay nhiều") |
| modifierGroupId | String | FOREIGN KEY, NOT NULL | Nhóm tùy chọn thuộc về |
| priceDelta | Int | DEFAULT 0 | Mức cộng/trừ giá (có thể âm) |

Một món ăn liên kết với nhiều nhóm tùy chọn thông qua bảng trung gian `MENU_ITEM_MODIFIER_GROUP` (quan hệ nhiều-nhiều), cho phép một nhóm tùy chọn (ví dụ "Độ cay") dùng chung cho nhiều món khác nhau.

#### 3.4.7. Bảng ORDER (Đơn hàng)

| Tên trường | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | String (cuid) | PRIMARY KEY | Mã đơn hàng |
| branchId | String | FOREIGN KEY, NOT NULL | Chi nhánh |
| tableSessionId | String | FOREIGN KEY, NULLABLE | Phiên gọi món liên kết |
| tableId | String | FOREIGN KEY, NULLABLE | Bàn tại thời điểm đặt (snapshot) |
| placedByStaffId | String | FOREIGN KEY, NULLABLE | Nhân viên gửi đơn hộ (nếu có) |
| paymentId | String | FOREIGN KEY, NULLABLE | Khoản thanh toán đã chi trả cho đơn này |
| orderNumber | String | NOT NULL | Số đơn hiển thị (theo ngày, reset mỗi ngày) |
| status | Enum | NOT NULL | DRAFT/PLACED/IN_PROGRESS/READY/SERVED/PAID/CANCELLED |

#### 3.4.8. Bảng ORDER_ITEM (Chi tiết đơn hàng)

| Tên trường | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | String (cuid) | PRIMARY KEY | Mã dòng món |
| orderId | String | FOREIGN KEY, NOT NULL | Đơn hàng thuộc về |
| menuItemId | String | FOREIGN KEY, NOT NULL | Món ăn được chọn |
| stationId | String | FOREIGN KEY, NULLABLE | Trạm chế biến (snapshot tại thời điểm đặt) |
| nameSnapshot | String | NOT NULL | Tên món tại thời điểm đặt (không đổi theo thực đơn hiện tại) |
| unitPriceSnapshot | Int | NOT NULL | Đơn giá tại thời điểm đặt |
| quantity | Int | DEFAULT 1 | Số lượng |
| lineTotal | Int | NOT NULL | Thành tiền của dòng (đã gồm tùy chọn) |
| status | Enum | NOT NULL | Trạng thái chế biến của riêng dòng món này |

#### 3.4.9. Bảng STAFF (Nhân viên)

| Tên trường | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | String (cuid) | PRIMARY KEY | Mã nhân viên |
| branchId | String | FOREIGN KEY, NOT NULL | Chi nhánh làm việc |
| code | String | UNIQUE (theo branchId) | Mã số nhân viên dùng để đăng nhập |
| name | String | NOT NULL | Họ tên |
| role | Enum | NOT NULL | OWNER/MANAGER/CASHIER/SERVER/KITCHEN |
| pinHash | String | NOT NULL | Mã PIN đã băm (scrypt), không lưu dạng gốc |
| isActive | Boolean | DEFAULT true | Tài khoản còn hoạt động hay đã khóa |

#### 3.4.10. Bảng PAYMENT / RECEIPT (Thanh toán / Hóa đơn)

| Tên trường | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id (PAYMENT) | String (cuid) | PRIMARY KEY | Mã khoản thanh toán |
| tableSessionId | String | FOREIGN KEY, NOT NULL | Phiên gọi món được thanh toán |
| method | Enum | NOT NULL | CASH / QR |
| subtotal, serviceChargeAmount, vatAmount, grandTotal | Int | NOT NULL | Các thành phần tiền, đều là số nguyên |
| id (RECEIPT) | String (cuid) | PRIMARY KEY | Mã hóa đơn |
| paymentId | String | FOREIGN KEY, UNIQUE | Khoản thanh toán phát hành hóa đơn này (quan hệ 1-1) |
| number | String | UNIQUE (theo branchId) | Số hóa đơn, tăng liên tục không đứt quãng |
| sellerName, sellerTaxId | String | NOT NULL | Thông tin người bán, lưu cố định tại thời điểm phát hành |
