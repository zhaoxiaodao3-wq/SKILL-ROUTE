# 网关（待实现）

职责：面板的**唯一写入口**，以及项目的**只读数据源**。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/graph` | `{ graph, sha }`，sha 用于乐观锁 |
| PUT | `/api/graph` | 校验 → commit → push；sha 不匹配返回 409 |
| GET | `/api/bundle` | 给项目：`{ sha, graph, skillsIndex }`，带 ETag |
| GET | `/install` | 新电脑装技能包的一行脚本 |
| POST | `/api/ai` | 代理模型调用，密钥只在服务端 |

## 约定

- 仓库根由启动参数 `--repo` 指定，默认本仓
- 校验不过**不写盘**：schema、path 存在、分类无环、id 唯一
- 提交信息自动生成：`routing: 改 3 个触发词，新增 1 个 skill`
- 部署：`systemd` 单服务，监听 `127.0.0.1:7001`，由 nginx 反代
