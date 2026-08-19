# 原始来源

`original-extraction/` 是本工程唯一可信的原始提取镜像。其文件在迁移时已逐项以
SHA-256 校验，并被设置为只读；应用仅从 `app/public/assets/` 加载自身的本地副本。

不要修改、格式化或将构建产物写入该目录。来源完整性与迁移记录见
[`../evidence/maintenance/reorganization-manifest-2026-08-20.json`](../evidence/maintenance/reorganization-manifest-2026-08-20.json)。
