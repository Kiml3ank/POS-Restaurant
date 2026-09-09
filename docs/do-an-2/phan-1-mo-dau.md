# PHẦN I: MỞ ĐẦU

## I. LÝ DO CHỌN ĐỀ TÀI

Trong thời đại hiện nay, khi ngành kinh doanh ẩm thực phát triển mạnh mẽ, việc ứng dụng công nghệ vào quản lý bán hàng tại nhà hàng, quán ăn đã trở thành một yêu cầu tất yếu. Đặc biệt, công tác quản lý gọi món, chế biến và thanh toán không chỉ cần đảm bảo tính chính xác mà còn phải nhanh chóng, đồng bộ theo thời gian thực giữa nhiều bộ phận cùng lúc. Vì vậy, việc xây dựng một hệ thống phần mềm hỗ trợ quản lý bán hàng cho nhà hàng là rất cần thiết, giúp chủ quán dễ dàng theo dõi, lưu trữ và xử lý thông tin một cách khoa học, đồng thời nâng cao hiệu quả kinh doanh.

Đề tài "Xây dựng hệ thống quản lý điểm bán hàng cho nhà hàng (Restaurant POS)" được thực hiện nhằm nghiên cứu và phát triển một hệ thống đáp ứng nhu cầu vận hành nhà hàng hiện đại. Trong quá trình thực hiện, đề tài tiến hành tìm hiểu các yêu cầu chức năng, phân tích nghiệp vụ thực tế tại nhà hàng, thiết kế cơ sở dữ liệu và xây dựng quy trình hoạt động của hệ thống. Mục tiêu là tạo ra một phần mềm có thể hỗ trợ quản lý hoạt động nhà hàng một cách toàn diện, bao gồm thực đơn, gọi món, chế biến tại bếp, thanh toán cũng như các báo cáo thống kê doanh thu phục vụ công tác quản lý.

Hệ thống được thiết kế với tiêu chí dễ sử dụng, đảm bảo độ chính xác tuyệt đối trong tính toán tiền tệ, đồng bộ dữ liệu theo thời gian thực giữa khách hàng — nhân viên — bếp, và có khả năng mở rộng trong tương lai. Ngoài việc tập trung vào các yếu tố kỹ thuật, đề tài còn hướng đến tính ứng dụng thực tiễn, nhằm giúp nâng cao hiệu quả quản lý bán hàng cho các nhà hàng, quán ăn quy mô vừa và nhỏ.

## II. MỤC TIÊU CỦA ĐỀ TÀI

- Khảo sát và phân tích quy trình vận hành thực tế của một nhà hàng phục vụ tại bàn, từ lúc khách gọi món đến lúc thanh toán.
- Xây dựng hệ thống POS gồm 4 màn hình phối hợp thời gian thực: khách hàng (gọi món qua đường dẫn/mã định danh riêng của từng bàn), nhân viên (mở bàn, tính tiền), bếp (nhận và xử lý order), và quản lý hậu đài.
- Xác định các chức năng cốt lõi của hệ thống: quản lý thực đơn, quản lý bàn, xử lý đơn hàng, tính tiền, thanh toán, xuất hóa đơn và phân quyền nhân viên.
- Hình thành cơ sở lý thuyết và mô hình dữ liệu phục vụ cho việc phát triển một hệ thống POS chính xác, dễ thao tác và có khả năng triển khai thực tế.

## III. ĐỐI TƯỢNG VÀ PHẠM VI NGHIÊN CỨU

**Đối tượng nghiên cứu:**

- Các nghiệp vụ và yêu cầu liên quan đến công tác quản lý bán hàng trong mô hình nhà hàng phục vụ tại bàn.
- Các chức năng cơ bản và thành phần cần thiết của một hệ thống POS nhà hàng.
- Cách tổ chức dữ liệu và quy trình xử lý thông tin phục vụ hoạt động gọi món, chế biến và thanh toán.

**Phạm vi nghiên cứu:**

- Đề tài tập trung phân tích, thiết kế và xây dựng hệ thống POS dạng web áp dụng cho một nhà hàng/chi nhánh phục vụ tại bàn.
- Nội dung bao gồm các chức năng: quản lý thực đơn, quản lý bàn, gọi món, theo dõi trạng thái bếp theo thời gian thực, tính tiền, thanh toán, xuất hóa đơn và phân quyền nhân viên.
- Chưa đi sâu vào quản lý kho nguyên liệu phức tạp và chưa kết nối cổng thanh toán thật của ngân hàng.

## IV. PHƯƠNG PHÁP NGHIÊN CỨU

**Thu thập và tổng hợp thông tin:** tìm hiểu quy trình gọi món — chế biến — thanh toán thực tế tại nhà hàng, đồng thời khảo sát các hệ thống POS hiện có để xác định nhu cầu thực tế.

**Phân tích hệ thống:** xác định yêu cầu chức năng của phần mềm, các nhóm người dùng (khách hàng, phục vụ, thu ngân, bếp, quản lý) và mối liên kết giữa các thành phần trong hệ thống.

**Mô hình hóa dữ liệu:** xây dựng mô hình cơ sở dữ liệu phù hợp với nghiệp vụ nhà hàng (thực đơn nhiều lớp, phiên gọi món theo bàn, đơn hàng, thanh toán), đảm bảo tính logic và khả năng mở rộng.

**Xây dựng sơ đồ chức năng và quy trình nghiệp vụ:** thiết kế sơ đồ mô tả luồng xử lý đơn hàng qua từng trạng thái, giúp người dùng dễ hiểu và triển khai hệ thống một cách thuận tiện.
