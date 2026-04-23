/**
 * 素材规范库
 *
 * 一条规范（spec）可以包含多个「尺寸变体（variants）」
 * 例如"新游戏频道 banner"同时接受 660×220 和 380×220 两种尺寸
 *
 * 校验逻辑：上传素材时先通过尺寸匹配出具体变体，再按该变体的规则校验；
 * 如果不匹配任何变体 → 提示"尺寸不符合任何一个预设"
 */

export const categories = [
  { id: 'platform', order: 1, name: '1-平台' },
  { id: 'home', order: 2, name: '2-首页' },
  { id: 'profile', order: 3, name: '3-个人中心' },
  { id: 'game-center', order: 4, name: '4-游戏中心' },
  { id: 'search', order: 5, name: '5-搜索' },
  { id: 'file', order: 6, name: '6-文件' },
  { id: 'direct', order: 7, name: '7-直达' },
  { id: 'pc', order: 8, name: '8-PC端' },
  { id: 'external', order: 9, name: '9-端外' },
  { id: 'activity', order: 10, name: '10-活动页' },
  { id: 'novel', order: 11, name: '11-小说' }
];

export const specs = [
  /* ========== 4-9 新游戏频道 banner ========== */
  {
    id: 'game-center-new-banner',
    name: '4-9 新游戏频道 banner',
    shortName: '4-9 新游戏频道 banner',
    category: 'game-center',
    subCategory: '新游戏频道',
    subOrder: 9,
    fileType: 'image',
    description: '用于新游戏频道的主推广位，包含大/小两种尺寸规格。',
    // 同一素材位支持的不同尺寸变体
    variants: [
      {
        id: 'large',
        name: '大尺寸',
        width: 660,
        height: 220,
        canvasSize: { width: 660, height: 220 },
        layoutZones: [
          { name: 'LOGO 区', left: 16, top: 16, width: 120, height: 40, tip: '游戏 LOGO 禁止超出' },
          { name: 'IP / 主元素区', left: 330, top: 0, width: 330, height: 220, tip: '主视觉元素禁止超出' }
        ]
      },
      {
        id: 'small',
        name: '小尺寸',
        width: 380,
        height: 220,
        canvasSize: { width: 380, height: 220 },
        layoutZones: [
          { name: 'LOGO 区', left: 16, top: 16, width: 120, height: 40, tip: '游戏 LOGO 禁止超出' },
          { name: 'IP / 主元素区', left: 190, top: 0, width: 190, height: 220, tip: '主视觉元素禁止超出' }
        ]
      }
    ],
    rules: [
      {
        field: 'format',
        label: '文件格式',
        allowed: ['jpg', 'jpeg', 'png'],
        level: 'error',
        tip: '建议使用 JPG 以获得更小的文件体积；需要透明背景时使用 PNG'
      },
      {
        // 当存在 variants 时，dimensions 规则使用变体里的尺寸去校验
        field: 'dimensions',
        label: '图片尺寸',
        level: 'error',
        tip: '必须匹配其中一种预设尺寸'
      },
      {
        field: 'size',
        label: '文件大小',
        max: 250 * 1024,
        level: 'error',
        tip: '超出限制会影响加载速度，可使用 TinyPNG 等工具压缩'
      }
    ],
    // Markdown 格式的规范说明（展示在规范区）
    markdown: `
## 规格说明

该素材位提供 **两种尺寸** 规格，设计师按实际投放位选择对应规格制作：

| 规格 | 尺寸 | 用途 |
|------|------|------|
| **大尺寸** | \`660 × 220 px\` | 主推广位 / 主 Banner |
| **小尺寸** | \`380 × 220 px\` | 次级位 / 轮播位 |

## 通用技术要求

- **文件格式**：\`JPG\` / \`JPEG\` / \`PNG\`（推荐 JPG）
- **文件大小**：\`≤ 250 KB\`
- **色彩模式**：\`RGB\`

## 设计指引

1. **左上角 LOGO 区（120 × 40 px）**：游戏 LOGO 禁止超出该区域
2. **右侧 IP / 主元素区**：
   - 大尺寸规格：\`330 × 220 px\`
   - 小尺寸规格：\`190 × 220 px\`
   - 主视觉元素禁止超出该区域
3. **主视觉建议**：尽量选择轮廓饱满的图形

## 推荐底色

从以下 8 个色值中取色作为底色：

- #A50000 · #5B6919 · #381B96 · #523914
- #314733 · #5E1053 · #184054 · #253254

## 制作要点

> 右侧 IP 区可利用游戏海报作为底纹，**透明度设置为 20%**，再叠加主视觉元素，可获得最佳层次感。
`.trim(),
    guidelines: [
      '左上角为游戏 LOGO 区（120×40 px），游戏 LOGO 禁止超出该区域',
      '右侧为游戏 IP 或主元素区，禁止超出该区域',
      '尽量选择轮廓饱满的图形作为主视觉',
      '底色建议从 8 个推荐色值中取色',
      '可利用游戏海报作为底纹，透明度设置为 20%'
    ],
    recommendedColors: [
      '#A50000', '#5B6919', '#381B96', '#523914',
      '#314733', '#5E1053', '#184054', '#253254'
    ]
  }
];

/**
 * 根据 id 获取规范
 */
export function getSpecById(id) {
  return specs.find(s => s.id === id);
}

/**
 * 返回树形结构：category → subCategory → specs[]
 */
export function getSpecTree() {
  const tree = [];
  for (const cat of categories) {
    const catSpecs = specs.filter(s => s.category === cat.id);
    const subMap = new Map();
    for (const spec of catSpecs) {
      const key = spec.subCategory || '其他';
      if (!subMap.has(key)) {
        subMap.set(key, { name: key, order: spec.subOrder || 99, specs: [] });
      }
      subMap.get(key).specs.push(spec);
    }
    const subGroups = Array.from(subMap.values()).sort((a, b) => a.order - b.order);
    tree.push({ ...cat, empty: catSpecs.length === 0, subGroups });
  }
  return tree;
}
