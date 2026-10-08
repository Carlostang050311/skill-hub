import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const runDir = fs.mkdtempSync(path.join(repo, ".skillhub", "acceptance-"));
const home = path.join(runDir, "home");
function skill(source, name, description, body, files = {}) {
  const dir = path.join(home, `.${source}`, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`, "utf8");
  for (const [relative, text] of Object.entries(files)) { const file = path.resolve(dir, relative); if (!file.startsWith(dir + path.sep)) throw new Error("夹具路径越界"); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, "utf8"); }
}
skill("agents", "report-maker", "根据提供的数据生成有来源的数据报告", "简短的说明", { "scripts/run.mjs": "console.log('new');\n", "new.txt": "new resource" });
skill("claude", "report-maker", "根据提供的数据生成有来源的数据报告", "简短的说明", { "scripts/run.mjs": "console.log('old');\n", "old.txt": "old resource" });
skill("agents", "report-checker", "根据提供的数据生成有来源的数据报告", "核对报告来源与数据");
for (const [name, description] of Object.entries({ "academic-pptx": "Build academic slides and presentations", "humanizer-zh": "润色中文文章，保留事实和引用", pdf: "Read and create PDF documents", "decision-mapping": "梳理决策与约束", "domain-modeling": "梳理领域模型", prototype: "Build interactive prototypes", tdd: "Test-driven development", "frontend-design": "Implement frontend interfaces", playwright: "Browser automation and screenshots" })) skill("agents", name, description, "按提供的材料执行，验证输入和输出，不添加没有依据的信息。".repeat(8));
const localScenarios = path.join(home, ".skillhub", "scenarios");
fs.mkdirSync(localScenarios, { recursive: true });
fs.writeFileSync(path.join(localScenarios, "report-maker.yaml"), "skill: report-maker\nshould_trigger:\n  - 制作数据报告\nshould_not_trigger:\n  - 今天的天气\n", "utf8");
const failed = new Set();
const provider = http.createServer((request, response) => {
  let raw = ""; request.on("data", (chunk) => { raw += String(chunk); });
  request.on("end", () => {
    const data = JSON.parse(raw);
    if (data.model === "protocol-error" && !failed.has(data.model)) { failed.add(data.model); response.statusCode = 429; response.end("protocol fixture failure"); return; }
    const prompt = data.messages[0]?.content ?? "";
    const clarity = prompt.includes("consistency");
    const value = prompt.includes("核查数据来源") ? 5 : 3;
    const result = clarity ? { consistency: value, actionability: value, boundedness: value, issues: value === 3 ? ["协议夹具：指导书缺少核查数据来源步骤"] : [] } : { trigger: !prompt.includes("今天的天气") };
    const send = () => { if (response.destroyed) return; response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }], usage: { total_tokens: 20 } })); };
    if (data.model === "protocol-slow") setTimeout(send, 5000); else send();
  });
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const port = Number(process.argv[2] ?? 3458);
const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
const info = { runDir, home, port, baseUrl, note: "本地协议夹具，不是真实模型质量成绩" };
fs.writeFileSync(path.join(repo, ".skillhub", "acceptance-latest.json"), JSON.stringify(info, null, 2), "utf8");
console.log(JSON.stringify(info));
const app = spawn(process.execPath, [path.join(repo, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "--hostname", "127.0.0.1"], { cwd: path.join(repo, "apps", "web"), env: { ...process.env, SKILLHUB_HOME: home, SKILLHUB_API_KEY: "local-protocol-fixture", SKILLHUB_BASE_URL: baseUrl, SKILLHUB_MODEL: "protocol-fixture" }, stdio: "inherit" });
app.on("exit", (code) => { provider.closeAllConnections(); provider.close(); process.exitCode = code ?? 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { app.kill(); provider.closeAllConnections(); provider.close(); });
