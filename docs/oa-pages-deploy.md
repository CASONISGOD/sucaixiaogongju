# OA Pages 前端部署说明

本项目采用：

- OA Pages（`pages.woa.com`）：托管前端静态页面
- DevCloud：运行 Node 后端 API

## 1. 目标域名

```text
https://sucai-tool.pages.woa.com
```

## 2. Git 部署规则

OA Pages 优先读取仓库的 `oa-pages` 分支，静态资源放在该分支根目录。

本项目的 `oa-pages` 分支只放前端静态资源：

```text
CNAME
index.html
src/
assets/
```

不放后端和密钥相关文件：

```text
server/
scripts/
docs/
server/.env
```

## 3. CNAME

`oa-pages` 分支根目录需要有 `CNAME` 文件，内容为：

```text
sucai-tool.pages.woa.com
```

## 4. 仓库授权

首次使用 Git 部署时，需要访问：

```text
https://pages.woa.com/oauth/authorize
```

授权后 OA Pages 会自动：

1. 给仓库添加 `oa-pages` 公共账号，权限为 `Reporter`
2. 给仓库添加 Webhook：`https://pages.woa.com/webhook`

这样 push `oa-pages` 分支后会自动部署。

## 5. 前端连接 DevCloud 后端

OA Pages 只是前端静态站点，AI 修图接口仍在 DevCloud。

首次打开页面时，在 URL 后加 `apiBase` 参数：

```text
https://sucai-tool.pages.woa.com/?apiBase=https%3A%2F%2F你的-devcloud-后端域名
```

页面会把后端地址保存到浏览器 `localStorage`，后续不用每次都带参数。

## 6. DevCloud 后端 CORS

前后端分域时，建议在 DevCloud 的 `server/.env` 中配置：

```env
ALLOWED_ORIGINS=https://sucai-tool.pages.woa.com
```

改完后重启后端：

```bash
bash scripts/devcloud-stop.sh
bash scripts/devcloud-start.sh
```

## 7. 验证

1. 打开：`https://sucai-tool.pages.woa.com`
2. DevCloud 检查：`curl http://127.0.0.1:3000/api/health`
3. 上传图片并触发智能修复，确认前端能请求 DevCloud 后端。

## 8. 查看日志与权限

- 管理页：`https://pages.woa.com/admin`
- 日志：`https://pages.woa.com/logs`

新站点默认可能是白名单模式，若团队需要访问，请在管理页调整访问权限。
