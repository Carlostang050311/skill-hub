import type { SkillRecord } from "./types.js";

export interface UsageCard {
  aliases: string[];
  scenarios: string[];
  clients: string[];
  requirements: string[];
  inputs: string[];
  outputs: string[];
  examples: string[];
  failures: string[];
}
export interface SkillPack { id: string; title: string; task: string; skills: string[]; steps: string[]; example: string; acceptance: string[] }
export const SKILL_PACKS: SkillPack[] = [
  { id: "research", title: "论文写作与学术汇报", task: "把已有研究材料整理为可核查的论文表达与汇报", skills: ["pdf", "humanizer-zh", "academic-pptx"], steps: ["pdf 读取材料并核查页码与来源", "humanizer-zh 润色已有中文文本，保留原意", "academic-pptx 制作学术汇报并检查引用和排版"], example: "根据提供的研究报告制作 12 页学术汇报；每个核心结论保留来源页码，不添加未提供的数据。", acceptance: ["结论可追溯到原材料", "引用与数据无新增编造", "幻灯片真实渲染无溢出"] },
  { id: "product-design", title: "产品设计与可交互原型", task: "从产品问题推进到可验证的设计方案", skills: ["decision-mapping", "domain-modeling", "prototype"], steps: ["decision-mapping 梳理目标、决策和约束", "domain-modeling 明确领域概念与关系", "prototype 实现选定方向的交互原型"], example: "为本地技能管理工具设计首次扫描流程；明确扫描范围、错误状态和首次成功标准，再制作可交互原型。", acceptance: ["目标与边界明确", "关键流程实际可操作", "空数据和错误状态可验证"] },
  { id: "frontend", title: "前端开发与验收", task: "实现既定界面并验证功能和视觉结果", skills: ["tdd", "frontend-design", "playwright"], steps: ["tdd 为关键行为编写回归测试", "frontend-design 沿用批准的方向实现界面", "playwright 验证桌面与移动端流程"], example: "实现一个支持搜索、筛选和空结果状态的技能列表；通过测试后使用真实浏览器检查桌面和手机布局。", acceptance: ["关键行为回归测试通过", "构建通过", "真实浏览器无交互错误或横向溢出"] },
];

const GUIDES: Record<string, Partial<UsageCard>> = {
  pdf: { aliases: ["PDF", "便携文档"], scenarios: ["读取 PDF", "生成 PDF", "检查 PDF 排版"], inputs: ["PDF 文件或已提供的内容"], outputs: ["提取结果、PDF 文档或排版检查记录"], examples: ["读取这份 PDF，给每个主要结论标注来源页码。"], failures: ["扫描件没有文字层时需要 OCR；缺少字体可能影响渲染"] },
  "academic-pptx": { aliases: ["学术汇报", "学术幻灯片"], scenarios: ["研究汇报", "学术答辩", "学术演示文稿"], inputs: ["论文、研究材料和汇报要求"], outputs: ["学术汇报幻灯片及可检查的渲染结果"], examples: ["把提供的研究材料制作成 12 页答辩幻灯片，保留来源。"], failures: ["没有研究材料时无法验证结论；字体与图片授权需按材料确认"] },
  "humanizer-zh": { aliases: ["润色", "去 AI 味", "中文自然表达"], scenarios: ["润色已有中文文章", "减少模板化表达"], inputs: ["待编辑的中文文本"], outputs: ["保留原意的修改稿"], examples: ["润色这篇中文文章，删除空话，保留事实和引用。"], failures: ["风格变化不代表事实已核验；不要修改引文原文"] },
  "decision-mapping": { aliases: ["决策梳理", "问题拆解"], scenarios: ["明确产品目标", "梳理决策与约束"], inputs: ["问题背景、现有信息和约束"], outputs: ["决策路径、假设与待验证问题"], examples: ["梳理首次扫描流程需要用户做出的最少决策。"], failures: ["关键利益相关者信息缺失时，需把结论标为假设"] },
  "domain-modeling": { aliases: ["领域模型", "业务概念"], scenarios: ["梳理领域概念", "统一业务语言"], inputs: ["业务流程与具体用例"], outputs: ["概念、关系和业务边界"], examples: ["区分 skill、安装副本、来源和评测成绩的关系。"], failures: ["不要把未经确认的概念直接当成数据库设计"] },
  prototype: { aliases: ["交互原型", "原型验证"], scenarios: ["制作可操作的产品原型"], inputs: ["已选定的流程与设计方向"], outputs: ["可交互原型和验证结果"], examples: ["制作首次扫描到查看结果的交互原型。"], failures: ["演示数据需明确标注；原型不等于生产后端已完成"] },
  tdd: { aliases: ["测试驱动", "test-first"], scenarios: ["用回归测试验证行为修复", "测试驱动开发"], inputs: ["明确的行为要求或可复现缺陷"], outputs: ["有意义的测试与通过实现"], examples: ["先复现资源变化未被同步检测的缺陷，再修复它。"], failures: ["只复述实现细节的测试无法证明用户行为正确"] },
  "frontend-design": { aliases: ["界面实现", "UI 开发"], scenarios: ["实现选定的界面方向"], inputs: ["明确需求、现有视觉规范和内容"], outputs: ["实际页面与视觉验证"], examples: ["沿用当前仪表盘样式实现评测进度界面。"], failures: ["没有设计方向时应先收敛；静态截图无法证明交互有效"] },
  playwright: { aliases: ["浏览器验收", "端到端测试"], scenarios: ["真实浏览器交互检查", "页面截图"], inputs: ["可访问的本地应用与验收流程"], outputs: ["交互检查结果、截图或执行记录"], examples: ["检查搜索、筛选与手机布局，并记录浏览器错误。"], failures: ["服务器未启动或浏览器未安装时无法证明渲染通过"] },
};

/** 未声明的环境和客户端保持未知；显式元数据可覆盖随仓库提供的使用提示。 */
export function skillUsageCard(record: SkillRecord): UsageCard {
  const raw = record.extraFrontmatter.skillhub;
  const custom = raw != null && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const guide = GUIDES[record.name] ?? {};
  const list = (key: keyof UsageCard): string[] => Array.isArray(custom[key]) ? (custom[key] as unknown[]).filter((v): v is string => typeof v === "string") : guide[key] ?? [];
  return { aliases: list("aliases"), scenarios: list("scenarios"), clients: list("clients"), requirements: list("requirements"), inputs: list("inputs"), outputs: list("outputs"), examples: list("examples"), failures: list("failures") };
}
