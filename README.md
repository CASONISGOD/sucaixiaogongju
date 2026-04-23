# 素材合规中心 · Asset Compliance Hub

一个基于浏览器的素材合规自查与修复工具，用于审核图片 / 视频素材是否符合业务规范，并支持一键智能修复。

## ✨ 核心能力

### 🔍 素材自查
- 批量拖拽上传（支持图片 + 视频）
- 自动检测：格式、尺寸、文件大小、宽高比、时长等
- 精确提示不符合项（当前值 vs 要求值 + 修复建议）
- 智能修复：用户选择修复方式 → 预览对比 → 确认下载
  - 图片修复：基于 Canvas API
  - 视频修复：基于 FFmpeg.wasm（首次使用会懒加载）
- 导出审核报告（CSV）

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
│   └── fixers/
│       ├── image.js          # 图片修复（Canvas）
│       └── video.js          # 视频修复（FFmpeg.wasm 懒加载）
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

所有文件都在用户本地浏览器内处理，**不会上传到任何服务器**。
