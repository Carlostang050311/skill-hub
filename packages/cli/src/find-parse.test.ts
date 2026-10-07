import { describe, expect, it } from "vitest";
import { parseSkillsFindOutput } from "./find-parse.js";

const SAMPLE = [
  "\u001b[38;5;102mInstall with\u001b[0m npx skills add <owner/repo@skill>",
  "",
  "\u001b[38;5;145mcarlostang050311/skill-hub@skill-finder\u001b[0m \u001b[36m1 install\u001b[0m",
  "└ https://skills.sh/carlostang050311/skill-hub/skill-finder",
  "",
  "\u001b[38;5;145mvercel-labs/skills@find-skills\u001b[0m \u001b[36m42 installs\u001b[0m",
  "└ https://skills.sh/vercel-labs/skills/find-skills",
].join("\n");

describe("parseSkillsFindOutput", () => {
  it("解析带 ANSI 颜色码的真实输出", () => {
    const hits = parseSkillsFindOutput(SAMPLE);
    expect(hits).toEqual([
      {
        repo: "carlostang050311/skill-hub",
        skill: "skill-finder",
        installs: 1,
        url: "https://skills.sh/carlostang050311/skill-hub/skill-finder",
      },
      { repo: "vercel-labs/skills", skill: "find-skills", installs: 42, url: "https://skills.sh/vercel-labs/skills/find-skills" },
    ]);
  });

  it("无结果输出返回空数组", () => {
    expect(parseSkillsFindOutput('No skills found for "x" from owner "y"')).toEqual([]);
    expect(parseSkillsFindOutput("")).toEqual([]);
  });

  it("缺 URL 行时 url 为空串", () => {
    const hits = parseSkillsFindOutput("a/b@c 3 installs");
    expect(hits).toEqual([{ repo: "a/b", skill: "c", installs: 3, url: "" }]);
  });
});
