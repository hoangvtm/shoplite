<!--
Sync Impact Report (tạm thời - xóa trước khi commit)
- Version change: (mẫu chưa điền) → 1.0.0
- Modified principles: không có (lần ban hành đầu tiên, thay thế toàn bộ placeholder của template)
- Added sections: Core Principles (I–V), Ràng buộc kỹ thuật, Quy trình phát triển, Governance
- Removed sections: không có
- Follow-up TODOs: không có. Nguồn tham chiếu: .claude/AGENTS.md, README.md, .claude/rules/*.
- Ghi chú: AGENTS.md nằm ở .claude/AGENTS.md (không phải thư mục gốc repo).
-->
# ShopLite Constitution

## Core Principles

### I. Kiến trúc theo tính năng

Code mới MUST đặt trong `src/features/<feature>/` gồm logic thuần, `components/` và test nằm
cạnh file nguồn. `src/app/` MUST chỉ chứa route mỏng (trang và Route Handler): đọc request, gọi
sang `src/features/*`, trả response; route MUST NOT chứa nghiệp vụ. Logic nghiệp vụ MUST viết
thành hàm thuần, không đặt trong component. Một feature SHOULD NOT import trực tiếp phần nội bộ
của feature khác ngoài các export công khai (types, hàm thuần, hook). Mã dùng chung thật sự
MUST đặt ở `src/components/`, `src/lib/` hoặc `src/data/`.

Lý do: hàm thuần tách khỏi UI dễ test, dễ đọc, và giữ ranh giới rõ giữa các tính năng.

### II. Test trước cho nghiệp vụ (NON-NEGOTIABLE)

Mọi quy tắc tính tiền, giới hạn số lượng và chuyển trạng thái MUST có unit test được viết
**trước** khi viết code triển khai: test được viết, chạy và thấy fail, sau đó mới implement
(Red-Green-Refactor). Mỗi quy tắc MUST có test giá trị biên (ngay dưới / đúng bằng / ngay trên
ngưỡng), ví dụ ngưỡng miễn phí ship 500.000 ₫, giới hạn 10 sản phẩm mỗi loại, tồn kho, và hủy
đơn chỉ khi `pending`. `npm run check` (lint + typecheck + test) MUST pass trước khi báo hoàn
thành hoặc merge. MUST NOT tắt rule ESLint hay bỏ qua test để "cho qua". Tên test MUST viết
bằng tiếng Việt, mô tả hành vi.

Lý do: sai sót về tiền và trạng thái đơn hàng gây thiệt hại trực tiếp; test biên là cách rẻ
nhất để chặn lỗi lệch một đơn vị.

### III. Server là nguồn sự thật về tiền

Giá sản phẩm, phí giao hàng, giảm giá và tổng tiền MUST do server tính lại từ dữ liệu catalog
bằng các hàm dùng chung trong `src/features/checkout/pricing.ts`; server MUST NOT tin bất kỳ số
tiền nào do client gửi lên. Mọi input vào API (body, query, params) MUST được validate bằng Zod,
schema dùng chung client/server đặt ở feature tương ứng. Lỗi MUST trả về đúng định dạng
`{ "error": { "code", "message", "details?" } }` qua `handleRouteError`. Số tiền phía client
chỉ để hiển thị và MUST NOT quyết định số tiền thực thu.

Lý do: client có thể bị sửa đổi; chỉ server mới đáng tin để chốt số tiền của đơn hàng.

### IV. Đơn giản trước

MUST dùng stack hiện có (Next.js 16, React 19, TypeScript strict, Tailwind CSS v4, Zod 4,
Vitest, Playwright). MUST NOT thêm dependency mới hoặc database nếu `plan.md` không nêu rõ lý do,
phương án đã cân nhắc và vì sao stack hiện có không đáp ứng được. Server Component MUST là mặc
định; chỉ thêm `"use client"` khi cần state, effect hoặc event. MUST NOT dùng `any`. Mọi độ phức
tạp tăng thêm (abstraction, lớp trung gian) MUST được biện minh trong plan.

Lý do: dự án nhỏ, dùng làm mẫu học tập; ít thành phần giúp dễ hiểu và dễ bảo trì.

### V. Trải nghiệm tiếng Việt và dễ tiếp cận

Mọi text hiển thị cho người dùng MUST bằng tiếng Việt. Số tiền MUST hiển thị qua
`formatCurrency` (`src/lib/format.ts`), ngày giờ qua `formatDateTime`; MUST NOT tự ghép chuỗi
tiền tệ. Mọi ô nhập trong form MUST có `label` gắn đúng với control, và lỗi validate MUST hiển
thị theo từng trường (gắn với trường đó, thông báo bằng tiếng Việt). Giao diện SHOULD dùng được
trên desktop và mobile 390px, và thao tác SHOULD dùng được bằng bàn phím. Tìm kiếm SHOULD không
phân biệt dấu tiếng Việt (`normalizeText`).

Lý do: người dùng mục tiêu nói tiếng Việt; form rõ ràng và dễ tiếp cận giảm lỗi nhập liệu.

## Ràng buộc kỹ thuật

- Stack: Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS v4, Zod 4; Node.js
  ≥ 22.12. API Next.js 16 khác bản cũ (params là Promise...), MUST đọc tài liệu đúng phiên bản
  tại `node_modules/next/dist/docs/` trước khi dùng API chưa chắc chắn.
- Lưu trữ: sản phẩm là dữ liệu tĩnh trong `src/data/`; đơn hàng lưu file JSON
  (`storage/orders.json`, đường dẫn đặt qua `ORDERS_FILE`). Giỏ hàng lưu `localStorage`
  (`shoplite:cart`); MUST NOT đổi định dạng dữ liệu `localStorage` mà không xử lý dữ liệu cũ.
- Tiền tệ là VND (số nguyên, không số lẻ).
- Quy ước: tên file kebab-case, component PascalCase, import qua alias `@/`, ghép class bằng
  `cn()`, Link dạng nút dùng `buttonStyles()`. Lỗi nghiệp vụ dùng `OrderError(code, message)`.
- Bảo mật & kho mã: MUST NOT commit `storage/` hay file `.env*`; MUST NOT sửa
  `package-lock.json` bằng tay.
- Test: Vitest + Testing Library, file `*.test.ts(x)` cạnh file nguồn; test đơn hàng MUST dùng
  `createInMemoryOrderRepository()`; MUST NOT gọi mạng thật trong test. E2E dùng Playwright.
- Tài liệu: thêm/sửa route, API hoặc lệnh MUST cập nhật README (bảng API, bảng lệnh).

## Quy trình phát triển

- Mỗi tính năng MUST làm trên nhánh riêng (ví dụ `lab2-speckit`, hoặc nhánh feature do Spec Kit
  tạo); MUST NOT commit trực tiếp lên `main`.
- Trình tự: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`. MUST NOT bắt đầu viết code khi `spec.md` còn câu hỏi mở (mục
  `NEEDS CLARIFICATION` chưa được giải quyết).
- Theo Nguyên tắc II, task test cho nghiệp vụ MUST đứng trước task implement tương ứng trong
  `tasks.md`.
- Thay đổi chạm hơn 3 file SHOULD được lập kế hoạch (plan mode) trước khi sửa.
- Definition of Done: (1) `npm run check` pass và có test cho hành vi mới; (2) giao diện đã
  kiểm tra trên desktop và mobile 390px; (3) README được cập nhật nếu thêm route, API hoặc lệnh.
- Mỗi plan MUST có bước kiểm tra tuân thủ constitution (Constitution Check); vi phạm MUST được
  ghi lại và biện minh.

## Governance

Constitution này có hiệu lực cao hơn mọi quy ước khác trong repo; khi mâu thuẫn với
`.claude/AGENTS.md`, `README.md` hay tài liệu khác, constitution thắng và tài liệu kia MUST được
cập nhật cho khớp. `.claude/AGENTS.md` là hướng dẫn vận hành hằng ngày cho agent và SHOULD
được dùng kèm.

**Quy trình sửa đổi**: mọi thay đổi MUST thực hiện qua pull request, nêu rõ lý do, tác động lên
các nguyên tắc, và cập nhật các template/tài liệu phụ thuộc nếu có. Mọi sửa đổi constitution
MUST tăng version theo semver:

- MAJOR: xóa hoặc định nghĩa lại nguyên tắc/governance theo cách không tương thích ngược.
- MINOR: thêm nguyên tắc hoặc mục mới, hoặc mở rộng đáng kể hướng dẫn.
- PATCH: làm rõ câu chữ, sửa lỗi chính tả, tinh chỉnh không đổi ý nghĩa.

**Rà soát tuân thủ**: mọi plan và pull request MUST được đối chiếu với constitution; vi phạm
Nguyên tắc II (NON-NEGOTIABLE) MUST chặn merge. Ngoại lệ với các nguyên tắc còn lại MUST được
biện minh bằng văn bản trong plan.

**Version**: 1.0.0 | **Ratified**: 2026-11-08 | **Last Amended**: 2026-11-08
