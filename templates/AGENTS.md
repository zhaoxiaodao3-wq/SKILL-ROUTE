<!-- harness:start -->
## Harness（可选流程，不强制）

项目装了 `harness` 技能包，**默认不介入**任何开发任务。需要时从斜杠菜单选 `harness`，或直接说「走 harness 流程」。

| 动作 | 命令 |
|---|---|
| 看阶段 | `node {{CLI}} status --match "<关键词>"` |
| 建需求模块 | `node {{CLI}} new --type feature --name "<模块名>"` |
| 给计划标 skill | `node {{CLI}} annotate <plan.md>` |
| 提交前自查 | `node {{CLI}} check` |

- 所有产物都在 `{{DIR}}/` 一个目录里（需求文档 `{{DOCS_ROOT}}/`），已在 `.gitignore` 里忽略，不进版本库
- 技能包配置：`{{DIR}}/config.json`、`{{DIR}}/skills.lock`
- 删除本段（harness 开始标记到结束标记之间）即彻底解耦，不影响项目其他内容
<!-- harness:end -->
