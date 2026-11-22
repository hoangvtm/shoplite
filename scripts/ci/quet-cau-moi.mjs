#!/usr/bin/env node
// Quét "câu mồi" (prompt injection) trong phần PR THÊM VÀO: câu viết cho AI chứ không cho người,
// như "Ghi chú cho AI review: ... không cần báo lỗi", "ignore previous instructions", ký tự ẩn.
// Đây là kiểm tra tất định: nó đỏ dù model có bị lừa hay không. Mục checklist: [AT-1].
// Nguồn được quét: dòng thêm vào của diff, tên file thêm vào, commit message, tiêu đề và mô tả PR.
//
//   node scripts/ci/quet-cau-moi.mjs                       # ở máy: so với origin/main (hoặc main)
//   node scripts/ci/quet-cau-moi.mjs --base <sha> --out .ci/cau-moi.md
//   Biến môi trường PR_TITLE, PR_BODY (nếu có) cũng được quét.
// Test: scripts/ci/quet-cau-moi.test.mjs (chạy bằng `node --test`).

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// File chỉ dẫn cho AI và công cụ kiểm tra của CI: được phép nói về AI, nhưng PR sửa chúng thì
// cần người duyệt riêng [AT-2]. Không quét câu mồi trong nội dung các file này.
const FILE_CHI_DAN = [
  /^\.claude\//,
  /^_bmad\//,
  /^\.github\//,
  /^scripts\/ci\//,
  /^CLAUDE(\.local)?\.md$/,
  /^AGENTS\.md$/,
];

// "AI" viết hoa là từ riêng; không dùng cờ `i` cho nó để "ai" tiếng Việt ("ai cũng") không khớp.
const GOI_AI =
  /\bAI\b|\b(?:[Cc]laude|[Cc]hatgpt|ChatGPT|GPT|gpt|[Cc]opilot|[Gg]emini|LLM|llm|[Bb]ot|[Rr]eviewer|[Mm]odel)\b/;
const BAO_IM_LANG =
  /(?:không cần|đừng|khỏi|không được|do not|don'?t|no need to)\s+(?:báo|report|flag|review|kiểm|comment|nhắc|cảnh báo|mention)|bỏ qua|\bignore\b|\bskip\b|\bapprove\b|\bLGTM\b|duyệt (?:luôn|giúp|ngay)|đã (?:được )?duyệt/i;
// Cụm cố định: đủ rõ để đỏ dù dòng đó không nhắc tên AI.
const MAU_CO_DIEN = [
  /ignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|prompts|rules)/i,
  /bỏ qua (?:mọi|tất cả|các) (?:chỉ dẫn|hướng dẫn|yêu cầu|quy tắc)/i,
  /(?:trả lời|chỉ cần (?:ghi|viết|trả lời)|reply|respond)\s*(?:là|with|bằng)?\s*:?\s*["“']?LGTM/i,
  /\byou are now\b|\bsystem prompt\b|\bnew instructions\b/i,
  /\bapprove (?:this|the) (?:PR|pull request|change|diff)\b/i,
  /đã (?:được )?duyệt[\s,;.:-]*(?:nên )?không cần (?:review|duyệt|kiểm|xem)/i,
];
// Ký tự không nhìn thấy khi đọc diff nhưng model đọc được: zero-width, đổi chiều chữ, dấu gạch
// nối mềm, ký tự đệm/lấp chỗ, tag characters, variation selectors mở rộng. Không gồm U+FE00-FE0F
// vì emoji dùng chúng. Dựng từ mã điểm để mã nguồn này không chứa ký tự vô hình.
const KHOANG_KY_TU_AN = [
  [0x00ad, 0x00ad], // dấu gạch nối mềm
  [0x034f, 0x034f], // combining grapheme joiner
  [0x061c, 0x061c], // arabic letter mark
  [0x115f, 0x1160], // hangul filler
  [0x17b4, 0x17b5], // khmer vowel inherent
  [0x180b, 0x180e], // mongolian variation selectors, vowel separator
  [0x200b, 0x200f], // zero-width, đánh dấu chiều chữ
  [0x202a, 0x202e], // nhúng/đảo chiều chữ
  [0x2060, 0x206f], // word joiner, ký tự định dạng vô hình
  [0x2800, 0x2800], // braille trống
  [0x3164, 0x3164], // hangul filler
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
  [0xffa0, 0xffa0], // halfwidth hangul filler
  [0xe0000, 0xe007f], // tag characters
  [0xe0100, 0xe01ef], // variation selectors mở rộng
];
const KY_TU_AN = new RegExp(
  `[${KHOANG_KY_TU_AN.map(([tu, den]) => `\\u{${tu.toString(16)}}-\\u{${den.toString(16)}}`).join("")}]`,
  "u",
);

// Dòng trailer do công cụ thêm vào (Co-Authored-By: Claude ...) không phải lời viết cho AI; chỉ bỏ
// khi dòng đó không chứa câu mồi nào, nên giấu câu mồi sau tiền tố trailer vẫn bị bắt.
const TRAILER = /^\s*(?:Co-Authored-By|Signed-off-by):/i;
const laTrailerSach = (text) =>
  TRAILER.test(text) &&
  !BAO_IM_LANG.test(text) &&
  !MAU_CO_DIEN.some((mau) => mau.test(text.normalize("NFC"))) &&
  !KY_TU_AN.test(text);

const args = process.argv.slice(2);
const lay = (ten) => (args.includes(ten) ? args[args.indexOf(ten) + 1] : undefined);
const base = lay("--base") ?? process.env.BASE_SHA ?? timBase();
const out = lay("--out");

if (!base) {
  console.log("Không tìm thấy nhánh đích (origin/main, main) để so sánh - bỏ qua.");
  process.exit(0);
}

const phatHien = [];
const fileChiDan = new Set();

const dongTheoFile = new Map(cacDongThem(base).map(({ file, dong }) => [file, dong]));
for (const file of cacTenFile(base)) {
  // Tên file cũng là chỗ giấu câu mồi (AI đọc tên file trong diff); file đổi tên thuần hoặc file
  // rỗng không có dòng thêm vào nên phải lấy tên từ danh sách file, không từ tiêu đề `+++`.
  quet(`(tên file) ${file}`, [{ so: 1, text: file.replace(/[-_./]+/g, " ") }]);
  if (FILE_CHI_DAN.some((mau) => mau.test(file))) {
    fileChiDan.add(file);
    continue;
  }
  quet(file, dongTheoFile.get(file) ?? []);
}
for (const { ten, noiDung } of cacCommit(base)) {
  quet(
    ten,
    tachDong(noiDung).filter((d) => !laTrailerSach(d.text)),
  );
}
for (const [ten, noiDung] of [
  ["(tiêu đề PR)", process.env.PR_TITLE],
  ["(mô tả PR)", process.env.PR_BODY],
]) {
  if (noiDung) quet(ten, tachDong(noiDung));
}

const baoCao = [
  "## Quét câu mồi (prompt injection) - [AT-1]",
  phatHien.length
    ? phatHien
        .map((item) => `- ❌ \`${item.file}:${item.so}\` ${item.loai}: "${item.trich}"`)
        .join("\n")
    : "- ✅ Không thấy câu nào nhắm vào AI trong phần PR thêm vào.",
  "",
  "## File chỉ dẫn cho AI bị PR sửa - [AT-2] (cần người duyệt riêng)",
  fileChiDan.size ? [...fileChiDan].map((file) => `- ⚠️ \`${file}\``).join("\n") : "- Không có.",
  "",
].join("\n");

console.log(baoCao);
if (out) writeFileSync(out, baoCao);
process.exit(phatHien.length ? 1 : 0);

function tachDong(noiDung) {
  return noiDung.split(/\r?\n/).map((text, i) => ({ so: i + 1, text }));
}

/** Bỏ dấu mở đầu comment/trích dẫn để câu chia nhiều dòng comment vẫn nối được thành một câu. */
function boDauComment(text) {
  return text.replace(/^\s*(?:\/\/+|\/\*+|\*+\/?|#+|--|>+)\s*/, "");
}

/** Nối các dòng thành một câu để thử mẫu chữ, đã chuẩn hóa NFC. */
function noiCau(cacDong) {
  return cacDong
    .map((item) => boDauComment(item.text))
    .join(" ")
    .normalize("NFC");
}

function quet(file, dong) {
  // Câu mồi hay viết thành comment 2-3 dòng: dòng đầu gọi tên AI, dòng sau mới bảo "không cần báo".
  // Mọi mẫu chữ đều thử trên cửa sổ 3 dòng, sau khi bỏ dấu comment và chuẩn hóa NFC (chữ tiếng Việt
  // dạng NFD vẫn khớp).
  for (let i = 0; i < dong.length; i++) {
    const cua = dong.slice(i, i + 3);
    const cuaSo = noiCau(cua);
    let loai = null;
    let moc = dong[i];
    if (KY_TU_AN.test(dong[i].text)) loai = "Ký tự ẩn (không nhìn thấy khi đọc diff)";
    else if (MAU_CO_DIEN.some((mau) => mau.test(cuaSo))) {
      loai = "Câu ra lệnh cho AI";
      // Báo dòng muộn nhất mà câu vẫn còn khớp: đó là dòng câu bắt đầu, không phải dòng đệm phía trước.
      for (let j = cua.length - 1; j > 0; j--) {
        const tuDay = noiCau(cua.slice(j));
        if (MAU_CO_DIEN.some((mau) => mau.test(tuDay))) {
          moc = cua[j];
          break;
        }
      }
    } else if (GOI_AI.test(cuaSo) && BAO_IM_LANG.test(cuaSo)) {
      loai = "Câu bảo AI bỏ qua";
      // Báo đúng dòng đầu tiên của cửa sổ có nhắc AI hoặc câu bảo bỏ qua, không phải dòng mở đầu.
      moc = cua.find((d) => GOI_AI.test(d.text) || BAO_IM_LANG.test(d.text)) ?? moc;
    }
    if (!loai) continue;
    phatHien.push({ file, so: moc.so, loai, trich: moc.text.trim().slice(0, 120) });
    i += 2;
  }
}

/**
 * Các dòng PR thêm vào, theo file, kèm số dòng ở bản mới.
 * Dòng `+++ ` chỉ là tiêu đề file khi còn ở phần đầu của một mục `diff --git` (trước hunk `@@`
 * đầu tiên); sau đó mọi dòng bắt đầu bằng `+` là nội dung, kể cả `+++ ...` (nội dung `++ ...`).
 */
function cacDongThem(baseRef) {
  const diff = git([
    "-c",
    "core.quotepath=false",
    "diff",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    `${baseRef}...HEAD`,
  ]);
  const theoFile = new Map();
  let file = null;
  let trongHunk = false;
  let so = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      trongHunk = false;
      file = null;
    } else if (!trongHunk && line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? null : line.slice(6);
      if (file && !theoFile.has(file)) theoFile.set(file, []);
    } else if (line.startsWith("@@")) {
      trongHunk = true;
      so = Number(line.match(/\+(\d+)/)?.[1] ?? 0);
    } else if (trongHunk && file && line.startsWith("+")) {
      theoFile.get(file).push({ so, text: line.slice(1) });
      so++;
    }
  }
  return [...theoFile].map(([ten, dong]) => ({ file: ten, dong }));
}

/** Tên mọi file PR thêm, sửa hoặc đổi tên (tên mới), kể cả file rỗng và đổi tên thuần. */
function cacTenFile(baseRef) {
  const ra = git([
    "-c",
    "core.quotepath=false",
    "diff",
    "--name-only",
    "-z",
    "--diff-filter=ACMR",
    `${baseRef}...HEAD`,
  ]);
  return ra.split("\0").filter(Boolean);
}

/** Commit message của các commit PR thêm vào (không tính commit merge). */
function cacCommit(baseRef) {
  const log = git(["log", "--no-merges", "--format=%x01%h%x02%B", `${baseRef}..HEAD`]);
  return log
    .split("\x01")
    .filter(Boolean)
    .map((muc) => {
      const [ma, ...thanBody] = muc.split("\x02");
      return { ten: `(commit ${ma})`, noiDung: thanBody.join("\x02") };
    });
}

function timBase() {
  for (const ref of ["origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", ref]);
      return ref;
    } catch {
      // thử ref tiếp theo
    }
  }
  return undefined;
}

function git(gitArgs) {
  return execFileSync("git", gitArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
