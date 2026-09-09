# KỊCH BẢN NÓI — BÀI THUYẾT TRÌNH HỆ THỐNG POS NHÀ HÀNG

Script để đọc/nói theo từng slide trong `bai-thuyet-trinh.md`. Văn phong nói chuyện,
không phải văn viết báo cáo — đọc thành tiếng cho tự nhiên trước khi thuộc.
Mỗi slide có: lời nói gợi ý + thời lượng ước tính. Tổng khoảng **10-12 phút**,
điều chỉnh nhanh/chậm tùy thời gian được giao.

---

## PHẦN A — MỞ ĐẦU (~2 phút)

### Slide 1 — Trang bìa (15 giây)

> Em xin chào thầy/cô và các bạn. Em tên là [họ tên], hôm nay em xin trình bày đề tài
> "Xây dựng hệ thống quản lý điểm bán hàng cho nhà hàng" — hay gọi tắt là Restaurant POS,
> dưới sự hướng dẫn của thầy/cô [tên GVHD].

### Slide 2 — Lý do chọn đề tài (30 giây)

> Lý do em chọn đề tài này xuất phát từ một thực tế khá gần gũi: rất nhiều quán ăn vừa
> và nhỏ hiện nay vẫn ghi order bằng giấy, chuyển tay xuống bếp, rồi tính tiền bằng máy
> tính cầm tay. Cách làm này dễ sai sót, chậm vào giờ cao điểm, và gần như không thể tra
> soát lại khi có tranh chấp.
>
> Trên thị trường đã có các phần mềm POS thương mại như Qashier, FoodStory, Wongnai POS,
> nhưng đi kèm với đó là chi phí thuê bao định kỳ, và khó tùy biến sâu theo quy trình
> riêng của từng quán. Từ đó em muốn thử tự xây dựng một hệ thống tương đương — nhiều
> màn hình cùng thao tác đồng thời, cùng nhìn vào một nguồn dữ liệu duy nhất — để hiểu
> và làm chủ hoàn toàn phần logic nghiệp vụ bên trong.

### Slide 3 — Mục tiêu (30 giây)

> Mục tiêu của đề tài gồm bốn phần chính. Một là xây dựng bốn màn hình phối hợp thời
> gian thực: khách hàng, nhân viên phục vụ/thu ngân, bếp và hậu đài quản lý. Hai là
> đảm bảo việc tính tiền chính xác tuyệt đối — em sẽ nói kỹ hơn ở phần sau vì đây là một
> nguyên tắc kỹ thuật khá quan trọng của đề tài. Ba là thiết kế thực đơn theo mô hình
> ba lớp để linh hoạt với các biến thể món ăn như size, độ cay, topping. Và bốn là có
> hệ thống phân quyền theo vai trò nhân viên kèm nhật ký kiểm toán.

### Slide 4 — Phương pháp nghiên cứu (30 giây)

> Về phương pháp, em bắt đầu bằng khảo sát quy trình vận hành thực tế của một nhà hàng
> phục vụ tại bàn, từ đó phân tích nghiệp vụ, thiết kế mô hình dữ liệu, rồi xây dựng
> lần lượt theo từng module theo hướng phát triển lặp — hoàn thiện và kiểm thử xong một
> module mới chuyển sang module tiếp theo. Toàn bộ hệ thống được kiểm thử bằng 811 kịch
> bản tự động chạy trực tiếp trên cơ sở dữ liệu thật, cùng với kiểm thử giao diện qua
> trình duyệt.

---

## PHẦN B — CÔNG NGHỆ SỬ DỤNG (~1 phút 15 giây)

### Slide 5 — Frontend (35 giây)

> Về công nghệ, phần giao diện em dùng Next.js phiên bản 16.2 với App Router, kết hợp
> React 19 và TypeScript cho toàn bộ dự án. Giao diện được thiết kế riêng bằng Tailwind
> CSS, không dùng thư viện UI dựng sẵn, để kiểm soát hoàn toàn hình thức hiển thị.
>
> Điểm đáng chú ý là phần đồng bộ thời gian thực: em dùng Server-Sent Events, tức là
> EventSource ở phía trình duyệt, chứ không dùng WebSocket. Lý do là Route Handler của
> Next.js không nâng cấp được lên giao thức WebSocket, và nếu triển khai trên nền tảng
> serverless như Vercel thì cũng không giữ được kết nối TCP mở lâu dài.

### Slide 6 — Backend (40 giây)

> Về phía máy chủ, em dùng Server Actions của Next.js — tức là gọi thẳng hàm phía server
> từ component, không cần tự dựng REST API riêng. Dữ liệu lưu ở PostgreSQL 17, thông qua
> Prisma ORM phiên bản 7 với driver adapter.
>
> Về xác thực nhân viên, mã PIN được băm bằng thuật toán scrypt, phiên đăng nhập dùng
> cookie ký bằng HMAC và có kiểm tra thu hồi trong cơ sở dữ liệu — nghĩa là khi cần khóa
> một nhân viên, hệ thống có thể vô hiệu hóa phiên đăng nhập của họ ngay lập tức chứ
> không phải đợi hết hạn.
>
> Những thao tác đụng đến nhiều bảng cùng lúc, ví dụ chuyển bàn, gộp bàn, hay thanh toán
> kèm phát hành hóa đơn, đều được bọc trong transaction để đảm bảo toàn vẹn dữ liệu. Và
> nếu triển khai nhiều instance, việc đồng bộ thời gian thực được xử lý qua cơ chế
> LISTEN/NOTIFY của PostgreSQL.

---

## PHẦN C — PHÂN TÍCH THIẾT KẾ HỆ THỐNG (~2 phút 30 giây)

### Slide 7 — Biểu đồ chức năng nghiệp vụ (30 giây)

> Đây là sơ đồ phân rã chức năng nghiệp vụ của hệ thống, chia thành 9 nhóm chính:
> quản lý thực đơn, quản lý bàn và phiên gọi món, xử lý đơn hàng, hiển thị bếp, tính
> tiền và thanh toán, phát hành hóa đơn, quản lý nhân viên, cấu hình hệ thống, và báo
> cáo. Cấu trúc này là nền tảng để em thiết kế các module xây dựng lần lượt sau này.

### Slide 8 — Biểu đồ use case hệ thống (35 giây)

> Đây là biểu đồ use case tổng quát, thể hiện 5 tác nhân tương tác với hệ thống: khách
> hàng, nhân viên phục vụ, nhân viên thu ngân, nhân viên bếp, và quản lý hoặc chủ quán.
> Mỗi tác nhân kết nối tới các use case chính tương ứng với vai trò của họ — ví dụ khách
> hàng chỉ tương tác với việc xem thực đơn và gọi món, trong khi quản lý có quyền truy
> cập vào cấu hình hệ thống và xem báo cáo.
>
> *(Nếu có thời gian, chèn thêm slide UC02 chi tiết 8 use case con để đi sâu hơn.)*

### Slide 9 — Biểu đồ dữ liệu mức bối cảnh (45 giây)

> Đây là biểu đồ dữ liệu mức bối cảnh, hay còn gọi là DFD mức 0 — coi toàn bộ hệ thống
> như một tiến trình xử lý duy nhất, và thể hiện luồng dữ liệu ra vào giữa hệ thống với
> năm tác nhân bên ngoài.
>
> Khách hàng gửi vào hệ thống thông tin gọi món — món, tùy chọn, số lượng — và nhận lại
> thực đơn cùng trạng thái đơn hàng. Nhân viên phục vụ gửi yêu cầu mở bàn, gọi món hộ,
> chuyển hoặc gộp bàn, và nhận lại tình trạng bàn cùng danh sách món cần phục vụ. Nhân
> viên thu ngân gửi yêu cầu thanh toán và nhận hóa đơn. Nhân viên bếp cập nhật trạng thái
> chế biến và nhận danh sách món cần làm theo từng trạm. Còn quản lý thì cấu hình thực
> đơn, nhân viên, thuế phí, và nhận lại báo cáo doanh thu cùng nhật ký kiểm toán.
>
> Sơ đồ này giúp mình nhìn tổng thể ranh giới của hệ thống trước khi đi vào chi tiết
> từng chức năng.

---

## PHẦN D — GIAO DIỆN VÀ CHỨC NĂNG (~3 phút, mỗi màn hình ~45 giây)

*(Phần này nói song song với demo màn hình thật hoặc ảnh chụp — vừa nói vừa chỉ vào
màn hình, không đọc hết nguyên văn bên dưới, chỉ dùng làm ý chính.)*

### Slide 10 — Màn hình khách hàng (45 giây)

> Đây là màn hình gọi món dành cho khách hàng, truy cập qua đường dẫn riêng của từng
> bàn. Khách xem thực đơn theo danh mục, chọn món kèm các tùy chọn như size hay độ cay,
> giỏ hàng được lưu ở phía máy chủ nên không bị mất nếu lỡ tải lại trang. Sau khi gửi
> đơn, khách có thể theo dõi trạng thái món ăn của mình theo thời gian thực mà không cần
> hỏi lại nhân viên.
>
> Em xin nói rõ một điểm: hiện tại khách truy cập bằng đường dẫn riêng của bàn, hạ tầng
> để chuyển sang quét mã QR thật đã có sẵn — mỗi bàn đã có mã định danh duy nhất — nhưng
> phần sinh ảnh QR để in dán tại bàn thì em chưa kịp hoàn thiện, đây là một trong những
> hạn chế em sẽ nói ở phần kết luận.

### Slide 11 — Màn hình nhân viên phục vụ/thu ngân (45 giây)

> Đây là màn hình chính của nhân viên phục vụ và thu ngân. Sơ đồ bàn hiển thị trạng thái
> từng bàn: trống, đang phục vụ, hoặc cần chú ý. Điểm em muốn nhấn mạnh là màn hình chi
> tiết một bàn gộp chung cả thực đơn để gọi món hộ khách và giỏ hàng trên cùng một màn
> hình, không cần chuyển trang qua lại — vì trên thực tế nhân viên vừa nói chuyện với
> khách vừa bấm chọn món, nếu phải chuyển trang liên tục sẽ rất bất tiện.
>
> Phần tính tiền tính theo đúng thứ tự phí dịch vụ trước, thuế sau, và có cơ chế chống
> bấm thanh toán trùng lặp.

### Slide 12 — Màn hình bếp — KDS (40 giây)

> Đây là màn hình bếp, hiển thị danh sách món theo từng trạm chế biến — ví dụ bếp nóng,
> quầy nước, hay khu tráng miệng — sắp xếp theo thời gian gửi đơn. Nhân viên bếp chỉ có
> thể chuyển trạng thái theo một chiều: đã nhận, đang làm, rồi đã xong, không có nút lùi
> trạng thái để tránh nhầm lẫn. Mọi cập nhật hiển thị tức thời trên tất cả màn hình bếp
> đang mở cùng lúc.

### Slide 13 — Màn hình hậu đài (40 giây)

> Cuối cùng là màn hình hậu đài dành cho quản lý hoặc chủ quán. Trang chủ hiển thị tổng
> quan doanh thu trong ngày và các món bán chạy. Từ đây quản lý có thể chỉnh sửa thực
> đơn, quản lý nhân viên, quản lý bàn và điểm bán hàng, cấu hình thuế và phí dịch vụ,
> cũng như xem lại danh sách hóa đơn và nhật ký kiểm toán cho mọi thao tác nhạy cảm liên
> quan đến tiền.

---

## PHẦN E — KẾT LUẬN (~1 phút 30 giây)

### Slide 14 — Kết quả đạt được (35 giây)

> Về kết quả đạt được, em đã xây dựng hoàn chỉnh bốn màn hình phối hợp thời gian thực
> trên cùng một bộ dữ liệu. Việc tính tiền được thực hiện bằng số nguyên tuyệt đối, có
> kiểm thử xác nhận bằng số liệu thực tế để đảm bảo không có sai số làm tròn. Hệ thống
> có phân quyền theo 5 vai trò kèm nhật ký kiểm toán đầy đủ. Và toàn bộ được kiểm chứng
> bằng 811 kịch bản kiểm thử tự động, chạy trực tiếp trên cơ sở dữ liệu thật chứ không
> phải dữ liệu giả lập.

### Slide 15 — Hạn chế & hướng phát triển (40 giây)

> Bên cạnh đó, đề tài vẫn còn một số hạn chế mà em nhận thức rõ. Như đã nói, phần sinh
> ảnh mã QR thật cho từng bàn chưa hoàn thiện. Module quản lý tồn kho nguyên liệu cũng
> chưa có, hiện chỉ dừng ở mức đánh dấu món còn bán hay ngừng bán. Và phần thanh toán
> hiện đang ở chế độ minh họa quy trình, chưa kết nối cổng thanh toán thật.
>
> Về hướng phát triển tiếp theo, em dự định hoàn thiện việc sinh mã QR, xây dựng module
> tồn kho, thêm báo cáo đóng ca — mà mô hình dữ liệu đã chuẩn bị sẵn — và tích hợp cổng
> thanh toán thật theo từng loại tiền tệ. Ngoài ra em cũng đang cân nhắc hướng tích hợp
> AI vào hệ thống, ví dụ gợi ý món cho khách dựa trên lịch sử gọi món, một trợ lý giúp
> quản lý hỏi báo cáo doanh thu bằng ngôn ngữ tự nhiên, hoặc phát hiện các thao tác bất
> thường trên nhật ký kiểm toán.

### Slide 16 — Cảm ơn / Hỏi đáp (10 giây)

> Trên đây là toàn bộ phần trình bày của em. Em xin cảm ơn thầy/cô đã theo dõi, và em
> sẵn sàng trả lời các câu hỏi ạ.

---

## GHI CHÚ KHI TRÌNH BÀY

- **Nếu bị hỏi "vì sao không dùng WebSocket?"** — trả lời gọn: Route Handler của
  Next.js không nâng cấp lên WebSocket được, và nền tảng serverless (Vercel) không giữ
  kết nối TCP mở lâu dài; nếu muốn WebSocket thật thì phải tự dựng server riêng.
- **Nếu bị hỏi "tại sao không dùng số thực để tính tiền?"** — trả lời: số thực nhị phân
  không biểu diễn chính xác số thập phân (ví dụ 19.99 × 100 không ra đúng 1999 trong
  phép tính dấu phẩy động), nên toàn bộ hệ thống quy về đơn vị nhỏ nhất của tiền tệ và
  tính bằng số nguyên.
- **Nếu bị hỏi "hệ thống đã dùng thật chưa?"** — trả lời trung thực: hiện là sản phẩm
  hoàn chỉnh về mặt nghiệp vụ và đã kiểm thử kỹ trên môi trường phát triển, nhưng phần
  thanh toán thật và triển khai thực tế tại một quán cụ thể là bước tiếp theo.
- **Nếu bị hỏi về mã QR** — trả lời thẳng như đã nêu ở slide 10/15, không né tránh: hạ
  tầng đã có (mã định danh riêng từng bàn), phần còn thiếu là sinh ảnh QR để in — đây là
  một hạng mục nhỏ, không phải thiết kế lại từ đầu.
