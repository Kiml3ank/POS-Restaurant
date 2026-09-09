# Bảng cập nhật: sửa các chỗ nói sai về "gọi món qua QR"

Lý do sửa: hệ thống có mã định danh + đường dẫn riêng cho từng bàn và luồng gọi món
đã hoạt động đầy đủ, nhưng **chưa từng sinh ra ảnh mã QR thật** để khách quét bằng
camera điện thoại — trang cấu hình bàn chỉ hiển thị mã dưới dạng chữ. Toàn bộ chỗ
diễn đạt như thể "quét QR" đã hoàn thiện đều được sửa lại cho chính xác, thêm ghi chú
"Chưa hoàn thiện" ở những chỗ mô tả chi tiết tính năng.

Có 4 file bị ảnh hưởng, tổng cộng 7 chỗ sửa. Dưới đây liệt kê theo đúng thứ tự file →
mục → cũ → mới, để bạn tìm và thay trong Word.

---

## FILE 1: Phần I — Mở đầu (mục II. Mục tiêu của đề tài)

### Chỗ 1

CŨ:
Xây dựng hệ thống POS gồm 4 màn hình phối hợp thời gian thực: khách hàng (quét QR gọi món), nhân viên (mở bàn, tính tiền), bếp (nhận và xử lý order), và quản lý hậu đài.

MỚI:
Xây dựng hệ thống POS gồm 4 màn hình phối hợp thời gian thực: khách hàng (gọi món qua đường dẫn/mã định danh riêng của từng bàn), nhân viên (mở bàn, tính tiền), bếp (nhận và xử lý order), và quản lý hậu đài.

---

## FILE 2: Chương 2 — Mô tả bài toán (mục 2.2.3 Quản lý bàn và phiên gọi món)

### Chỗ 2 — đoạn mở đầu và các gạch đầu dòng

CŨ:
Mỗi bàn được gắn một mã QR duy nhất dẫn đến trang gọi món của bàn đó. Khi khách quét mã, hệ thống mở (hoặc tham gia vào) một phiên gọi món đang diễn ra tại bàn — nhiều khách cùng bàn quét chung một mã sẽ được gộp vào cùng một phiên và cùng một hóa đơn.

Hệ thống hỗ trợ:
- Mở bàn thủ công bởi nhân viên (trường hợp khách không tự quét mã).
- Chuyển bàn và gộp bàn — toàn bộ đơn hàng chưa thanh toán của bàn được chuyển/gộp trong cùng một thao tác, không tách rời từng phần.
- Phát hành lại mã QR mới cho một bàn khi cần (mã cũ ngay lập tức không còn hiệu lực với khách quét sau đó, nhưng không ảnh hưởng đến phiên đang phục vụ).
- Ngoài bàn ngồi tại chỗ, hệ thống còn hỗ trợ quầy bán mang về, hoạt động theo số thứ tự thay vì theo tên bàn, không tính phí dịch vụ và luôn mở phiên mới cho mỗi lượt khách thay vì gộp chung.

MỚI:
Mỗi bàn được gắn một mã định danh duy nhất, dẫn đến trang gọi món riêng của bàn đó qua một đường dẫn cố định. Khi khách hàng truy cập đường dẫn này, hệ thống mở (hoặc tham gia vào) một phiên gọi món đang diễn ra tại bàn — nhiều khách cùng bàn truy cập chung một đường dẫn sẽ được gộp vào cùng một phiên và cùng một hóa đơn.

Hệ thống hỗ trợ:
- Mở bàn thủ công bởi nhân viên (trường hợp khách không tự truy cập được đường dẫn của bàn).
- Chuyển bàn và gộp bàn — toàn bộ đơn hàng chưa thanh toán của bàn được chuyển/gộp trong cùng một thao tác, không tách rời từng phần.
- Phát hành lại mã định danh mới cho một bàn khi cần (mã cũ ngay lập tức không còn hiệu lực với ai truy cập sau đó, nhưng không ảnh hưởng đến phiên đang phục vụ).
- Ngoài bàn ngồi tại chỗ, hệ thống còn hỗ trợ quầy bán mang về, hoạt động theo số thứ tự thay vì theo tên bàn, không tính phí dịch vụ và luôn mở phiên mới cho mỗi lượt khách thay vì gộp chung.

### Chỗ 3 — thêm đoạn ghi chú mới (chèn ngay sau các gạch đầu dòng ở trên)

THÊM MỚI (đoạn hoàn toàn chưa có trước đây):
Chưa hoàn thiện: mã định danh nói trên được thiết kế để dùng làm mã QR (khách quét bằng camera điện thoại để vào thẳng trang gọi món), nhưng hệ thống hiện chưa sinh ra ảnh mã QR thật — trang cấu hình bàn ở hậu đài chỉ hiển thị mã này dưới dạng chữ. Trong phạm vi hiện tại, khách hàng cần được cung cấp đường dẫn trực tiếp (ví dụ dán ở bàn dưới dạng chữ, hoặc nhân viên hỗ trợ) thay vì quét mã QR thật.

*(Gợi ý định dạng: tô nền vàng nhạt hoặc in nghiêng đoạn "Chưa hoàn thiện" để nổi bật như ghi chú.)*

---

## FILE 2 (tiếp): Chương 2 — mục 2.5.2 Chức năng gọi món

### Chỗ 4 — tên mục và tác nhân

CŨ:
2.5.2. Chức năng gọi món (khách hàng qua mã QR)
...
Khách hàng: người quét mã QR, xem thực đơn và gửi đơn gọi món.

MỚI:
2.5.2. Chức năng gọi món (khách hàng)
...
Khách hàng: người truy cập đường dẫn gọi món của bàn, xem thực đơn và gửi đơn gọi món.

### Chỗ 5 — bước 1 của luồng sự kiện chính

CŨ:
1. Bắt đầu: Khách hàng quét mã QR tại bàn.

MỚI:
1. Bắt đầu: Khách hàng truy cập đường dẫn gọi món riêng của bàn (dự kiến qua quét mã QR — xem ghi chú ở cuối mục này).

### Chỗ 6 — luồng sự kiện phụ + thêm ghi chú

CŨ:
Mã QR hết hạn hoặc không hợp lệ: hệ thống từ chối và đưa khách về trang mở bàn.

MỚI:
Mã bàn hết hạn hoặc không hợp lệ: hệ thống từ chối và đưa khách về trang mở bàn.

THÊM MỚI (đoạn ghi chú, chèn ngay sau luồng sự kiện phụ):
Chưa hoàn thiện: toàn bộ luồng trên đã hoạt động đúng khi khách hàng có sẵn đường dẫn của bàn, nhưng hệ thống hiện chưa sinh được ảnh mã QR thật để bước 1 ("quét mã QR") diễn ra đúng như thiết kế ban đầu.

---

## FILE 3: Chương 4 — Cài đặt (mục 4.3.3 và 4.6.2)

### Chỗ 7a — tiêu đề màn hình khách hàng (mục 4.3.3)

CŨ:
a) Màn hình khách hàng (gọi món qua QR — /t/[tableCode])

MỚI:
a) Màn hình khách hàng (gọi món — /t/[tableCode])

THÊM MỚI (chèn ngay sau 3 gạch đầu dòng mô tả màn hình này):
Chưa hoàn thiện: toàn bộ luồng gọi món ở trên đã hoạt động đầy đủ khi khách hàng có sẵn đường dẫn/mã bàn (/t/<tableCode>), nhưng hệ thống chưa sinh ra ảnh mã QR thật để khách quét bằng camera điện thoại — trang cấu hình bàn ở hậu đài hiện chỉ hiển thị mã bàn dưới dạng chữ. Việc "gọi món bằng cách quét QR" theo đúng nghĩa đen do đó chưa được cài đặt; đây là hạng mục cần bổ sung trước khi triển khai thực tế (sinh ảnh QR từ mã bàn và cung cấp bản in dán tại bàn).

### Chỗ 7b — hướng dẫn sử dụng (mục 4.6.2)

CŨ:
... tương ứng với bốn màn hình: khách hàng (quét mã QR tại bàn), nhân viên phục vụ/thu ngân...

MỚI:
... tương ứng với bốn màn hình: khách hàng (truy cập đường dẫn gọi món riêng của từng bàn — hiện chưa có ảnh mã QR để quét, xem ghi chú ở mục 4.3.3), nhân viên phục vụ/thu ngân...

---

## FILE 4: Phần III — Kết luận

### Chỗ 8 — mục I. Đánh giá kết quả đạt được (bullet đầu tiên)

CŨ:
Xây dựng thành công hệ thống POS nhà hàng gồm bốn màn hình phối hợp theo thời gian thực trên cùng một bộ dữ liệu: khách hàng gọi món qua mã QR, nhân viên phục vụ/thu ngân, bếp (Kitchen Display System), và hậu đài quản lý.

MỚI:
Xây dựng thành công hệ thống POS nhà hàng gồm bốn màn hình phối hợp theo thời gian thực trên cùng một bộ dữ liệu: khách hàng gọi món qua đường dẫn riêng của từng bàn, nhân viên phục vụ/thu ngân, bếp (Kitchen Display System), và hậu đài quản lý.

### Chỗ 9 — mục II. Hạn chế (thêm một gạch đầu dòng MỚI, xếp đầu danh sách)

THÊM MỚI (bullet hoàn toàn mới, đặt lên đầu danh sách "Hạn chế"):
Chưa sinh được ảnh mã QR thật cho từng bàn — hệ thống đã có mã định danh duy nhất và trang gọi món riêng cho mỗi bàn, nhưng khách hàng hiện chưa thể "quét QR" bằng camera điện thoại theo đúng nghĩa; đây là khoảng cách rõ ràng nhất giữa tên gọi ban đầu của tính năng và những gì đã thực sự cài đặt được.

### Chỗ 10 — mục II. Phương hướng phát triển (thêm một gạch đầu dòng MỚI, xếp đầu danh sách)

THÊM MỚI (bullet hoàn toàn mới, đặt lên đầu danh sách "Phương hướng phát triển"):
Sinh ảnh mã QR thật từ mã định danh của từng bàn (có thể dùng thư viện tạo QR phía máy chủ) và cung cấp bản in dán tại bàn, hoàn tất đúng tên gọi ban đầu của tính năng "gọi món qua QR".

---

## Tổng kết nhanh

| # | File | Mục | Loại thay đổi |
|---|---|---|---|
| 1 | Phần I | II. Mục tiêu | Sửa câu |
| 2 | Chương 2 | 2.2.3 | Sửa đoạn + 3 gạch đầu dòng |
| 3 | Chương 2 | 2.2.3 | Thêm ghi chú mới |
| 4 | Chương 2 | 2.5.2 | Sửa tên mục + tác nhân |
| 5 | Chương 2 | 2.5.2 | Sửa bước 1 |
| 6 | Chương 2 | 2.5.2 | Sửa luồng phụ + thêm ghi chú |
| 7 | Chương 4 | 4.3.3 + 4.6.2 | Sửa tiêu đề, thêm ghi chú, sửa 1 câu |
| 8 | Phần III | I. Kết quả | Sửa câu |
| 9 | Phần III | II. Hạn chế | Thêm bullet mới |
| 10 | Phần III | II. Phương hướng | Thêm bullet mới |

Các file `.md` gốc trong `docs/do-an-2/` đã được cập nhật đầy đủ theo đúng bảng trên —
file này chỉ để bạn tiện đối chiếu khi sửa tay trong Word.
