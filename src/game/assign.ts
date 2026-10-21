/**
 * 프리스타일 채보 교환: 자기 채보는 받지 않도록 나눠 준다.
 * @param players 플레이할 사람 id
 * @param owners 쓸 수 있는 채보를 낸 사람 id (players의 부분집합)
 * @returns 받는 사람 id → 채보를 만든 사람 id
 */
export function assignCharts(players: string[], owners: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!owners.length) return map;
  if (owners.length === 1) {
    // 채보가 하나뿐이면 모두(만든 사람 포함) 그 채보를 한다
    for (const id of players) map.set(id, owners[0]);
    return map;
  }
  // Sattolo 알고리즘: 하나의 큰 순환 순열을 만들어 고정점이 없다
  const perm = [...owners];
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * i);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  owners.forEach((id, i) => map.set(id, perm[i]));
  // 채보를 못 낸 사람은 아무 채보나
  for (const id of players) {
    if (!map.has(id)) map.set(id, owners[Math.floor(Math.random() * owners.length)]);
  }
  return map;
}
