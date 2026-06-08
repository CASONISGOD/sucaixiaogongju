# EdgeOne Pages 前端部署说明

本项目可以拆成：

- EdgeOne Pages：托管前端静态页面
- DevCloud：运行 Node 后端 API

## 1. EdgeOne Pages 配置

- 代码仓库：`git@git.woa.com:casonchen/sucai_tool.git`
- 分支：`main`
- 构建命令：留空
- 输出目录：`.`
- 安装命令：留空

本项目无需前端构建，`index.html`、`src/`、`assets/` 直接作为静态资源发布。

## 2. 前端连接 DevCloud 后端

前端默认支持三种配置后端地址的方式。

### 方式一：URL 参数临时配置

首次打开 EdgeOne Pages 页面时，在 URL 后追加：

```text
?apiBase=https%3A%2F%2F你的-devcloud-后端域名
```

页面会自动把该地址保存到浏览器 `localStorage`，后续访问不需要再带参数。

### 方式二：直接改 `index.html`

把这里改成你的 DevCloud 后端地址：

```html
<script>
  window.SUCAI_TOOL_API_BASE_URL = 'https://你的-devcloud-后端域名';
</script>
```

### 方式三：同源部署

如果前端也由 `server/index.js` 托管，则无需配置，接口会走同源 `/api/...`。

## 3. DevCloud 后端 CORS

前后端分域部署时，建议在 DevCloud 的 `server/.env` 中把 EdgeOne Pages 域名加入允许来源：

```env
ALLOWED_ORIGINS=https://你的-edgeone-pages-域名
```

如果暂时不知道域名，可以先留空验证；正式对外使用前建议收敛为明确域名。

## 4. 验证

前端页面打开后，上传图片并触发智能修复。如果接口失败，先检查：

1. DevCloud 服务是否启动：`curl http://127.0.0.1:3000/api/health`
2. EdgeOne Pages 页面是否配置了正确的 `apiBase`
3. DevCloud `ALLOWED_ORIGINS` 是否包含 EdgeOne Pages 域名
4. DevCloud 后端是否可以访问模型网关
