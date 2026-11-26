# Rà soát app Đại lý Bốn Biển — còn thiếu gì?

Ngày 26/11/2026. **Lưu ý:** bản rà soát này do Claude tự làm. Kết nối GPT cần API key OpenAI, bạn đã từ chối nhập nên **GPT không tham gia**. Muốn GPT phản biện thêm, bạn có thể tự thêm key cho `api.openai.com` trong phần cài đặt môi trường của Claude.

## Đã sửa trong lần này

| # | Chỗ thiếu | Vì sao quan trọng | Đã làm |
|---|---|---|---|
| 1 | Không xóa được nhiều mục cùng lúc | Nhập sai hàng loạt phải xóa từng cái | Nút **☑️ Chọn nhiều để xóa** ở 7 trang: Hóa đơn, Nhập hàng, Thu chi, Chi tiêu, Khách hàng, Nhà cung cấp, Sản phẩm. Có **Xóa đã chọn** và **Xóa tất cả** (phải gõ "XÓA"). Mục nào bị chặn thì bỏ qua và báo lý do, các mục khác vẫn xóa |
| 2 | Không có cách làm lại từ đầu | Muốn bỏ hết dữ liệu nhập thử | **Cài đặt → 🧹 Xóa tất cả dữ liệu**, 2 mức: chỉ giao dịch, hoặc sạch hết. App **bắt buộc xuất sao lưu trước**; máy chủ cũng từ chối nếu chưa sao lưu trong 15 phút gần nhất. Phải gõ "XÓA TẤT CẢ" |
| 3 | **Có sao lưu nhưng không nạp lại được** | Xóa tất cả xong thì file sao lưu vô dụng | **Cài đặt → ♻️ Khôi phục từ file sao lưu**. Chỉ chạy khi chưa có giao dịch nào, nên không ghi đè dữ liệu đang dùng. Test: xóa sạch rồi khôi phục, 20 bảng khớp từng dòng, Tổng quan giống hệt |
| 4 | **Không ghi được trả nợ nhà cung cấp** | Nợ NCC chỉ tăng, không bao giờ giảm; sổ quỹ thiếu khoản chi thật | **Nhà cung cấp → bấm tên → 💸 Trả nợ**. Trừ dần vào phiếu nợ cũ nhất. Không tính vào chi tiêu (vì đã nằm trong vốn). Chủ xóa được lần trả nhập sai |
| 5 | Không xuất Excel | Kế toán, đối chiếu, gửi người khác | Nút **📊 Excel** ở Hóa đơn (2 sheet: hóa đơn + chi tiết hàng), Chi tiêu, Sổ quỹ, Doanh thu & lợi nhuận (bảng tháng + vốn theo ngày). File .xlsx thật; đã mở thử bằng LibreOffice và openpyxl |

## Còn thiếu, chưa làm (xếp theo mức quan trọng)

1. **Sao lưu tự động hằng đêm.** Vẫn phụ thuộc vào việc bạn bấm nút. Cần bạn quyết cách làm (xem REPORT.md, mục 4).
2. **Sửa hóa đơn.** Hiện chỉ xóa hoặc hủy rồi lập lại. Sửa trực tiếp dễ làm lệch kho FIFO nên cố ý chưa làm.
3. **Trả hàng một phần.** Khách trả 1 trong 3 bao: hiện phải hủy cả hóa đơn rồi lập lại.
4. **Mức giá theo khách** (khách quen, số lượng lớn), ngoài giá lẻ và giá sỉ.
5. **Quét mã vạch bằng camera.** Ô mã vạch đã có, chưa có quét.
6. **In thử trên máy in K80/A5 thật.** Mới thử bản xem trước trên trình duyệt.
7. **Khôi phục sang project Supabase khác.** Hiện chỉ khôi phục vào đúng project đã sao lưu; app báo lỗi rõ nếu file thuộc project khác.
8. **Nhật ký thao tác chưa có màn hình xem.** Mọi lần xóa đều lưu bản chụp trong `audit_logs`, nhưng chưa có trang để chủ xem lại.

## Rủi ro cần biết

- **"Xóa tất cả" rất mạnh.** Đã có 4 lớp chặn: chỉ chủ, phải gõ đúng, bắt buộc sao lưu trước, máy chủ kiểm tra sao lưu trong 15 phút. Tuy vậy, nếu file sao lưu bị mất thì không lấy lại được dữ liệu. Hãy cất file sao lưu vào Google Drive hoặc Zalo.
- **Xóa hẳn không để lại dấu trên báo cáo.** Nếu cần truy vết (ví dụ nghi nhân viên gian lận), "Hủy" tốt hơn "Xóa". Hiện chỉ chủ mới xóa được.
