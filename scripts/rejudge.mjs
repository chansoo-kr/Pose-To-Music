// 판정 기록(.judge.json, 설정 "디버그 정보"를 켜고 플레이한 뒤 결과 화면에서 내보냄)을
// v3 판정과 지금 판정(판정 여유 3가지)으로 다시 채점해 등급 분포를 비교한다.
//   pnpm rejudge 기록1.judge.json [기록2.judge.json ...]
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const files = process.argv.slice(2);
if (!files.length) {
  console.log("사용법: pnpm rejudge <기록.judge.json> [...]");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (id) => (await runnerImport(id, { root, configFile: false, logLevel: "error" })).module;
const scoring = await load("/src/game/scoring.ts");
const { DIFFICULTY_JOINTS } = await load("/src/pose/joints.ts");

const toPose = (arr) => arr.map(([x, y, v = 1]) => ({ x, y, v }));

const methods = {
  v3: (target, pose, joints, dt, window) =>
    scoring.legacy.timedValue(scoring.legacy.poseAccuracy(target, pose, joints), dt, window),
  ...Object.fromEntries(
    scoring.LENIENCIES.map((l) => [
      `v4 ${scoring.LENIENCY_LABEL[l]}`,
      (target, pose, joints, dt, window) => scoring.timedValue(scoring.poseAccuracy(target, pose, joints, l), dt, window),
    ]),
  ),
};
const gradeFns = { v3: scoring.legacy.gradeOf };

const totals = Object.fromEntries(Object.keys(methods).map((m) => [m, { counts: {}, sum: 0, n: 0 }]));

for (const file of files) {
  const log = JSON.parse(await readFile(file, "utf8"));
  if (log.format !== "ptm-judge-log") {
    console.log(`${file}: 판정 기록 파일이 아니에요`);
    continue;
  }
  const joints = DIFFICULTY_JOINTS[log.difficulty];
  console.log(`${file}\n  ${log.song} · ${log.chartAuthor}의 채보 · ${log.difficulty} · 판정 ${log.leniency} · 박자 ${log.judgments.length}개`);
  for (const [name, fn] of Object.entries(methods)) {
    const counts = {};
    let sum = 0;
    for (const j of log.judgments) {
      const target = toPose(j.target);
      let best = 0;
      for (const s of j.samples) best = Math.max(best, fn(target, toPose(s.pose), joints, s.t - j.t, j.window));
      const grade = (gradeFns[name] ?? scoring.gradeOf)(best);
      counts[grade] = (counts[grade] ?? 0) + 1;
      sum += best;
      const tot = totals[name];
      tot.counts[grade] = (tot.counts[grade] ?? 0) + 1;
      tot.sum += best;
      tot.n++;
    }
    console.log(`  ${row(name, counts, sum, log.judgments.length)}`);
  }
}

function row(name, counts, sum, n) {
  const pct = (g) => `${g} ${String(Math.round(((counts[g] ?? 0) / Math.max(1, n)) * 100)).padStart(3)}%`;
  return `${name.padEnd(6)}\t${scoring.GRADES.map(pct).join("  ")}   평균 ${(sum / Math.max(1, n)).toFixed(2)}`;
}

if (files.length > 1) {
  console.log("\n전체");
  for (const [name, t] of Object.entries(totals)) console.log(`  ${row(name, t.counts, t.sum, t.n)}`);
}
