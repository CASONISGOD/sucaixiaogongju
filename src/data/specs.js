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
    generator: {
      type: 'newGameBanner',
      backgroundOpacity: 0.2,
      palette: ['#A50000', '#5B6919', '#381B96', '#523914', '#314733', '#5E1053', '#184054', '#253254']
    },
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
      },
      {
        // 主色禁用区校验：S ≤ 40% 且 B ≥ 60% 视为不合规（浅色/灰白）
        field: 'colorZone',
        label: '底色',
        level: 'error',
        maxS: 40,
        minB: 60,
        recommendedColors: ['#A50000', '#5B6919', '#381B96', '#523914', '#314733', '#5E1053', '#184054', '#253254'],
        tip: '主色落在调色板左上角（低饱和高亮度）区域，画面会显得发灰发白，压不住主视觉；请换用饱和度更高或更深的底色'
      },
      {
        field: 'backgroundTexture',
        label: '背景底纹',
        level: 'error',
        minVariedRatio: 0.035,
        minAverageDistance: 4,
        minP90Distance: 12,
        minBackgroundPixelRatio: 0.2,
        tip: '背景需利用游戏海报作为底纹，不能只使用纯色底'
      },
      {
        field: 'logoPosition',
        label: 'LOGO位置',
        level: 'error',
        zoneKeyword: 'LOGO',
        tolerance: 2,
        alignTolerance: 8,
        tip: 'LOGO 需完整处于 LOGO 区内，并与 LOGO 区左边缘对齐'
      },
      {
        field: 'ipPosition',
        label: 'IP位置',
        level: 'error',
        zoneKeyword: 'IP',
        tolerance: 2,
        tip: '游戏 IP 或主元素需完整处于 IP / 主元素区内'
      }
    ],
    // 规范说明内容（Markdown）
    markdown: `
# 输出示意

## 小尺寸banner

![](assets/image/4-9/2.png)

![](assets/image/4-9/4.png)

![](assets/image/4-9/6.png)

## 大尺寸banner

![](assets/image/4-9/1.png)

![](assets/image/4-9/3.png)

![](assets/image/4-9/5.png)

# 输出一：大尺寸banner

![标注图](assets/image/4-9/biaozhu-1.png)

- 尺寸：660*220px
- 格式：PNG/JPG
- 文件大小：小于250KB

:::gray-box
1.左上角为游戏LOGO区，游戏logo禁止超出该区域，并需居左对齐LOGO区

2.右侧为游戏IP或主元素区，禁止超出该区域，尽量选择轮廓饱满的图形

3.底色取色建议：直接从以下色值中取色

::color-palette::#A50000,#5B6919,#381B96,#523914,#314733,#5E1053,#184054,#253254::

4.利用游戏海报作为底纹，透明度为20%
:::

# 输出二：小尺寸banner

![标注图](assets/image/4-9/biaozhu-2.png)

- 尺寸：380*220px
- 格式：PNG/JPG
- 文件大小：小于250KB

:::gray-box
在大尺寸banner的基础上修改尺寸，以及缩减游戏ip的宽度区域，其他保持相同制作方式
:::

`.trim(),
    designNotes: [],
    attentionNotes: [],
    guidelines: [],
    recommendedColors: [],
    examples: []
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
