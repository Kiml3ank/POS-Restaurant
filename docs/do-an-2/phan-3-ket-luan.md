# PHẦN III: KẾT LUẬN VÀ PHƯƠNG HƯỚNG PHÁT TRIỂN

## I. Đánh giá kết quả đạt được

Qua quá trình nghiên cứu và triển khai, đề tài "Xây dựng hệ thống quản lý điểm bán hàng cho nhà hàng (Restaurant POS)" đã đạt được những kết quả sau:

- Xây dựng thành công hệ thống POS nhà hàng gồm **bốn màn hình phối hợp theo thời gian thực** trên cùng một bộ dữ liệu: khách hàng gọi món qua đường dẫn riêng của từng bàn, nhân viên phục vụ/thu ngân, bếp (Kitchen Display System), và hậu đài quản lý.
- Thiết kế thực đơn theo mô hình ba lớp (danh mục → món ăn → nhóm tùy chọn) đủ linh hoạt để mô tả các biến thể món ăn (kích cỡ, độ cay, độ ngọt, topping) mà không cần thiết kế cứng theo từng loại tùy chọn.
- Toàn bộ phép tính tiền tệ (giá món, phí dịch vụ, thuế, giảm giá) được thực hiện bằng số nguyên tuyệt đối, loại bỏ hoàn toàn sai số làm tròn — có kiểm thử tự động xác nhận bằng số liệu thực tế.
- Xây dựng đầy đủ luồng nghiệp vụ từ mở bàn, gọi món, chế biến, tính tiền, thanh toán đến phát hành hóa đơn với số thứ tự liên tục theo chi nhánh.
- Hệ thống phân quyền theo 5 vai trò nhân viên cụ thể, có nhật ký kiểm toán đầy đủ cho các thao tác nhạy cảm liên quan đến tiền bạc, và cơ chế thu hồi phiên đăng nhập ngay lập tức.
- Xây dựng thêm các tính năng phát sinh từ thực tế vận hành ngoài phạm vi ban đầu: chuyển/gộp bàn trong một giao dịch duy nhất, bán hàng mang về theo số thứ tự, giảm giá cho nhân viên khi dùng bữa.
- Kiểm thử tự động với **811 kịch bản kiểm thử** chạy trực tiếp trên cơ sở dữ liệu thật, cùng công cụ đo tự động hiện tượng tràn giao diện trên nhiều kích thước màn hình.

## II. Hạn chế và phương hướng phát triển

**Hạn chế:**

- **Chưa sinh được ảnh mã QR thật cho từng bàn** — hệ thống đã có mã định danh duy nhất và trang gọi món riêng cho mỗi bàn, nhưng khách hàng hiện chưa thể "quét QR" bằng camera điện thoại theo đúng nghĩa; đây là khoảng cách rõ ràng nhất giữa tên gọi ban đầu của tính năng và những gì đã thực sự cài đặt được.
- Chưa có module quản lý tồn kho và giá vốn nguyên liệu đầy đủ — hiện tại chỉ dừng ở mức đánh dấu món "còn bán/ngừng bán", chưa theo dõi số lượng nguyên liệu thực tế.
- Chức năng thanh toán hiện ở chế độ minh họa quy trình, chưa kết nối với cổng thanh toán ngân hàng/ví điện tử thật.
- Chưa có chức năng giảm giá tùy chỉnh theo từng hóa đơn (hiện chỉ có mức giảm giá cố định dành cho nhân viên dùng bữa).
- Chưa triển khai báo cáo đóng ca/đóng ngày (X-report, Z-report) dù mô hình dữ liệu đã chuẩn bị sẵn.
- Chưa có ứng dụng di động riêng; toàn bộ truy cập hiện qua trình duyệt web.
- Giới hạn số lần đăng nhập sai mới thực hiện theo mã nhân viên, chưa có lớp giới hạn theo địa chỉ IP ở tầng hạ tầng.

**Phương hướng phát triển:**

- Sinh ảnh mã QR thật từ mã định danh của từng bàn (có thể dùng thư viện tạo QR phía máy chủ) và cung cấp bản in dán tại bàn, hoàn tất đúng tên gọi ban đầu của tính năng "gọi món qua QR".
- Hoàn thiện module quản lý tồn kho theo nguyên liệu, tích hợp trừ kho tự động khi bán và cảnh báo nguyên liệu sắp hết.
- Tích hợp cổng thanh toán thật theo từng quốc gia/đơn vị tiền tệ mà hệ thống hỗ trợ (ví dụ PromptPay cho chi nhánh Thái Lan, LAO QR cho chi nhánh Lào, VietQR cho chi nhánh Việt Nam).
- Xây dựng chức năng báo cáo đóng ca và đóng ngày dựa trên mô hình dữ liệu ca làm việc đã có sẵn.
- Bổ sung chức năng giảm giá tùy chỉnh theo hóa đơn, giới hạn theo vai trò và bắt buộc ghi nhận lý do.
- Xây dựng chức năng hoàn tiền/hủy hóa đơn sau khi đã thanh toán, có liên kết ngược đến hóa đơn gốc.
- Phát triển ứng dụng di động cho nhân viên phục vụ/bếp dựa trên nền tảng nghiệp vụ đã có.

---

# TÀI LIỆU THAM KHẢO

**Tài liệu kỹ thuật (chính thức):**

[1]. Vercel Inc. (2025). *Next.js Documentation* (App Router). https://nextjs.org/docs

[2]. Prisma Data Inc. (2025). *Prisma ORM Documentation*. https://www.prisma.io/docs

[3]. PostgreSQL Global Development Group. (2025). *PostgreSQL Documentation*. https://www.postgresql.org/docs/

[4]. Meta Platforms Inc. (2025). *React Documentation*. https://react.dev

[5]. Mozilla Developer Network. (2025). *Server-Sent Events (EventSource) – Web APIs*. https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events

**Sách tham khảo:**

[6]. Pressman, R. S. & Maxim, B. R. (2020). *Software Engineering: A Practitioner's Approach* (9th ed.). McGraw-Hill Education.

[7]. Ramakrishnan, R. & Gehrke, J. (2003). *Database Management Systems* (3rd ed.). McGraw-Hill.

[8]. Fielding, R. T. (2000). *Architectural Styles and the Design of Network-based Software Architectures* (Doctoral dissertation). University of California, Irvine.
