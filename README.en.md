# skill-hub

[中文](README.md) | [English](README.en.md)

Local-first management & evaluation platform for AI agent skills: turn skills scattered across multiple agent directories into a metadata database with an executable evaluation loop.

![Overview](docs/screenshots/01-overview.png)

## Why

A skill is essentially frontmatter (name/description) + instruction body + resource files. There are only three fundamental problems around it: **discovery** (what do I have, which one fits), **quality** (no feedback signal), and **distribution** (how to install it into N agent directories and keep them in sync). Existing tools only solve distribution (skills.sh etc.); skill-hub adds local inventory management, cross-directory drift detection, and quality evaluation — evaluation is the moat: static lint catches format issues, model-based evaluation catches semantic ones.

## Features

- **Indexing**: scans `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills` and Claude/ZCode plugin caches; parses frontmatter, content fingerprints for dedup, static quality signals (description truncation risk, missing resource refs, name conventions), explicit references + in-body mentions as two dependency signals
- **Web UI** (Next.js 15): overview, searchable skill library, detail pages (rendered body + reference/mention network + one-click install), dependency graph (links solid / mentions dashed), sync status (drift detection + one-click align), evaluation reports
- **Evaluation framework**: scenario YAML (positive/negative trigger cases) → `plan` generates jobs → model runs them (ZCode subagents or OpenAI-compatible API) → `ingest` scores three layers into SQLite (trigger 40% + clarity 30% + static 30%)
- **Distribution**: `install/uninstall/outdated/pack`; multi-copy names prefer agents > claude > codex; conflicts require `--force`
- **GitHub ecosystem**: `github-install <owner/repo>` (discover SKILL.md → dedup → install → record origin), `origins` registry, `outdated-remote` compares directory fingerprints against upstream (`--apply` to update)
- **Agent-facing lookup**: `recommend "<task>"` ranks skills for a task description (CJK + Latin keyword matching, quality signals in scoring), plus the `skill-finder` meta-skill so coding agents check the library before reinventing wheels

![Dependency graph](docs/screenshots/04-graph.png)

## Quick start

```bash
npm install
npm run build
npm test                       # full Vitest suite

npm run skillhub -- scan       # scan all local skill directories
npm run skillhub -- list       # list all skills
npm run skillhub -- recommend "turn this article into Xiaohongshu cards"

npm run start -w @skillhub/web # Web UI → http://localhost:3457
```

See the [Chinese README](README.md) for the full command reference (evaluation, GitHub install, distribution).

## Install from skills.sh

`skill-finder` is listed on the skills.sh directory; install it with the skills CLI:

```bash
npx skills add Carlostang050311/skill-hub
```

Repo page: [skills.sh/Carlostang050311/skill-hub](https://www.skills.sh/Carlostang050311/skill-hub)

## MCP server

```bash
npm run skillhub -- recommend "turn this article into Xiaohongshu cards"   # CLI lookup
```

Expose the library to coding agents over the standard MCP protocol:

```json
{
  "mcpServers": {
    "skill-hub": {
      "command": "node",
      "args": ["/path/to/skill-hub/packages/mcp/dist/server.js"]
    }
  }
}
```

Three tools: `recommend_skills` (task → ranked recommendations), `get_skill` (details + body), `library_stats` (inventory stats). The `skills/skill-finder` meta-skill defines the agent's decision rules.

## Real-world numbers

On a local library of 300+ real skills:

- 317 skills indexed; 83 duplicate-name groups, 8 content-drift groups, 3 broken frontmatters found (unquoted description containing `": "`)
- 4 evaluation rounds (24 skills, 171 jobs): 100% trigger accuracy measured; surfaced missing descriptions, self-contradicting bodies, mismatched dependencies
- Upstream check caught a real upstream update in a third-party skill repo

## Architecture

npm workspaces monorepo, TypeScript throughout:

```
packages/core   indexing / parsing / fingerprints / quality / graph / distribution / github / recommend
packages/cli    skillhub CLI
apps/web        Next.js 15 + Tailwind v4 dashboard
apps/eval       evaluation runner + node:sqlite report store
```

## License

[MIT](LICENSE)
