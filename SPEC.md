# SPEC — Ứng dụng quản lý & bán gạo (Rice Management)

> Tài liệu đặc tả để Claude Code đọc và xây dựng ứng dụng.
> Nguồn: cuộc trao đổi giữa chủ dự án (Gia Bảo) và ChatGPT, chat "Tạo ứng dụng bán gạo" (25/11/2026), đã được Claude tổng hợp và rà soát.
> Quy ước: **[ĐÃ CHỐT]** = chủ dự án đã quyết định. **[ĐỀ XUẤT]** = ChatGPT đề xuất, chủ dự án chưa xác nhận. **[CHƯA CHỐT]** = bắt buộc hỏi chủ dự án trước khi code phần liên quan.

---

## 0. Hướng dẫn cho Claude Code

1. Đọc toàn bộ file này trước khi viết code.
2. **Trước khi bắt đầu, hỏi chủ dự án 6 câu ở Mục 9 (Quyết định chưa chốt)** và xác nhận tech stack ở Mục 7. Không tự giả định.
3. Xây theo lộ trình ở Mục 8, xong giai đoạn nào thì cho chủ dự án chạy thử giai đoạn đó.
4. Tuân thủ tuyệt đối 7 nguyên tắc dữ liệu ở Mục 5.
5. Giao diện tiếng Việt, tiền tệ VNĐ (định dạng `12.500.000đ`), ngày `dd/mm/yyyy`.

---

## 1. Phạm vi [ĐÃ CHỐT]

| Hạng mục | Lựa chọn |
|---|---|
| Mục đích | **Quản lý nội bộ** cửa hàng (nhập, bán, kho, công nợ, thu chi). Không bán online cho khách. |
| Nền tảng | **Cả máy tính và điện thoại**, dùng chung một dữ liệu |
| Quy mô | **Một cửa hàng / một kho** |
| Mặt hàng | Gạo, lúa, cám |

Nguyên tắc cốt lõi: liên kết **hóa đơn ↔ tồn kho ↔ thanh toán ↔ công nợ** phải luôn chính xác. Đây không chỉ là app nhập hóa đơn.

---

## 2. Cấu trúc menu (9 phân hệ)

01. Tổng quan (Dashboard)
02. Bán hàng
03. Sản phẩm & kho hàng
04. Nhập hàng
05. Khách hàng
06. Nhà cung cấp
07. Thu chi & công nợ
08. Báo cáo thống kê
09. Cài đặt hệ thống

---

## 3. Đặc tả màn hình

### 3.1 Dashboard
- Chỉ tiêu: doanh thu hôm nay; tiền thực thu; công nợ phải thu; công nợ phải trả NCC; lợi nhuận tạm tính; tồn kho.
- **Doanh thu, tiền thực thu, lợi nhuận là 3 chỉ tiêu riêng biệt, không tính lẫn nhau.**
- Biểu đồ: doanh thu 7 ngày; doanh thu theo tháng; top 5 sản phẩm bán chạy; tình trạng tồn kho; công nợ sắp đến hạn.
- Nút nhanh: Tạo hóa đơn · Nhập hàng · Thêm sản phẩm · Thêm khách hàng · Ghi thu · Ghi chi.

### 3.2 Bán hàng (ưu tiên tối ưu thao tác nhất)
- Bố cục: Tìm kiếm (tên / mã hàng / mã vạch) · Danh sách hàng + giá · Giỏ hàng · Chọn khách · Thanh toán (tiền mặt / chuyển khoản / ghi nợ) · Lưu / in / xem trước.
- Dòng hóa đơn: mã SP, tên SP, đơn vị tính, số lượng, đơn giá, thành tiền.
- Công thức:
  - `Thành tiền = Số lượng × Đơn giá − Giảm giá dòng`
  - `Còn phải trả = Tổng thanh toán − Tiền đã thanh toán`
  - Tính tiền khách đưa và tiền thừa.
- Hỗ trợ: nhiều sản phẩm/hóa đơn; đổi giá theo hóa đơn (chỉ khi có quyền); giảm giá; thanh toán một phần; ghi nợ; in hóa đơn; tra cứu hóa đơn; hủy / trả hàng **có lưu lịch sử**.
- Nhiều mức giá: lẻ, sỉ, khách quen, theo số lượng lớn.
- Quy trình: Chọn khách → Thêm SP → Nhập SL & giá → Tính tổng → Chọn hình thức TT → Lưu → **Tự động cập nhật kho + công nợ + quỹ (trong 1 transaction)**.

### 3.3 Sản phẩm
- Nhóm: Gạo / Lúa / Cám.
- Trường: mã SP (vd `GAO001`), tên, nhóm, đơn vị cơ sở, giá nhập tham khảo, giá lẻ, giá sỉ, mã vạch, mức tồn cảnh báo, mô tả, trạng thái.
- Chức năng: thêm, sửa, **xóa mềm**, tìm, lọc theo nhóm, mã vạch/QR, quản lý giá, xem lịch sử nhập–bán.
- **Quy đổi đơn vị theo từng sản phẩm** (vd 1 bao = 50 kg với SP này, có thể 25 kg với SP khác; 1 tấn = 1.000 kg). Bán 2 bao loại 50 kg → trừ kho 100 kg.

### 3.4 Kho hàng
- Tồn hiện tại, nhập kho, xuất kho, điều chỉnh, kiểm kê, lịch sử biến động, cảnh báo tồn thấp.
- `Tồn cuối = Tồn đầu + Nhập − Xuất`
- **Mọi biến động (nhập, bán, trả, điều chỉnh) đều tạo bản ghi `inventory_transactions`. Không sửa trực tiếp số tồn.**
- **Hao hụt / chênh lệch cân** (đặc thù ngành gạo): vd nhập 1.000 kg, cân lại còn 995 kg → tạo phiếu điều chỉnh −5 kg kèm lý do.

### 3.5 Nhập hàng
- Tạo phiếu nhập (mã `PN0001`), chọn NCC, chọn SP, số lượng, giá vốn, tổng tiền, tiền đã trả, còn nợ, in phiếu.
- **Giá nhập thực tế lưu ở từng dòng phiếu nhập**, không chỉ ở bảng sản phẩm.

### 3.6 Khách hàng
- Trường: mã, tên, SĐT, địa chỉ, loại (sỉ/lẻ), tổng mua, tổng đã trả, công nợ hiện tại.
- Chức năng: thêm/sửa, tìm, lịch sử mua, hóa đơn chưa thanh toán, ghi nhận thanh toán, lịch sử trả nợ.

### 3.7 Nhà cung cấp
- Thông tin NCC, SP cung cấp, giá nhập từng đợt, lịch sử nhập, tổng mua, đã trả, công nợ phải trả.

### 3.8 Thu chi & công nợ (2 tab)
- **Tab Thu chi:** thu bán hàng, thu công nợ, chi nhập hàng, chi vận chuyển, nhân công, điện nước, chi khác; sổ quỹ.
- **Tab Công nợ:** nợ khách, nợ NCC, lịch sử thu/trả, ngày phát sinh, số còn lại, cảnh báo quá hạn.
- **Khách trả nợ hóa đơn cũ = thu hồi công nợ, KHÔNG cộng thêm vào doanh thu.**

### 3.9 Báo cáo
- Doanh thu, lợi nhuận (theo SP), nhập hàng, xuất hàng, tồn kho, công nợ, thu chi, SP bán chạy.
- Bộ lọc ngày bắt đầu – kết thúc; xuất Excel/PDF.
- Lợi nhuận phải tách: doanh thu → giá vốn hàng bán → **lợi nhuận gộp** → chi phí vận hành → **lợi nhuận ròng**.

### 3.10 Cài đặt
- Thông tin cửa hàng, cấu hình máy in, đơn vị tính, quy tắc mã SP, sao lưu/khôi phục, tài khoản & bảo mật.

---

## 4. Cơ sở dữ liệu [ĐỀ XUẤT: PostgreSQL]

### Nhóm A — Sản phẩm
| Bảng | Chức năng |
|---|---|
| `categories` | Danh mục (Gạo/Lúa/Cám) |
| `products` | Sản phẩm |
| `units` | Đơn vị tính |
| `product_units` | Quy đổi đơn vị theo SP |
| `product_prices` | Các mức giá & lịch sử giá |

`products`: `id UUID PK`, `product_code VARCHAR`, `barcode VARCHAR`, `name VARCHAR`, `category_id UUID`, `base_unit_id UUID`, `cost_price DECIMAL` (tham khảo), `retail_price DECIMAL`, `wholesale_price DECIMAL`, `min_stock DECIMAL`, `description TEXT`, `is_active BOOLEAN`.

### Nhóm B — Đối tác
`customers`, `suppliers`: đều có `id`, `code`, `name`, `phone`, `address`, `email` (tùy chọn), `note`, `created_at`, `is_active`. `customers` thêm loại sỉ/lẻ.

### Nhóm C — Chứng từ
| Bảng | Chức năng |
|---|---|
| `sales_invoices` / `sales_invoice_items` | Hóa đơn bán & chi tiết |
| `purchase_receipts` / `purchase_receipt_items` | Phiếu nhập & chi tiết |
| `sales_returns` / `sales_return_items` | Trả hàng & chi tiết |

`sales_invoices`: `id`, `invoice_code` (UNIQUE), `customer_id`, `invoice_date TIMESTAMP`, `subtotal`, `discount`, `total_amount`, `paid_amount`, `debt_amount`, `status`, `note`, `created_at`.

`sales_invoice_items`: `id`, `invoice_id`, `product_id`, `unit_id`, `quantity`, `conversion_factor`, `unit_price`, `discount`, `line_total`.
→ Lưu cả số lượng theo đơn vị bán **và** hệ số quy đổi. Vd 5 bao × 50 = xuất 250 kg.

### Nhóm D — Kho
`warehouses`, `inventory_balances` (tồn hiện tại), `inventory_transactions` (lịch sử, **bảng quan trọng nhất**), `stock_adjustments`, `stock_adjustment_items`.

Ví dụ `inventory_transactions` của Gạo ST25: +1.000 (nhập) → −200 (bán) → −100 (bán) → +20 (trả) ⇒ tồn 720 kg.

### Nhóm E — Tài chính
`payments`, `payment_allocations` (phân bổ 1 lần trả cho nhiều hóa đơn, vd trả 5 triệu cho 3 hóa đơn), `cash_transactions`, `expenses` (danh mục chi), `cash_accounts` (tiền mặt / ngân hàng), `receivable_payable_entries` (sổ công nợ).

### Nhóm F — Hệ thống
`users`, `roles`, `permissions`, `audit_logs`, `settings`.

### Luồng dữ liệu
- Bán: `customers → sales_invoices → sales_invoice_items → products → inventory_transactions`; `sales_invoices → payments → cash_transactions`
- Nhập: `suppliers → purchase_receipts → purchase_receipt_items → products → inventory_transactions`

---

## 5. Bảy nguyên tắc dữ liệu (BẮT BUỘC)

1. Không xóa vĩnh viễn hóa đơn đã phát sinh giao dịch (hủy = đổi trạng thái + log).
2. Không sửa trực tiếp tồn kho mà không tạo bản ghi điều chỉnh.
3. Không ghi thanh toán công nợ thành doanh thu mới.
4. Mỗi hóa đơn có mã duy nhất.
5. Lưu giá bán tại thời điểm bán; không dùng giá hiện tại để tính lại hóa đơn cũ.
6. Mọi nghiệp vụ cập nhật hóa đơn + thanh toán + kho chạy trong **một DB transaction**.
7. Có sao lưu tự động và khôi phục.

---

## 6. Phân quyền [ĐỀ XUẤT]

| Vai trò | Quyền |
|---|---|
| Chủ cửa hàng | Toàn quyền |
| Quản lý | Hàng hóa, kho, bán hàng, công nợ, báo cáo |
| Nhân viên | Bán hàng, lập hóa đơn, xem thông tin cần thiết |

Giới hạn: nhân viên không xóa hóa đơn, không sửa giá vốn, không xem báo cáo lợi nhuận (trừ khi chủ cho phép). Mọi chỉnh sửa ghi vào `audit_logs`.

---

## 7. Công nghệ [ĐỀ XUẤT — cần chủ dự án xác nhận]

| Thành phần | Đề xuất |
|---|---|
| Hình thức | Web responsive + **PWA** (cài lên điện thoại, không làm 2 app native) |
| Frontend | React / Next.js + Tailwind CSS |
| Backend | Node.js / NestJS |
| Database | PostgreSQL |
| Đăng nhập | Supabase Auth hoặc tự xây |
| Lưu trữ file | Supabase Storage |
| Triển khai | Cloud hosting |

---

## 8. Lộ trình

1. **Nền tảng:** đăng nhập, dashboard, sản phẩm, khách hàng, bán hàng & hóa đơn, kho cơ bản.
2. **Tài chính:** nhập hàng, nhà cung cấp, thu chi, công nợ, thanh toán.
3. **Báo cáo:** doanh thu, lợi nhuận, tồn kho, công nợ, xuất Excel/PDF.
4. **Hoàn thiện:** quét mã vạch, in hóa đơn, phân quyền, sao lưu, đồng bộ máy tính–điện thoại, kiểm tra bảo mật.

Tính năng nâng cao (sau): nhắc công nợ, lịch sử giá nhập, quản lý hao hụt chi tiết, nhật ký hoạt động.

---

## 9. Quyết định CHƯA CHỐT — hỏi chủ dự án trước khi code

ChatGPT đã hỏi 6 câu này nhưng chủ dự án **chưa trả lời**:

| # | Câu hỏi | Lựa chọn | Ảnh hưởng tới |
|---|---|---|---|
| 1 | Hình thức xây dựng | Web App + PWA / App riêng cho máy tính & điện thoại | Toàn bộ kiến trúc |
| 2 | Dùng khi mất Internet? | Chỉ cần online / Cần bán & lưu tạm offline | Đồng bộ, xung đột tồn kho, chống bán vượt tồn |
| 3 | Đơn vị tồn kho chính | Mọi thứ quy về kg / Linh hoạt kg, bao, tấn | `inventory_balances`, quy đổi |
| 4 | Phương pháp giá vốn | Bình quân gia quyền / FIFO / Cần tư vấn | FIFO cần thêm bảng theo dõi **lô hàng**; ảnh hưởng báo cáo lợi nhuận |
| 5 | Khổ in hóa đơn | A5 / Máy in nhiệt K80–K57 / Cả hai | Template in |
| 6 | Nơi lưu dữ liệu | Cloud / Máy tại cửa hàng / Cloud + dự phòng tại chỗ | Hosting, sao lưu, chi phí |

---

## 10. Điểm cần lưu ý (Claude rà soát)

- **Stack chồng chéo:** đề xuất dùng cả NestJS lẫn Supabase. Supabase đã có sẵn DB, Auth và API nên có thể thay phần lớn backend NestJS. Cần chọn một hướng để tránh làm trùng.
- **`roles` / `permissions` vs 3 vai trò cố định:** với 1 cửa hàng, 3 vai trò cố định là đủ. Bảng phân quyền động có thể để giai đoạn 4.
- **`inventory_balances` + `inventory_transactions`:** dữ liệu bị lưu trùng. Số tồn phải luôn bằng tổng các giao dịch, nên cập nhật trong cùng transaction và có script đối soát.
- **Câu 4 (giá vốn) nên chốt trước khi thiết kế schema kho.** Nếu chọn FIFO thì phải có bảng lô, sửa về sau sẽ tốn công.
- **Số liệu trên dashboard** trong cuộc chat (12.500.000đ, 118 SP...) chỉ là dữ liệu giả để minh họa, không phải yêu cầu.
- **Không có thông tin về:** số lượng nhân viên, số lượng sản phẩm hay hóa đơn mỗi ngày, ngân sách hosting, có cần hóa đơn điện tử theo quy định thuế hay không. Không đủ thông tin để xác minh, cần hỏi chủ dự án nếu liên quan.
