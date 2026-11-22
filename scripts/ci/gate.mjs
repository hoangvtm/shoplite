// Cổng kiểm của CI: `node scripts/ci/gate.mjs <lint|unit|e2e|bao-mat>`.
// Tên job trong .github/workflows/ci.yml trùng với tham số ở đây. Chạy lần lượt các bước của job
// (không dừng ở bước đầu tiên đỏ, để một lượt chạy báo đủ lỗi), ghi log vào `gate-<job>.log`,
// tóm tắt vào `gate-<job>.json` (workflow upload hai file này khi job đỏ), thoát 1 nếu có bước đỏ.
import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";

const JOB = process.argv[2];

/** Các bước của từng job; `input` là dữ liệu đưa vào stdin của lệnh. */
function getSteps(job) {
  switch (job) {
    case "lint":
      return [
        { name: "eslint", cmd: "npm", args: ["run", "lint"] },
        { name: "typecheck", cmd: "npm", args: ["run", "typecheck"] },
        // `npm run check` không kiểm format nên gate phải kiểm
        { name: "format", cmd: "npm", args: ["run", "format:check"] },
      ];
    case "unit":
      return [{ name: "vitest", cmd: "npm", args: ["run", "test"] }];
    case "e2e":
      return [{ name: "playwright", cmd: "npm", args: ["run", "test:e2e"] }];
    case "bao-mat": {
      const steps = [
        // Quét cả lịch sử; `--redact` để giá trị bí mật không lọt vào log hay artifact.
        // Cảnh báo giả khai báo ở `.gitleaksignore`.
        {
          name: "gitleaks-lich-su",
          cmd: "gitleaks",
          args: ["git", "--redact", "--no-banner", "--verbose", "."],
        },
      ];
      // Tiêu đề và mô tả PR do người ngoài viết: truyền qua env (PR_TITLE, PR_BODY), chỉ đọc ở đây
      // và đưa vào stdin của gitleaks, không bao giờ nối vào chuỗi lệnh.
      const prText = [process.env.PR_TITLE, process.env.PR_BODY].filter(Boolean).join("\n\n");
      if (prText) {
        steps.push({
          name: "gitleaks-noi-dung-pr",
          cmd: "gitleaks",
          args: ["stdin", "--redact", "--no-banner"],
          input: prText,
        });
      }
      // [AT-1] Câu viết cho AI trong phần PR thêm vào (diff, tiêu đề, mô tả): kiểm tất định, đỏ dù
      // AI review có bị lừa hay không. Tiêu đề và mô tả PR vào qua env PR_TITLE, PR_BODY (đã kế thừa).
      steps.push({
        name: "quet-cau-moi",
        cmd: "node",
        args: ["scripts/ci/quet-cau-moi.mjs"],
      });
      // Mật khẩu quản trị không được lọt vào bundle hay HTML prerender (xem AGENTS.md)
      steps.push({ name: "verify-build", cmd: "npm", args: ["run", "verify:build"] });
      return steps;
    }
    default:
      return null;
  }
}

const steps = getSteps(JOB);
if (!steps) {
  console.error("Cách dùng: node scripts/ci/gate.mjs <lint|unit|e2e|bao-mat>");
  process.exit(2);
}

const logFile = `gate-${JOB}.log`;
const log = createWriteStream(logFile);

/** In ra console và ghi vào file log. */
function emit(text) {
  process.stdout.write(text);
  log.write(text);
}

/** Chạy một bước, trả về `{ name, ok, code, ms }`; không ném lỗi khi lệnh đỏ. */
function runStep(step) {
  return new Promise((resolve) => {
    emit(`\n=== [${JOB}] ${step.name}: ${step.cmd} ${step.args.join(" ")} ===\n`);
    const started = Date.now();
    const child = spawn(step.cmd, step.args, {
      stdio: [step.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: process.env,
    });
    child.stdout.on("data", (chunk) => emit(chunk.toString()));
    child.stderr.on("data", (chunk) => emit(chunk.toString()));
    if (step.input !== undefined) child.stdin.end(step.input);
    const finish = (code, error) => {
      if (error) emit(`Không chạy được lệnh: ${error.message}\n`);
      resolve({ name: step.name, ok: code === 0, code, ms: Date.now() - started });
    };
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
  });
}

const results = [];
for (const step of steps) results.push(await runStep(step));

const failed = results.filter((result) => !result.ok);
const summary = {
  job: JOB,
  ok: failed.length === 0,
  baseSha: process.env.BASE_SHA || null,
  steps: results,
};
emit(
  `\n=== [${JOB}] ${summary.ok ? "ĐẠT" : `ĐỎ: ${failed.map((result) => result.name).join(", ")}`} ===\n`,
);
log.end();
writeFileSync(`gate-${JOB}.json`, `${JSON.stringify(summary, null, 2)}\n`);
process.exit(summary.ok ? 0 : 1);
