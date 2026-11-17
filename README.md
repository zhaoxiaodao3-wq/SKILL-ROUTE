# harness-skills

Skill 路由的唯一来源：**技能正文 + 路由图 + 面板 + 网关**。

面板打开就能改路由，保存即提交到本仓；各项目通过 `/api/bundle` 拉取，不再各自维护副本。

## 目录

```
skills/            技能正文（每个目录一个 SKILL.md）
routing/graph.json 路由图（面板唯一编辑对象）
routing/schema.json 字段校验
tools/panel/       可视化面板（Vite + simple-mind-map）
tools/server/      网关（校验 + git 提交 + bundle + AI 代理）
templates/         项目模板（config.json / AGENTS.md 片段）
docs/              harness 设计文档（01–06）
```

## 跑面板

```bash
cd tools/panel
npm install
npm run dev        # http://localhost:5180
```

## 跑网关

```bash
cd tools/server
node server.mjs --repo .. --port 7001
```

网关会读写本仓的 `routing/graph.json`，校验通过后 commit + push。

## 约定

- **`routing/graph.json` 是唯一数据源**，不要手改；改路由请用面板或直接改这个文件后让 CI 校验
- `skills/<id>/SKILL.md` 的 `name` 必须与目录名、与 graph 里的 `id` 一致
- 提交信息：`skill: …`（改技能）、`routing: …`（改路由）、`panel: …`、`server: …`

## 校验

```bash
node tools/panel/scripts/validate.mjs   # 待建：schema + path 存在性 + id 唯一
```
