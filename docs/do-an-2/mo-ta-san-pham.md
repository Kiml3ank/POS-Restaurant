# MÔ TẢ SẢN PHẨM — HỆ THỐNG POS NHÀ HÀNG

## Tên sản phẩm

**Restaurant POS** — Hệ thống quản lý điểm bán hàng cho nhà hàng, phục vụ đồng thời 4 nhóm người dùng trên cùng một bộ dữ liệu theo thời gian thực.

## Mô tả ngắn

Restaurant POS là một hệ thống bán hàng nhà hàng tự xây dựng từ đầu, thay thế việc ghi order giấy và tính tiền thủ công bằng bốn màn hình phối hợp trực tiếp với nhau: khách hàng tự gọi món tại bàn, nhân viên phục vụ/thu ngân thao tác trên quầy, bếp nhận đơn theo thời gian thực, và quản lý theo dõi toàn bộ hoạt động từ hậu đài — tất cả cùng đọc/ghi trên một nguồn dữ liệu duy nhất, không có bước đồng bộ thủ công nào giữa các bộ phận.

## Vấn đề giải quyết

Quán ăn vừa và nhỏ hiện phần lớn vẫn vận hành bằng order giấy chuyển tay tới bếp, tính tiền bằng máy tính cầm tay hoặc sổ sách — dễ sai sót, chậm vào giờ cao điểm, và không có cách nào tra soát lại một giao dịch sau khi đã xảy ra. Các phần mềm POS thương mại trên thị trường (Qashier, FoodStory, Wongnai POS, StoreHub...) giải quyết được vấn đề này nhưng đi kèm chi phí thuê bao định kỳ và khó tùy biến theo quy trình riêng của từng quán. Restaurant POS được xây dựng để trả lời câu hỏi: một quán ăn có thể tự sở hữu một hệ thống tương đương, kiểm soát hoàn toàn dữ liệu và logic nghiệp vụ của mình, mà không phụ thuộc vào nhà cung cấp thứ ba.

## Bốn màn hình cốt lõi

| Màn hình | Người dùng | Việc chính |
|---|---|---|
| Gọi món (`/t/[tableCode]`) | Khách hàng tại bàn | Xem thực đơn theo danh mục, chọn món kèm tùy chọn, gửi đơn, theo dõi trạng thái đơn hàng theo thời gian thực |
| Quầy phục vụ (`/pos`) | Nhân viên phục vụ / thu ngân | Mở bàn, gọi món hộ khách, chuyển/gộp bàn, tính tiền và nhận thanh toán |
| Bếp — KDS (`/kds`) | Nhân viên bếp | Nhận món theo từng trạm chế biến, cập nhật trạng thái theo thời gian thực, không có thao tác lùi trạng thái |
| Hậu đài (`/admin`) | Quản lý / chủ quán | Xem doanh thu trong ngày, quản lý thực đơn, nhân viên, bàn, cấu hình thuế/phí, tra soát nhật ký kiểm toán |

## Điểm khác biệt kỹ thuật đáng chú ý

- **Đồng bộ thời gian thực không cần tải lại trang**: mọi thay đổi (đơn hàng mới, món chuyển trạng thái, thanh toán) được đẩy tới các màn hình liên quan qua Server-Sent Events; hỗ trợ chạy nhiều instance qua PostgreSQL LISTEN/NOTIFY.
- **Tính tiền tuyệt đối chính xác**: toàn bộ phép tính tiền (giá món, phí dịch vụ, thuế, giảm giá) dùng số nguyên trên đơn vị nhỏ nhất của tiền tệ, không dùng số thực ở bất kỳ bước nào — loại bỏ hoàn toàn sai số làm tròn cộng dồn.
- **Thực đơn linh hoạt 3 lớp**: Danh mục → Món ăn → Nhóm tùy chọn (kích cỡ, độ cay, độ ngọt, topping...), không hard-code từng loại tùy chọn theo cột riêng — thêm món/tùy chọn mới không cần đổi cấu trúc dữ liệu.
- **Đa sạp/đa chi nhánh và đa tiền tệ**: mọi bảng dữ liệu đều gắn với chi nhánh ngay từ đầu; hỗ trợ đồng thời VNĐ, Baht, Kip với quy tắc hiển thị riêng cho từng loại tiền.
- **Phân quyền theo 5 vai trò** (Chủ quán, Quản lý, Thu ngân, Phục vụ, Bếp) với nhật ký kiểm toán ghi lại đầy đủ các thao tác nhạy cảm liên quan đến tiền (hủy món đã gửi bếp, thanh toán, sửa cấu hình thuế/phí), và cơ chế thu hồi phiên đăng nhập ngay lập tức khi cần khóa một nhân viên.
- **Chuyển/gộp bàn an toàn**: toàn bộ đơn hàng chưa thanh toán của một bàn được chuyển hoặc gộp trong một giao dịch dữ liệu duy nhất, không tồn tại trạng thái trung gian mất đơn.
- **Hóa đơn có số thứ tự liên tục theo chi nhánh**, giữ nguyên thông tin người bán tại thời điểm phát hành (không đổi theo dữ liệu hiện tại của quán), phục vụ việc tra soát về sau.

## Công nghệ sử dụng

Next.js 16.2 (App Router) + React 19 + TypeScript ở tầng giao diện; Server Actions gọi thẳng xuống tầng nghiệp vụ mà không cần dựng REST API riêng; PostgreSQL 17 qua Prisma ORM 7 ở tầng lưu trữ; xác thực nhân viên bằng PIN băm scrypt và phiên đăng nhập ký HMAC có kiểm tra thu hồi trong cơ sở dữ liệu.

## Hiện trạng

Hệ thống đã hoàn chỉnh và chạy được thực tế qua toàn bộ luồng nghiệp vụ chính: từ mở bàn, gọi món, chế biến, tính tiền, thanh toán, phát hành hóa đơn, đến báo cáo doanh thu và quản lý nhân viên/thực đơn/bàn từ hậu đài. Được kiểm chứng bằng 811 kịch bản kiểm thử tự động chạy trực tiếp trên cơ sở dữ liệu thật, cùng công cụ đo tự động hiện tượng tràn giao diện trên nhiều kích thước màn hình.

Phần thanh toán hiện ở chế độ minh họa quy trình (chưa nối cổng thanh toán ngân hàng/ví điện tử thật), và khách hàng hiện gọi món qua đường dẫn riêng của từng bàn — hạ tầng để chuyển sang quét mã QR thật đã có (mã định danh duy nhất theo bàn), nhưng bước sinh ảnh QR để in dán tại bàn chưa được cài đặt.
