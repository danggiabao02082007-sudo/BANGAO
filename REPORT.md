# Báo cáo việc chạy qua đêm — app Đại lý Bốn Biển (repo BANGAO)

Ngày: 25–26/11/2026 · Link: https://danggiabao02082007-sudo.github.io/BANGAO/
Đã triển khai lên link sau khi **toàn bộ test đạt**. **Không sửa/xóa dữ liệu thật** trên Supabase (kiểm chứng bằng dấu vân tay dữ liệu trước/sau, xem mục 5).

---

## 1. Đã xong

| # | Việc | Commit | Trạng thái |
|---|---|---|---|
| 1 | Lợi nhuận thực = doanh thu − vốn − chi tiêu (ngày + tháng) | `d1e7fbc` | ✅ Đã lên link |
| 2 | Nút **Xuất sao lưu** + nhắc sao lưu định kỳ | `c851cd9` | ✅ Đã lên link |
| 3 | Bật/tắt hiệu ứng động trong Cài đặt, tự giảm khi dưới 30 fps, tối ưu hiệu năng | `e3d9a00` | ✅ Đã lên link |
| 4 | Báo cáo này | (commit cuối) | ✅ |

### (1) Lợi nhuận thực
- **Giữ nguyên số cũ**: "Lợi nhuận" vẫn là doanh thu − vốn (test xác nhận trùng khớp với báo cáo cũ).
- **Thêm** ở *Tổng quan*: thẻ 🏆 **Lợi nhuận thực hôm nay**, có phép tính: `= doanh thu − vốn − chi`.
- **Thêm** ở *Doanh thu & lợi nhuận*:
  - Thẻ **Lợi nhuận thực ngày dd/mm/yyyy** với phép tính đầy đủ.
  - Ô **Lợi nhuận thực tháng** với phép tính: Doanh thu − Vốn − Chi tiêu.
  - Bảng theo ngày có thêm dòng "LN thực" dưới mỗi ngày.
- **Định nghĩa chi tiêu** = các khoản chi vận hành trong sổ quỹ: điện nước, vận chuyển, nhân công, chi khác (gồm mọi khoản ở mục *Chi tiêu*).
  - **Không** tính chi nhập hàng, vì đã nằm trong vốn; test xác nhận không bị tính trùng.
  - **Không** tính khoản hoàn tiền khi hủy hóa đơn.
- Hàm mới trên máy chủ: `real_profit_report(từ ngày, đến ngày)`. Chỉ chủ và quản lý xem được.

### (2) Sao lưu
- **Cài đặt → 💾 Sao lưu dữ liệu → Xuất sao lưu** (chỉ **chủ cửa hàng**):
  - Tải 1 file JSON chứa **toàn bộ 31 bảng**: sản phẩm, giá nhập, lô hàng, kho, hóa đơn, công nợ, sổ quỹ, chi tiêu, nhật ký.
  - Trên điện thoại, app mở bảng *Chia sẻ* để lưu vào Tệp, Google Drive hoặc Zalo. Trên máy tính, file được tải xuống.
  - Tên file: `bonbien-saoluu-YYYY-MM-DD-HHmm.json`.
- **Nhắc định kỳ**: mỗi lần xuất, app ghi một dòng vào bảng `backup_logs`.
  - *Tổng quan* hiện dải nhắc khi **chưa sao lưu lần nào** hoặc **quá 7 ngày** chưa sao lưu.
  - Bấm vào dải nhắc là mở thẳng trang Cài đặt.
- Quản lý và nhân viên **không** xuất được và không thấy nút.
- Thử thật trên trình duyệt: file 41 KB, đủ 31 bảng, số hóa đơn khớp; dải nhắc biến mất sau khi xuất.

### (3) Hiệu ứng động
- **Cài đặt → 🎞️ Hiệu ứng động** có 4 nút, **nhớ riêng trên từng máy** (localStorage):
  - 🤖 **Tự động** (mặc định): đo khung hình/giây lúc mở app; **dưới 30 fps thì tự chuyển sang Nhẹ**. Nếu điện thoại bật "Giảm chuyển động" thì tắt hẳn.
  - ✨ Đầy đủ · 🍃 Nhẹ (tắt các chuyển động nền) · ⏸️ Tắt (tắt hết, tiết kiệm pin nhất).
- **Tối ưu hiệu năng**: tách tranh nền thành 11 lớp, mỗi thứ chuyển động là một lớp riêng do GPU di chuyển, thay vì vẽ lại cả bức tranh SVG mỗi khung hình.
- **Đánh đổi:** để đạt mức tiết kiệm này, tôi đã bỏ 4 chi tiết nhỏ:
  - cánh cò đập,
  - cánh chuồn chuồn rung,
  - tia nắng xoay,
  - mặt nước lấp lánh.

  Cò và chuồn chuồn vẫn bay hoặc lượn, lúa vẫn đung đưa, hạt lúa vẫn rơi, mây vẫn trôi.

---

## 2. Kết quả test

| Loại test | Kết quả |
|---|---|
| Test nghiệp vụ trên Supabase cục bộ (`npm test`) | **83/83 đạt**: 63 cũ + 10 lợi nhuận thực + 10 sao lưu |
| Test giao diện máy tính + điện thoại (`tests/browser/e2e.cjs`) | Đạt, **0 lỗi JavaScript** |
| Phép tính hiển thị (tự cộng trừ lại số trên màn hình) | Thẻ Tổng quan, thẻ ngày, thẻ tháng: **đúng** |
| Xuất sao lưu bằng trình duyệt | File tải được, 31 bảng, nhắc biến mất sau khi xuất |
| Link thật sau khi triển khai | Tải được, 0 lỗi JS, kết nối Supabase thật OK |

**Hiệu năng:** đo trên khung màn hình iPhone 13 giả lập, trang Tổng quan, CPU bị giả lập chậm 4 lần, Chromium headless không GPU.

| Chế độ | Khung hình/giây | CPU bận (trước tối ưu → sau) |
|---|---|---|
| Đầy đủ | 60 | **57% → 2%** |
| Nhẹ | 60 | 0% |
| Tắt | 60 | 0% |
| Tự động, máy yếu giả lập (~21–22 fps) | — | **tự chuyển sang Nhẹ** ✅ |

Lưu ý: với CPU chậm 4 lần, app vẫn đạt 60 fps nên chế độ Tự động giữ mức Đầy đủ. Ngưỡng dưới 30 fps được kiểm chứng bằng cách giả lập máy yếu (mỗi khung hình tốn thêm 45 ms). Số đo trên máy ảo không GPU **có thể khác** điện thoại thật.

---

## 3. Còn thiếu / chưa làm được

1. **Sao lưu tự động hoàn toàn** (không cần bấm) chưa làm, vì cần quyền hoặc quyết định mới (xem mục 4).
2. **Khôi phục từ file sao lưu** chưa làm. Khôi phục sẽ ghi đè dữ liệu đang có nên rủi ro cao; cần bạn quyết cách làm (khôi phục vào project mới hay ghi đè).
3. **Giới hạn của Xuất sao lưu:** toàn bộ dữ liệu trả về trong một lần gọi. Khi dữ liệu rất lớn (ví dụ hàng chục nghìn hóa đơn), có thể chậm hoặc vượt giới hạn. Hiện dữ liệu nhỏ nên chưa ảnh hưởng.
4. **Chưa thử đăng nhập trên link thật bằng tài khoản của bạn**, vì bạn đã đổi mật khẩu và tôi không có. Toàn bộ chức năng đã được test trên Supabase cục bộ có cấu trúc giống hệt cloud.
5. Các phần theo lộ trình SPEC vẫn chưa làm:
   - trả hàng một phần,
   - trả nợ nhà cung cấp theo phiếu,
   - mức giá "khách quen / số lượng lớn",
   - xuất Excel/PDF,
   - quét mã vạch bằng camera,
   - in thử trên máy in K80/A5 thật.
6. Docker trên máy build không ổn định (phải khởi động lại vài lần). Việc này không ảnh hưởng tới app, chỉ ảnh hưởng tới việc chạy test.

---

## 4. Điểm bạn cần quyết

1. **Sao lưu định kỳ trên gói Free của Supabase.** Gói Free không tự sao lưu. Các lựa chọn:

   | Cách | Cần gì | Ưu / nhược |
   |---|---|---|
   | **A. Như hiện tại**: bấm "Xuất sao lưu" mỗi tuần, app nhắc | Không cần gì | Đã làm. Phụ thuộc vào việc bạn nhớ bấm |
   | **B. GitHub Actions tự chạy hằng đêm**, xuất dữ liệu, **mã hóa bằng mật khẩu**, lưu vào **repo riêng tư** | Bạn thêm 2 bí mật vào GitHub (chuỗi kết nối CSDL và mật khẩu mã hóa) và tạo 1 repo **private** | Tự động hoàn toàn. Tôi chưa làm vì cần quyền mới. **Không** lưu vào repo BANGAO vì repo đó đang **công khai** |
   | **C. Nâng Supabase lên gói trả phí** | Thẻ thanh toán | Supabase tự sao lưu hằng ngày. Giá hiện hành tôi chưa xác minh, cần xem trên trang giá của Supabase |

   Đề xuất của tôi: giữ **A** ngay bây giờ, làm thêm **B** khi bạn đồng ý thêm bí mật.
2. **Repo BANGAO đang công khai.** Mã nguồn không chứa mật khẩu; khóa anon là khóa công khai, được bảo vệ bằng RLS. Tuy vậy, cân nhắc chuyển sang **private**. Lưu ý: GitHub Pages trên repo private cần gói GitHub trả phí (thông tin này tôi chưa xác minh lại).
3. **Token Supabase** vẫn đang lưu trong môi trường Claude. Nên **thu hồi** tại https://supabase.com/dashboard/account/tokens khi không cần tôi chỉnh cơ sở dữ liệu nữa.
4. **Định nghĩa chi tiêu** trong lợi nhuận thực hiện **không gồm** chi nhập hàng và trả nợ nhà cung cấp (vì đã nằm trong vốn). Nếu bạn muốn tính khác, cho tôi biết.
5. **4 chi tiết nhỏ đã bỏ để nhẹ máy** (cánh cò, cánh chuồn chuồn, tia nắng xoay, mặt nước lấp lánh). Nếu muốn giữ lại, tôi có thể làm chúng thành lớp riêng, nhưng app sẽ tốn thêm một ít CPU.

---

## 5. Cam kết dữ liệu thật

- Migration mới chỉ **thêm** hàm (`real_profit_report`, `export_backup`, `backup_status`) và **thêm** bảng `backup_logs`. Đã rà tự động: không có lệnh INSERT, UPDATE, DELETE, DROP hay ALTER trên bảng cũ.
- **Dấu vân tay dữ liệu thật** (số dòng và tổng tiền của hóa đơn, dòng hàng, lô, sổ kho, sổ quỹ, chi tiêu, sản phẩm, phiếu nhập, thanh toán) **trước và sau khi áp migration giống hệt nhau**: `19d609d690b6d652e8d2d6170afaff4d`.
- **Không gọi** `export_backup` trên cloud, vì lệnh này ghi một dòng vào `backup_logs`. Bảng `backup_logs` trên cloud vẫn trống.
- PN0001 và HD000001 **không bị đụng tới** trong đợt này.
