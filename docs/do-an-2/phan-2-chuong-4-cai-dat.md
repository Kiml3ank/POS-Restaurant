## CHƯƠNG 4: CÀI ĐẶT THỬ NGHIỆM VÀ BẢO TRÌ HỆ THỐNG

### 4.1. Môi trường và công nghệ phát triển

#### 4.1.1. Môi trường phát triển

- Hệ điều hành: Windows 11 (môi trường phát triển thực tế), tương thích Linux/macOS
- Môi trường phát triển tích hợp (IDE): Visual Studio Code
- Công cụ quản lý mã nguồn: Git
- Công cụ quản lý cơ sở dữ liệu: Prisma Studio (giao diện web đi kèm Prisma, xem/sửa dữ liệu trực quan)
- Công cụ ảo hóa: Docker Desktop (chạy PostgreSQL cho môi trường phát triển qua Docker Compose)

#### 4.1.2. Công nghệ và nền tảng sử dụng

- Ngôn ngữ lập trình: TypeScript (toàn bộ dự án, cả phía giao diện lẫn phía máy chủ)
- Framework: Next.js 16.2 (App Router) kết hợp React 19
- Cơ sở dữ liệu: PostgreSQL 17, chạy qua Docker Compose ở môi trường phát triển
- ORM: Prisma 7, kết nối cơ sở dữ liệu qua driver adapter (`@prisma/adapter-pg`)
- Giao tiếp thời gian thực: Server-Sent Events (SSE) thông qua Route Handler của Next.js, có driver Postgres `LISTEN/NOTIFY` để đồng bộ khi chạy nhiều instance
- Giao diện: Tailwind CSS 4, thiết kế riêng (design system nội bộ), không dùng thư viện UI dựng sẵn
- Xác thực nhân viên: mã PIN băm bằng `scrypt` (mô-đun mật mã có sẵn của Node.js), phiên đăng nhập bằng cookie ký HMAC kết hợp kiểm tra thu hồi trong cơ sở dữ liệu

> **Vì sao không dùng WebSocket:** Route Handler của Next.js không thể nâng cấp kết nối lên WebSocket, và nền tảng triển khai dạng serverless (Vercel) không giữ được kết nối TCP mở lâu dài. Do đó hệ thống chọn SSE — một hướng kết nối một chiều từ máy chủ đến trình duyệt, đủ dùng cho nhu cầu "đẩy tín hiệu làm mới dữ liệu" của bài toán này mà không cần WebSocket hai chiều.

### 4.2. Kiến trúc phần mềm

#### 4.2.1. Mô hình kiến trúc

Hệ thống được xây dựng theo kiến trúc **full-stack trong một dự án Next.js duy nhất**, kết hợp mô hình ba lớp đã trình bày ở mục 3.2:

- **Lớp trình bày**: React Server Components (render sẵn trên máy chủ) và Client Components (tương tác phía trình duyệt).
- **Lớp nghiệp vụ**: Server Actions gọi các hàm xử lý trong `lib/server/`.
- **Lớp truy cập dữ liệu**: Prisma Client, chỉ được truy cập từ phía máy chủ.

Cách tiếp cận này giúp loại bỏ nhu cầu dựng riêng một tầng REST API cho giao tiếp giữa giao diện và máy chủ, đồng thời vẫn giữ được ranh giới rõ ràng giữa các lớp nhờ quy ước thư mục và cờ `"use server"`/`"server-only"` của Next.js.

#### 4.2.2. Cấu trúc dự án

Dự án được tổ chức theo các thư mục chính như sau:

- `app/(customer)/t/[tableCode]/`: màn hình khách hàng — xem thực đơn, giỏ hàng, gửi đơn, theo dõi trạng thái.
- `app/(pos)/pos/`: màn hình nhân viên phục vụ/thu ngân — bàn, quầy mang về, tính tiền.
- `app/(kds)/kds/`: màn hình bếp — danh sách món theo trạm chế biến.
- `app/(admin)/admin/`: màn hình hậu đài — thực đơn, nhân viên, cấu hình, hóa đơn, báo cáo, nhật ký kiểm toán.
- `lib/server/`: toàn bộ logic nghiệp vụ phía máy chủ, chia theo từng nhóm chức năng (`cart.ts`, `pos.ts`, `kds.ts`, `billing.ts`, `payment.ts`, `receipt.ts`, `settings.ts`, `staff-session.ts`, `table-session.ts`, `table-move.ts`, `dashboard.ts`, `audit.ts`...).
- `lib/`: logic dùng chung không chạm cơ sở dữ liệu, dùng được cả ở giao diện lẫn máy chủ (`money.ts` — định dạng và tính tiền, `order-status.ts` — nhãn và luật chuyển trạng thái, `rbac.ts` — bảng phân quyền, `sale-point.ts` — quy tắc theo loại điểm bán).
- `prisma/schema.prisma` và `prisma/seed.ts`: định nghĩa mô hình dữ liệu và dữ liệu mẫu ban đầu.
- `proxy.ts`: quy ước đặt tên tệp middleware của Next.js 16.2, đảm nhiệm việc kiểm tra sơ bộ cookie phiên trước khi cho phép truy cập các trang thuộc từng màn hình.

### 4.3. Thiết kế giao diện người dùng

#### 4.3.1. Nguyên tắc thiết kế

Giao diện được xây dựng theo một hệ thống thiết kế riêng, đặt tên nội bộ là *"Modernist"*, với các đặc điểm:

- Không bo góc (radius 0) ở toàn bộ các thành phần trong khu vực nhân viên/bếp/hậu đài.
- Dùng viền mực đậm 2px làm ranh giới chính giữa các khối, thay cho đổ bóng.
- Chỉ một màu nhấn duy nhất; trạng thái được thể hiện bằng độ đậm nhạt thay vì nhiều màu sắc khác nhau, giúp người dùng không bị rối khi nhìn nhanh trên màn hình bận rộn.
- Chữ số và chữ Latin dùng phông Archivo, chữ tiếng địa phương dùng phông riêng có đủ ký tự — đảm bảo hiển thị đúng trên mọi ngôn ngữ hệ thống hỗ trợ.
- Toàn bộ màn hình khu vực nhân viên đều đáp ứng (responsive) từ khổ điện thoại đến máy tính bàn, vì nhân viên thao tác bằng nhiều loại thiết bị khác nhau tại quầy.

#### 4.3.2. Cấu trúc giao diện

- **Thanh module** (thay cho header/sidebar truyền thống): liệt kê các khu vực chức năng mà nhân viên có quyền truy cập, hiển thị dạng thanh dọc trên màn hình rộng và thanh ngang cố định dưới đáy trên màn hình hẹp — phù hợp thao tác bằng ngón tay cái khi một tay đang bưng đồ.
- **Khu vực nội dung chính**: hiển thị nội dung tương ứng với màn hình đang chọn (bảng món, danh sách bàn, ticket bếp, biểu mẫu quản trị...).
- **Không có "footer"** theo nghĩa trang nội dung thông thường — đây là ứng dụng thao tác nghiệp vụ tại quầy, không phải trang thông tin.

#### 4.3.3. Các màn hình chính


**a) Màn hình nhân viên phục vụ/thu ngân (`/pos`)**

- Sơ đồ bàn hiển thị tình trạng từng bàn (trống/đang phục vụ/cần chú ý).
- Trang một bàn gồm hai khu vực: bảng thực đơn (gọi món thay khách) và giỏ hàng đang mở, trên cùng một màn hình để nhân viên vừa nói chuyện với khách vừa thao tác mà không phải chuyển trang.
- Trang tính tiền hiển thị chi tiết hóa đơn và các phương thức thanh toán.

**b) Màn hình bếp — Kitchen Display System (`/kds`)**

- Danh sách ticket theo từng trạm chế biến, sắp xếp theo thời gian gửi đơn (đến trước làm trước).
- Nút chuyển trạng thái món theo một chiều, cập nhật tức thời trên mọi màn hình bếp đang mở nhờ cơ chế thời gian thực.

**c) Màn hình hậu đài (`/admin`)**

- Trang tổng quan: doanh thu trong ngày, món bán chạy, tình trạng hoạt động hiện tại.
- Các trang quản lý: thực đơn và nhóm tùy chọn, nhân viên, bàn/điểm bán hàng và trạm chế biến, cấu hình thuế/phí dịch vụ, danh sách hóa đơn, nhật ký kiểm toán.

> Vì đây là ứng dụng thật đang chạy được, các ảnh chụp màn hình cụ thể (tương ứng "Hình 22" trở đi trong tài liệu) có thể được chụp trực tiếp từ hệ thống khi cần minh họa trong báo cáo, thay vì dựng ảnh minh họa.

### 4.4. Cài đặt các chức năng chính

#### 4.4.1. Xây dựng cơ sở dữ liệu

- Mô hình dữ liệu được khai báo khai báo trong `prisma/schema.prisma`; mỗi thay đổi mô hình được quản lý qua các tệp migration do Prisma sinh ra (`npx prisma migrate dev`), giúp lịch sử thay đổi cấu trúc bảng được theo dõi đầy đủ thay vì sửa tay trực tiếp trên cơ sở dữ liệu.
- Dữ liệu mẫu được nạp qua `prisma/seed.ts`: 5 danh mục, 31 món ăn, 5 nhóm tùy chọn (21 tùy chọn con), 3 trạm chế biến, 6 bàn/điểm bán hàng và 4 tài khoản nhân viên mẫu.
- Script seed được viết theo kiểu "upsert theo id cố định", cho phép chạy lại nhiều lần mà không tạo dữ liệu trùng lặp.

#### 4.4.2. Cài đặt phân lớp theo kiến trúc

- **Server Component**: đọc dữ liệu trực tiếp qua Prisma ngay trong quá trình render trang, không cần gọi API riêng.
- **Server Action**: hàm bất đồng bộ đánh dấu `"use server"`, được giao diện gọi trực tiếp như một hàm JavaScript thông thường nhưng thực thi ở phía máy chủ; theo quy ước của Next.js, tệp `"use server"` chỉ được export các hàm bất đồng bộ, không được export hằng số hay đối tượng.
- **`lib/server/*.ts`**: chứa logic nghiệp vụ thuần túy, tách khỏi Server Action để có thể kiểm thử độc lập bằng cách chạy trực tiếp qua `tsx` mà không cần khởi động máy chủ Next.js.

#### 4.4.3. Triển khai các chức năng chính

Một số kỹ thuật cài đặt tiêu biểu được áp dụng nhất quán trong toàn hệ thống:

- **Chống thao tác trùng lặp (idempotency)**: gửi đơn hàng dùng phép cập nhật có điều kiện (chỉ chuyển trạng thái khi đơn đang ở trạng thái nháp); thanh toán dùng phép cập nhật có điều kiện tương tự trên trạng thái phiên bàn — nếu bấm nhiều lần liên tiếp, hệ thống trả về kết quả của lần xử lý đầu tiên thay vì tạo bản ghi mới hoặc thu tiền hai lần.
- **Giao dịch cơ sở dữ liệu (`$transaction`)**: mọi thao tác ảnh hưởng nhiều bảng cùng lúc (chuyển/gộp bàn, thanh toán kèm phát hành hóa đơn, hủy món kèm tính lại tổng tiền) đều được bọc trong một giao dịch duy nhất để đảm bảo dữ liệu không bao giờ ở trạng thái nửa vời nếu xảy ra lỗi giữa chừng.
- **Lưu snapshot dữ liệu lịch sử**: tên món, đơn giá, thông tin người bán tại thời điểm phát sinh giao dịch được lưu cố định vào chính bản ghi đơn hàng/hóa đơn, thay vì tham chiếu sống đến thực đơn hoặc thông tin quán hiện tại — đảm bảo lịch sử bán hàng không bị thay đổi ngược khi quán cập nhật giá hoặc thông tin sau này.
- **Chặn truy cập trái phép ở nhiều lớp**: `proxy.ts` kiểm tra sơ bộ sự tồn tại của cookie phiên (không truy vấn cơ sở dữ liệu); từng Server Action sau đó kiểm tra lại đầy đủ và chính xác quyền hạn trước khi thực thi — vì việc ẩn nút trên giao diện không đồng nghĩa với việc chặn được yêu cầu gửi thẳng đến máy chủ.
- **Cô lập dữ liệu theo chi nhánh (multi-tenant)**: mọi truy vấn đều lọc theo mã chi nhánh của người dùng đang thao tác, ngăn dữ liệu giữa các chi nhánh (hoặc giữa các nhà hàng khác nhau dùng chung hệ thống) lẫn vào nhau.

#### 4.4.4. Chiến lược xây dựng giao diện

- Ưu tiên Server Component để giảm tối đa lượng mã JavaScript gửi xuống trình duyệt; chỉ dùng Client Component ở những nơi thật sự cần trạng thái tương tác phía trình duyệt.
- Dùng `useActionState`/`useFormStatus` của React để tự động vô hiệu hóa nút bấm ngay khi biểu mẫu đang được gửi đi, làm lớp phòng vệ đầu tiên chống bấm gửi trùng.
- Kết nối `EventSource` (giao thức nền của SSE) từ trình duyệt tới một Route Handler dùng chung; khi nhận được tín hiệu, giao diện tự làm mới dữ liệu của trang hiện tại thay vì tự ý cập nhật trực tiếp lên giao diện — đảm bảo dữ liệu hiển thị luôn đi qua đúng lớp kiểm tra quyền hạn.

#### 4.4.5. Triển khai bảo mật

- Mã PIN không lưu dạng gốc mà băm bằng `scrypt` trước khi lưu vào cơ sở dữ liệu.
- Phiên đăng nhập là cookie được ký bằng HMAC để chống giả mạo, đồng thời được đối chiếu với một bảng phiên trong cơ sở dữ liệu ở mỗi yêu cầu — cho phép thu hồi phiên ngay lập tức khi cần (đặt lại PIN, khóa tài khoản), thay vì phải chờ cookie tự hết hạn.
- Giới hạn số lần đăng nhập sai liên tiếp theo từng cặp (chi nhánh, mã nhân viên) để hạn chế dò mã PIN.
- Phân quyền được kiểm tra ở hai lớp: ẩn/hiện phần tử giao diện theo vai trò (trải nghiệm người dùng), và kiểm tra lại đầy đủ trong từng Server Action (lớp bảo vệ thật sự).
- Mọi thao tác ảnh hưởng đến tiền bạc hoặc dữ liệu nhạy cảm đều được ghi vào nhật ký kiểm toán, gồm giá trị trước và sau khi thay đổi, người thực hiện và thời điểm.

#### 4.4.6. Chiến lược báo cáo

- Dữ liệu báo cáo doanh thu được tính trực tiếp từ bảng ghi nhận thanh toán thực tế tại thời điểm truy vấn (không dùng bảng tổng hợp riêng), đảm bảo số liệu luôn khớp với tiền thực thu.
- Thời điểm được tính theo múi giờ riêng của từng chi nhánh, tránh sai lệch ngày khi máy chủ và chi nhánh nằm ở múi giờ khác nhau.

### 4.5. Kiểm thử phần mềm

#### 4.5.1. Chiến lược kiểm thử

Hệ thống ưu tiên **kiểm thử tích hợp trên cơ sở dữ liệu thật** thay vì giả lập (mock) tầng dữ liệu, nhằm đảm bảo kịch bản kiểm thử phản ánh đúng hành vi khi vận hành thực tế — đặc biệt quan trọng với các nghiệp vụ liên quan đến giao dịch đồng thời (thanh toán trùng, gửi đơn trùng) mà việc giả lập dễ bỏ sót lỗi thật.

#### 4.5.2. Phương pháp kiểm thử

- **Kiểm thử hộp đen** theo từng kịch bản nghiệp vụ hoàn chỉnh (ví dụ: gửi đơn hai lần liên tiếp → hệ thống không được tạo hai đơn hàng; thanh toán hai lần liên tiếp → hệ thống không được thu tiền hai lần).
- **Kiểm thử hồi quy**: mỗi bộ kịch bản kiểm thử của các module trước được chạy lại đầy đủ sau mỗi lần thay đổi mã nguồn, đảm bảo tính năng cũ không bị ảnh hưởng bởi thay đổi mới.
- **Kiểm thử giao diện tự động qua trình duyệt thật**: đo hiện tượng tràn nội dung theo chiều ngang/dọc trên nhiều kích thước màn hình khác nhau (điện thoại, máy tính bảng, máy tính bàn).

#### 4.5.3. Kịch bản kiểm thử

Mỗi module nghiệp vụ có một bộ kịch bản kiểm thử riêng, chạy trực tiếp với cơ sở dữ liệu thật và tự dọn dẹp dữ liệu đã tạo sau khi chạy xong. Tổng số kịch bản tại thời điểm hoàn thiện báo cáo:

| Module | Số kịch bản | | Module | Số kịch bản |
|---|---:|---|---|---:|
| Gọi món & giỏ hàng | 31 | | Đặt lại PIN & phiên đăng nhập | 33 |
| Màn hình nhân viên (POS) | 58 | | Quản lý nhân viên (hậu đài) | 44 |
| Bếp (KDS) | 55 | | Cấu hình hệ thống | 40 |
| Tính hóa đơn | 48 | | Báo cáo doanh thu | 31 |
| Thanh toán | 67 | | Chuyển/gộp bàn | 63 |
| Quản lý thực đơn | 55 | | Quản lý bàn/điểm bán hàng | 49 |
| Hóa đơn (ABB) | 82 | | | |
| Giảm giá nhân viên | 78 | | **Tổng cộng** | **811** |
| Bán mang về/quầy | 77 | | | |

Toàn bộ 811 kịch bản đều đạt (PASS) tại thời điểm hoàn thiện đề tài.

#### 4.5.4. Công cụ kiểm thử

- `tsx` — chạy trực tiếp mã TypeScript của lớp nghiệp vụ mà không cần biên dịch riêng hay khởi động máy chủ Next.js.
- Giao thức gỡ lỗi trình duyệt (Chrome DevTools Protocol) được điều khiển trực tiếp qua WebSocket của Node.js để đo bố cục giao diện thật, không cần cài thêm thư viện tự động hóa trình duyệt ngoài.
- `curl` — kiểm tra hành vi của lớp kiểm tra truy cập (`proxy.ts`) và các Route Handler.
- `tsc --noEmit` và `eslint` — kiểm tra kiểu dữ liệu tĩnh và quy tắc mã nguồn trước mỗi lần bàn giao.

### 4.6. Triển khai và bảo trì

#### 4.6.1. Kế hoạch triển khai

**Môi trường phát triển:**

1. Cài đặt Node.js và Docker Desktop.
2. Khởi động PostgreSQL bằng Docker Compose.
3. Cài đặt các gói phụ thuộc (`npm install`).
4. Khởi tạo cấu trúc cơ sở dữ liệu (`npx prisma migrate dev`) và nạp dữ liệu mẫu (`npm run db:seed`).
5. Khởi động máy chủ phát triển (`npm run dev`).

**Môi trường sản xuất:** vì hệ thống dùng SSE (không dùng WebSocket) cho đồng bộ thời gian thực, hệ thống phù hợp triển khai trên nền tảng serverless (ví dụ Vercel) kết hợp dịch vụ PostgreSQL được quản lý; nếu triển khai trên nhiều instance đồng thời, cần bật driver đồng bộ sự kiện qua PostgreSQL `LISTEN/NOTIFY` để các instance thấy được sự kiện của nhau.

#### 4.6.2. Hướng dẫn sử dụng

Hệ thống có tài liệu hướng dẫn sử dụng riêng cho từng nhóm người dùng, tương ứng với bốn màn hình: khách hàng (truy cập đường dẫn gọi món riêng của từng bàn — hiện chưa có ảnh mã QR để quét, xem ghi chú ở mục 4.3.3), nhân viên phục vụ/thu ngân và nhân viên bếp (đăng nhập bằng mã số + PIN vào đúng màn hình của mình), và quản lý/chủ quán (truy cập màn hình hậu đài).

#### 4.6.3. Bảo trì và nâng cấp

Một số hạng mục cần hoàn thiện trước khi đưa vào vận hành thực tế đã được ghi nhận trong quá trình phát triển:

- Thu hẹp phạm vi cấu hình cho phép tải ảnh từ nguồn ngoài (hiện đang để mở rộng cho môi trường phát triển).
- Bổ sung giới hạn số lần thử đăng nhập theo địa chỉ IP ở tầng hạ tầng (ngoài giới hạn theo mã nhân viên đã có).
- Triển khai chức năng báo cáo đóng ca (đã có sẵn mô hình dữ liệu nhưng chưa có giao diện sử dụng).

#### 4.6.4. Đảm bảo chất lượng liên tục

- Toàn bộ 15 bộ kịch bản kiểm thử được chạy lại sau mỗi thay đổi đáng kể trước khi xác nhận hoàn thành.
- Mỗi giai đoạn phát triển được ghi lại thành một báo cáo kỹ thuật riêng, mô tả quyết định thiết kế, các trường hợp đặc biệt đã xử lý và kết quả kiểm thử — phục vụ việc tra cứu lại khi phát triển các giai đoạn tiếp theo.
