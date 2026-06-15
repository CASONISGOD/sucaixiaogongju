# 素材合规中心 · Asset Compliance Hub

一个基于浏览器的素材合规自查与本地修复工具，用于审核图片 / 视频素材是否符合规范。

## 核心能力

### 素材自查
- 批量拖拽上传，支持图片和视频
- 自动检测格式、尺寸、文件大小、宽高比、时长等
- 精确提示不符合项：当前值、要求值和修复建议
- 本地一键修复文件规格问题：格式转换、尺寸调整、文件体积压缩
  - 图片修复基于 Canvas API
  - 视频修复基于 FFmpeg.wasm，首次使用会懒加载

### 规范大全
- 分类浏览和关键词搜索
- 规范详情：技术要求、设计指引、版面分区、推荐底色
- 一键跳转到素材自查，按选中规范进行审核

### 本地素材库
- 自动保存生成或修复后的结果
- 支持预览、下载、删除和清空本地记录

## 本地运行

由于使用 ES Modules，需要通过 HTTP 服务访问，不能直接双击 `index.html`。

### Python

```bash
python3 -m http.server 8080
```

浏览器打开：

```txt
http://localhost:8080
```

### Node.js

```bash
npx --yes serve .
```

或：

```bash
npx --yes http-server -p 8080
```

## 项目结构

```text
sucai-tool/
├── index.html
├── src/
│   ├── main.js
│   ├── styles/main.css
│   ├── data/specs.js
│   ├── validators/
│   │   ├── meta.js
│   │   └── engine.js
│   ├── services/gallery.js
│   └── fixers/
│       ├── image.js
│       └── video.js
└── assets/
```

## 新增规范

只需在 `src/data/specs.js` 中添加规范对象即可。

```js
{
  id: 'my-new-spec',
  name: '新规范名称',
  category: 'banner',
  subCategory: '场景',
  fileType: 'image',
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

## 支持的规则字段

| field | 说明 | 必填字段 |
| --- | --- | --- |
| `format` | 文件格式 | `allowed: string[]` |
| `size` | 文件大小 | `max: number`，单位字节 |
| `dimensions` | 图片 / 视频尺寸 | `width, height` 或 `options` |
| `aspectRatio` | 宽高比 | `value: "16:9"` |
| `duration` | 视频时长 | `max`，可选 `min` |

## 部署

### GitHub Pages

推到 GitHub 后，在仓库设置中开启 Pages，选择 `main` 分支 root 目录即可。

### 任意静态服务器

把整个目录上传到静态服务器即可，无需构建。

## 隐私说明

默认检测、格式转换、尺寸调整、体积压缩、导出和本地素材库都在用户浏览器内处理，不会上传到任何服务器。
