export type SourceKind = "agents-global" | "claude-global" | "plugin-cache" | "custom";

/** 一个扫描根目录的配置 */
export interface ScanRoot {
  /** 展示名，如 agents / claude / zcode-plugins */
  source: string;
  path: string;
  sourceKind: SourceKind;
  /** 目录递归深度上限（根目录下的层数），默认 5 */
  maxDepth?: number;
}

export interface QualitySignals {
  hasName: boolean;
  nameMatchesDir: boolean;
  nameFormatOk: boolean;
  descriptionChars: number;
  /** description 超过部分客户端约 250 字符的截断阈值 */
  descriptionTruncatedRisk: boolean;
  bodyChars: number;
  bodyTooThin: boolean;
  /** 正文引用了但磁盘上不存在的本地资源 */
  missingResourceRefs: string[];
  resourceFileCount: number;
  warnings: string[];
}

export interface SkillRecord {
  /** 唯一 id：source::相对路径 */
  id: string;
  /** frontmatter.name，缺失时回退目录名 */
  name: string;
  description: string;
  /** frontmatter 中除 name/description 外的字段 */
  extraFrontmatter: Record<string, unknown>;
  source: string;
  sourceKind: SourceKind;
  skillPath: string;
  skillDir: string;
  dirName: string;
  /** 相对扫描根的目录路径（正斜杠） */
  relativeId: string;
  /** plugin-cache 里识别出的版本号 */
  version?: string;
  /** skill 目录下附属资源文件（相对路径，正斜杠，不含 SKILL.md） */
  files: string[];
  bodyChars: number;
  /** 归一化内容（LF、去行尾空白）的 sha256 前 16 位 */
  hash: string;
  quality: QualitySignals;
  /** 正文引用的其他 skill 名（`xxx/SKILL.md` 链接与 `[[xxx]]`，未过滤） */
  references: string[];
  /** 正文提及的库内其他 skill 名（词边界匹配，长度 ≥4，不含自身） */
  mentions: string[];
  scannedAt: string;
}

export interface RootReport {
  path: string;
  source: string;
  sourceKind: SourceKind;
  exists: boolean;
  count: number;
  /** 解析失败的 skill 数 */
  failed: number;
  /** 解析失败的 SKILL.md 绝对路径 */
  failedFiles: string[];
}

export interface ScanResult {
  skills: SkillRecord[];
  roots: RootReport[];
  scannedAt: string;
}

export interface SkillGroup {
  name: string;
  occurrences: SkillRecord[];
  /** 多处出现且内容一致时为 true */
  identical: boolean;
  hashes: string[];
}
