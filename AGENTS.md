# David Whyte Experience — 协作规则

开始实质工作前依次阅读：

1. [`工程记忆/AGENTS.md`](./工程记忆/AGENTS.md)
2. [`工程记忆/日志/README.md`](./工程记忆/日志/README.md)
3. [`工程记忆/日志/MOC_工作日志.md`](./工程记忆/日志/MOC_工作日志.md)
4. 与当前任务相关的分类 MOC 和最近日志。

## 边界

- `sources/original-extraction/` 是唯一原始源码基线，只读；不要修改、格式化或向其中写入生成物。
- `evidence/` 是已接受证据；新增证据应保留来源与日期，不覆盖既有基线。
- 可再生产物只能写入 `app/node_modules/`、`app/dist/` 或 `app/.artifacts/`，这些目录不纳入 Git。
- 每轮实质性工作结束后，按工程记忆规则新增一篇日志并更新所属 MOC 与总 MOC。
