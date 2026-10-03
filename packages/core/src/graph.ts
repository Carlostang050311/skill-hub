/** 提取正文中对其他 skill 的引用：`xxx/SKILL.md` 链接与 `[[xxx]]` wiki 链接 */
export function extractReferences(body: string, knownNames?: ReadonlySet<string>): string[] {
  const refs = new Set<string>();
  for (const m of body.matchAll(/([A-Za-z0-9._-]+)\/SKILL\.md/g)) {
    if (m[1]) refs.add(m[1]);
  }
  for (const m of body.matchAll(/\[\[([A-Za-z0-9._-]+)\]\]/g)) {
    if (m[1]) refs.add(m[1]);
  }
  const all = [...refs];
  if (!knownNames) return all;
  return all.filter((name) => knownNames.has(name));
}
