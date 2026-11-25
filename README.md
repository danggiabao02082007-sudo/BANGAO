# 🌾 Đại lý Bốn Biển — Quản lý & bán gạo

Web app cài được trên máy tính và điện thoại (PWA), dùng chung một dữ liệu trên Supabase.
Xây theo `SPEC.md` — **Giai đoạn 1** (nền tảng) + một phần giai đoạn 2.

## Quyết định đã chốt
| Mục | Lựa chọn |
|---|---|
| Hình thức | Web app + PWA |
| Lưu dữ liệu | Supabase (PostgreSQL + đăng nhập), không dùng NestJS |
| Mất mạng | Chỉ chạy online |
| Giá vốn | **FIFO theo lô** — mỗi dòng phiếu nhập tạo 1 lô, bán xuất lô cũ trước |
| Đơn vị tồn kho | **Bao** — mỗi sản phẩm có số kg/bao riêng; bán theo bao, kg hoặc tấn đều quy đổi về bao |
| Khổ in | Có cả K80 và A5 (chưa chốt, chọn khi in) |

## Đã làm
- Đăng nhập, 3 vai trò (Chủ / Quản lý / Nhân viên), RLS ở tầng cơ sở dữ liệu.
- Tổng quan: doanh thu, tiền thực thu, lợi nhuận gộp (3 chỉ tiêu riêng), công nợ, tồn kho, biểu đồ 7 ngày / 6 tháng, top 5, tồn thấp, nợ cũ.
- Bán hàng: tìm theo tên / mã / mã vạch (Enter), giá lẻ/sỉ, đổi giá (chỉ quản lý), giảm giá dòng + hóa đơn, tiền mặt / chuyển khoản / ghi nợ / trả một phần, tiền thừa, in K80/A5.
- Hóa đơn: tra cứu, xem, in lại, hủy có lý do (hàng trả về đúng lô, hoàn quỹ, xóa nợ, giữ lịch sử).
- Sản phẩm & kho: quy đổi đơn vị, lịch sử giá, lô FIFO, điều chỉnh hao hụt có lý do, lịch sử biến động, đối soát.
- Nhập hàng (tạo lô), nhà cung cấp, khách hàng + thu nợ (không tính doanh thu), sổ quỹ + ghi thu/chi, báo cáo lợi nhuận gộp/ròng.

## Chưa làm (theo lộ trình SPEC)
Trả hàng một phần, trả nợ NCC, báo cáo chi tiết + xuất Excel/PDF (GĐ 3), quét mã vạch bằng camera, sao lưu tự động (GĐ 4 — gói Supabase trả phí có sao lưu hằng ngày; gói miễn phí thì không).

## 7 nguyên tắc dữ liệu → cách thực hiện
1. Không xóa hóa đơn: không có quyền DELETE ở bảng nào; hủy = đổi trạng thái + `audit_logs`.
2. Không sửa tồn trực tiếp: bảng kho chỉ ghi qua hàm; mọi thay đổi có dòng `inventory_transactions`.
3. Thu nợ ≠ doanh thu: `record_customer_payment` chỉ ghi quỹ + giảm nợ.
4. Mã duy nhất: `HD000001`, `PN0001`, `DC0001`, `PT000001` (UNIQUE + bộ đếm có khóa).
5. Giá lúc bán được lưu vào từng dòng hóa đơn (`unit_price`, `list_price`).
6. Một transaction: mỗi nghiệp vụ là một hàm PostgreSQL; lỗi ở bất kỳ bước nào → hoàn tác toàn bộ.
7. Sao lưu: xem mục "Chưa làm".

## Cài đặt lên Supabase (làm 1 lần)
1. Tạo project tại https://supabase.com (gói Free).
2. **SQL Editor** → chạy lần lượt 3 file trong `supabase/migrations/` (theo thứ tự tên).
3. **Authentication → Sign In / Providers**: tắt *Allow new users to sign up* (app nội bộ).
4. **Authentication → Users → Add user**: tạo tài khoản **chủ cửa hàng trước tiên** (tài khoản đầu tiên tự thành Chủ). Các tài khoản sau là Nhân viên, đổi quyền trong app → Cài đặt.
5. **Project Settings → API**: lấy *Project URL* và khóa *anon / publishable*, điền vào `public/config.js`.
6. `npm install && npm run build` → đưa thư mục `dist/` lên GitHub Pages (hoặc bất kỳ hosting tĩnh nào).

## Kiểm thử
`npm test` — dựng Supabase cục bộ bằng Docker, chạy 44 kiểm thử nghiệp vụ (FIFO, phân quyền, transaction, công nợ, hủy hóa đơn, đối soát).
