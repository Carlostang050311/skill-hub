export interface RemoteSkillHit {
  /** owner/repo */
  repo: string;
  /** skill 名 */
  skill: string;
  installs: number;
  url: string;
}

/**
 * 解析 `npx skills find` 的输出。
 * 条目形如：
 *   owner/repo@skill  12 installs
 *   └ https://skills.sh/owner/repo/skill
 */
export function parseSkillsFindOutput(text: string): RemoteSkillHit[] {
  const hits: RemoteSkillHit[] = [];
  const entryRe = /^(\S+)\/([^\s@]+)@([^\s]+)\s+(\d+)\s+installs?\s*$/i;
  const urlRe = /^└?\s*(https:\/\/\S+)$/;
  let current: RemoteSkillHit | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // 剥掉 ANSI 颜色码后再匹配
    const clean = line.replace(/\u001b\[[0-9;]*m/g, "");
    const entry = clean.match(entryRe);
    if (entry) {
      if (current) hits.push(current);
      current = {
        repo: `${entry[1]}/${entry[2]}`,
        skill: entry[3] ?? "",
        installs: Number(entry[4]),
        url: "",
      };
      continue;
    }
    const url = clean.match(urlRe);
    if (url && current) {
      current.url = url[1] ?? "";
    }
  }
  if (current) hits.push(current);
  return hits;
}
