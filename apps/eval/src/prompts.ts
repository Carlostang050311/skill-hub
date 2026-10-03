export interface TriggerPromptInput {
  name: string;
  description: string;
  utterance: string;
}

export function renderTriggerPrompt(input: TriggerPromptInput): string {
  return [
    "你正在模拟编码代理的技能路由器。代理只凭技能的名称与描述决定是否加载某个技能。",
    "",
    `技能名称：${input.name}`,
    `技能描述：${input.description}`,
    "",
    `用户输入：${input.utterance}`,
    "",
    "仅凭名称与描述判断：这个技能应当被触发吗？",
    '只输出 JSON，不要输出任何其他内容：{"trigger": true 或 false, "reason": "一句话理由"}',
  ].join("\n");
}

export function renderClarityPrompt(input: { name: string; body: string }): string {
  return [
    "你是 Agent 技能（SKILL.md）的质量评审员。阅读下面这个技能的正文，按三个维度打分（1-5 整数）：",
    "- consistency：自洽，无自相矛盾或明显过时的表述",
    "- actionability：步骤具体可执行，代理读完知道下一步做什么",
    "- boundedness：适用与不适用的边界清晰，不容易被滥用或误触发",
    "同时列出正文中发现的具体问题（没有就给空数组）。",
    "",
    `技能名称：${input.name}`,
    "正文：",
    "<<<BODY",
    input.body,
    "BODY",
    "",
    '只输出 JSON：{"consistency": n, "actionability": n, "boundedness": n, "issues": ["..."], "comments": "一句话总评"}',
  ].join("\n");
}
