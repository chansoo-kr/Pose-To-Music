// TS 단위 테스트 실행: src/**/*.test.ts를 Vite로 불러와 돌린다 (따로 의존성 없음)
//   pnpm test
import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const opts = { root, configFile: false, logLevel: "error" };

async function find(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await find(p)));
    else if (e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

let failed = 0;
for (const file of await find(join(root, "src"))) {
  console.log(relative(root, file));
  // 테스트 파일과 run()이 같은 testing 모듈 인스턴스를 쓰도록 한 번에 불러온다
  const { module } = await runnerImport("/" + relative(root, file), opts);
  failed += await module.__run();
}
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
process.exit(failed ? 1 : 0);
