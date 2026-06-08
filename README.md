# 素材合规中心 · Asset Compliance Hub

一个基于浏览器的素材合规自查与修复工具，用于审核图片 / 视频素材是否符合业务规范，并支持一键智能修复。

## ✨ 核心能力

### 🔍 素材自查
- 批量拖拽上传（支持图片 + 视频）
- 自动检测：格式、尺寸、文件大小、宽高比、时长等
- 精确提示不符合项（当前值 vs 要求值 + 修复建议）
- 一键修复：仅保留格式转换、尺寸调整、文件体积压缩
  - 图片修复：基于 Canvas API
  - 视频修复：基于 FFmpeg.wasm（首次使用会懒加载）

### 📖 规范大全
- 分类浏览 + 关键词搜索
- 规范详情：技术要求、设计指引、版面分区、推荐底色
- 一键跳转到素材自查，使用该规范进行审核

## 🚀 本地运行

由于使用了 ES Modules，不能直接双击 HTML 打开，需要一个 HTTP 服务。任选其一：

### 方式 1：Python
```bash
cd "/path/to/shenhe tool"
python3 -m http.server 8080
# 然后在浏览器打开：http://localhost:8080
```

### 方式 2：Node.js
```bash
npx --yes serve .
# 或
npx --yes http-server -p 8080
```

### 方式 3：VSCode Live Server 插件
右键 `index.html` → Open with Live Server

## 📁 项目结构

```
shenhe-tool/
├── index.html                # 应用入口
├── src/
│   ├── main.js               # 主逻辑（UI + 交互）
│   ├── styles/main.css       # 全局样式（暗黑主题）
│   ├── data/specs.js         # 规范数据库（核心扩展点）
│   ├── validators/
│   │   ├── meta.js           # 素材元信息提取
│   │   └── engine.js         # 校验引擎
│   ├── services/
│   │   └── gallery.js        # 本地素材库记录
│   └── fixers/
│       ├── image.js          # 图片修复（格式 / 尺寸 / 体积）
│       └── video.js          # 视频修复（格式 / 尺寸 / 体积）
└── assets/                   # Figma 参考素材
```

## 📏 新增规范

只需在 `src/data/specs.js` 中添加一个对象即可，无需改代码：

```js
{
  id: 'my-new-spec',
  name: '新规范名称',
  category: 'banner',        // 分类 id
  subCategory: '场景',
  fileType: 'image',         // image | video
  description: '...',
  rules: [
    { field: 'format', label: '文件格式', allowed: ['jpg', 'png'], level: 'error' },
    { field: 'dimensions', label: '尺寸', width: 660, height: 220, level: 'error' },
    { field: 'size', label: '文件大小', max: 250 * 1024, level: 'error' }
  ],
  guidelines: ['设计注意事项 1', '设计注意事项 2'],
  canvasSize: { width: 660, height: 220 },
  layoutZones: [
    { name: 'LOGO区', left: 16, top: 16, width: 120, height: 40, tip: '不可超出' }
  ],
  recommendedColors: ['#A50000', '#5B6919']
}
```

### 支持的规则字段

| field | 说明 | 必填字段 |
|-------|------|---------|
| `format` | 文件格式 | `allowed: string[]` |
| `size` | 文件大小 | `max: number`（字节） |
| `dimensions` | 图片/视频尺寸 | `width, height` 或 `options: [{width, height}]` |
| `aspectRatio` | 宽高比 | `value: "16:9"` |
| `duration` | 视频时长（秒） | `max`（可选 `min`） |

## 🎨 设计风格

- 暗黑主题 + 蓝色高亮（`#3B82F6`）
- 参考 cushion.so 的卡片式布局 / 柔和阴影 / 大量留白
- 字体：PingFang SC / SF Pro SC

## 🚢 部署

### Vercel
```bash
npx vercel
```

### GitHub Pages
推到 GitHub，在仓库设置中开启 Pages，选 `main` 分支 root 目录即可。

### 任何静态服务器
把整个目录上传即可，无需 build。

## 🔒 隐私说明

默认的检测、格式转换、尺寸调整、体积压缩和导出都在用户本地浏览器内处理，**不会上传到任何服务器**。

## 🤖 接入 GPT Image2 生图 / 修图

本项目使用安全的本地后端代理接入 **GPT Image2**。前端不会保存模型 token，也不会直接请求模型接口。

### 1. 准备 GPT Image2 token

在公司内部权限中心申请并加入正式应用组后，准备该应用组可用的 token。

> 注意：不要把 token 写进前端代码、README、截图或聊天记录，也不要提交到 Git。真实 token 只放在本地 `server/.env`。

### 2. 配置后端环境变量

```bash
cd server
cp .env.example .env
```

然后编辑 `server/.env`：

```env
GPT_IMAGE2_API_KEY=你的token
GPT_IMAGE2_API_BASE_URL=http://v2.open.venus.oa.com/llmproxy
GPT_IMAGE2_GENERATIONS_PATH=/images/generations
GPT_IMAGE2_EDITS_PATH=/images/edits
GPT_IMAGE2_MODEL=gpt-image-2
GPT_IMAGE2_QUALITY=medium
VISION_API_BASE_URL=http://v2.open.venus.oa.com/chatproxy
VISION_CHAT_PATH=/chat/completions
VISION_MODEL=gpt-5.5
HOST=0.0.0.0
PORT=3000
```

### 3. 启动服务

后端使用 Node.js 内置能力，不需要安装依赖；同一个服务会同时托管前端页面和后端 API。

```bash
npm start
```

如果部署在 DevCloud，可以后台启动：

```bash
bash scripts/devcloud-start.sh
```

启动成功后，浏览器打开：

```txt
http://localhost:3000
```

健康检查：

```txt
http://localhost:3000/api/health
```

在素材自查结果里点击「一键修复」且系统识别需要智能修图时，前端会默认调用同源后端：

```txt
POST /api/gpt-image2/fix-image
```

该接口会把原图和当前规范要求提交给 GPT Image2 生成修复图，然后前端再做一次本地尺寸 / 格式 / 体积后处理。

### 4. 接口说明

后端接口：

```txt
POST /api/gpt-image2/generate-image
POST /api/gpt-image2/fix-image
POST /api/gpt-image2/identify-text
```

`generate-image` 调用 `/images/generations`，`fix-image` 调用 `/images/edits` 并返回修复后的 `imageBase64`、`mimeType`、`filename` 等信息。`identify-text` 调用 `VISION_MODEL`（默认 `gpt-5.5`）尝试识别图片文案和按钮 bbox，用于安全区检测；如果效果不稳定，可再接入专业 OCR。
