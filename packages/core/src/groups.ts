import type { SkillGroup, SkillRecord } from "./types.js";

/** 按 name 分组，用于跨目录去重与漂移检测 */
export function groupByName(skills: SkillRecord[]): SkillGroup[] {
  const map = new Map<string, SkillRecord[]>();
  for (const skill of skills) {
    const list = map.get(skill.name);
    if (list) list.push(skill);
    else map.set(skill.name, [skill]);
  }
  const groups: SkillGroup[] = [];
  for (const [name, occurrences] of map) {
    const hashes = [...new Set(occurrences.map((o) => o.hash))];
    groups.push({ name, occurrences, identical: hashes.length === 1, hashes });
  }
  return groups;
}

/** 同名出现在多个目录的组 */
export function findConflicts(skills: SkillRecord[]): SkillGroup[] {
  return groupByName(skills).filter((group) => group.occurrences.length > 1);
}
