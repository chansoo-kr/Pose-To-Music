// 아주 작은 테스트 도구 (scripts/test.mjs가 *.test.ts를 불러온 뒤 run()을 부른다)

const tests: { name: string; fn: () => void | Promise<void> }[] = [];

export function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

export function assert(cond: unknown, message = "assert 실패"): asserts cond {
  if (!cond) throw new Error(message);
}

export function near(actual: number, expected: number, eps = 1e-6, message = "") {
  assert(Math.abs(actual - expected) <= eps, `${message} 기대 ${expected}, 실제 ${actual}`.trim());
}

/** @returns 실패한 테스트 수 */
export async function run(): Promise<number> {
  let failed = 0;
  for (const t of tests.splice(0)) {
    try {
      await t.fn();
      console.log(`  ok   ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL ${t.name}\n       ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return failed;
}
