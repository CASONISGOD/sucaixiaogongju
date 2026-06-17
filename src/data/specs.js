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
  /* ========== 1-4 新首页头图 ========== */
  {
    id: 'platform-new-home-hero',
    name: '1-4 新首页头图',
    shortName: '1-4 新首页头图',
    category: 'platform',
    subCategory: '新首页头图',
    subOrder: 4,
    fileType: 'video',
    description: '用于平台新首页头图的视频素材，包含视频、视频首帧图、定帧图和背景色值。',
    templateMockupPreviewAsset: 'assets/image/1-4/定帧图.png',
    variants: [],
    rules: [
      {
        field: 'format',
        label: '文件格式',
        allowed: ['mp4'],
        level: 'error',
        tip: '必须输出 MP4 格式'
      },
      {
        field: 'dimensions',
        label: '视频尺寸',
        width: 2400,
        height: 600,
        level: 'error',
        tip: '必须为 2400×600px'
      },
      {
        field: 'duration',
        label: '视频时长',
        min: 5,
        max: 5,
        level: 'error',
        tip: '视频时长需为 5s'
      },
      {
        field: 'size',
        label: '文件大小',
        max: 7 * 1024 * 1024,
        level: 'error',
        tip: '文件大小需小于 7MB'
      }
    ],
    // 规范说明内容（Markdown）
    markdown: `
# 输出示意

![视频](assets/image/1-4/视频.mp4)

![视频首帧图](assets/image/1-4/视频首帧图.png)

![定帧图](assets/image/1-4/定帧图.png)

![背景色值](assets/image/1-4/新首页样机.png)

# 输出一：视频

![视频](assets/image/1-4/视频.mp4)

- 尺寸：2400*600px
- 时长：5s
- 帧率：25帧/秒
- 格式：MP4
- 文件大小：小于7MB

:::gray-box
1. 点击右上角按钮上传一段{{red:1200*600px的5s剪辑好的视频}}，自动生成交付素材；
2. 视频为3-5个大动态镜头，只包括CG演绎，不包括定帧动画；
3. 上传的视频不需要有透明度变化或渐变遮罩，这些效果会自动生成。
:::

# 输出二：视频首帧图

![视频首帧图](assets/image/1-4/视频首帧图.png)

- 尺寸：1200*600px
- 格式：png
- 文件大小：500kb以内

:::gray-box
将视频的第一帧单独提取导出首帧图，底部半透明渐变需要保留
:::

# 输出三：定帧图

![标注图](assets/image/1-4/输出三/输出三标注图.png)

::download::下载标注图::assets/image/1-4/输出三/输出三标注图.png::1-4输出三定帧图标注图.png::

::template-mockup::标注图样机::assets/image/1-4/输出三/输出三标注图.png::

- 尺寸：750*636px
- 格式：png
- 文件大小：250kb以内

:::gray-box
1.如图红色区域为危险区，禁止放置任何元素

2.标题和按钮禁止超出如图蓝色区域，IP禁止超出如图绿色区域

3.IP人物面部不要被顶部灵动岛遮挡

4.图片必须是透明底
:::

# 输出四：背景色值

::color-palette::色值::#1B5556, #3BB2B5, #B7E7E8, #B7E7E8 a 0%::

- 格式：HEX

:::gray-box
根据视频主色调提取，从上到下由深到浅
:::

# 模板样机

::template-mockup::assets/image/1-4/新首页样机.png::

`.trim(),
    designNotes: [],
    attentionNotes: [],
    guidelines: [],
    recommendedColors: ['#1B5556', '#3BB2B5', '#B7E7E8'],
    examples: []
  },

  /* ========== 2-1 静态首页头图 ========== */
  {
    id: 'home-static-hero',
    name: '2-1 静态首页头图',
    shortName: '2-1 静态首页头图',
    category: 'home',
    subCategory: '首页头图',
    subOrder: 1,
    fileType: 'image',
    description: '用于首页首屏头图的静态推广位，强调游戏识别度、利益点表达和按钮可读性。',
    templateMockupPreviewAsset: 'assets/image/2-1/1.png',
    variants: [
      {
        id: 'default',
        name: '首页头图',
        width: 750,
        height: 500,
        canvasSize: { width: 750, height: 500 },
        layoutZones: [
          { name: '文案 / 按钮安全区', left: 310, top: 93, width: 340, height: 82, tip: '文案和按钮必须完整位于该区域' },
          { name: '危险区-顶部', left: 0, top: 0, width: 750, height: 93, tip: '禁止出现标题、按钮和关键文案' },
          { name: '危险区-左侧', left: 0, top: 93, width: 310, height: 82, tip: '禁止出现标题、按钮和关键文案' },
          { name: '危险区-右侧', left: 650, top: 93, width: 100, height: 82, tip: '禁止出现标题、按钮和关键文案' },
          { name: '危险区-底部', left: 0, top: 175, width: 750, height: 325, tip: '禁止出现标题、按钮和关键文案' }
        ]
      }
    ],
    rules: [
      {
        field: 'format',
        label: '文件格式',
        allowed: ['png'],
        level: 'error',
        tip: '必须输出 PNG 格式'
      },
      {
        field: 'dimensions',
        label: '图片尺寸',
        level: 'error',
        tip: '必须为 750×500px'
      },
      {
        field: 'size',
        label: '文件大小',
        max: 2 * 1024 * 1024,
        level: 'error',
        tip: '每张文件大小需小于 2MB'
      },
      {
        field: 'colorZone',
        label: '底色',
        level: 'error',
        maxS: 40,
        minB: 60,
        minRatio: 4.5,
        tip: '底色需避开低饱和高亮度的浅色/灰白区，并与白色文字保持足够对比度'
      },
      {
        field: 'backgroundTexture',
        label: '背景底纹',
        level: 'error',
        minVariedRatio: 0.02,
        minAverageDistance: 2,
        minP90Distance: 8,
        minBackgroundPixelRatio: 0.2,
        tip: '必须使用约 20% 透明度的 KV 背景作为底纹，不能只使用纯色底'
      },
      {
        field: 'titleButtonSafeZone',
        label: '安全区',
        level: 'error',
        safeZone: { name: '文案 / 按钮安全区', left: 310, top: 93, width: 340, height: 82 },
        safeZoneKeyword: '文案',
        tolerance: 2,
        minAreaRatio: 0.00002,
        maxAreaRatio: 0.04,
        searchPadding: { left: 0, top: 0, right: 0, bottom: 0 },
        tip: '标题和按钮需完整位于图中间偏右上的安全区内，不能进入红色危险区'
      }
    ],
    // 规范说明内容（Markdown）
    markdown: `
# 输出示意

## 首页头图

![](assets/image/2-1/1.png)

![](assets/image/2-1/2.png)

![](assets/image/2-1/3.png)

# 输出一：静态首页头图

![标注图](assets/image/2-1/2-1静态首页头图标注图.png)

::download::下载标注图::assets/image/2-1/2-1静态首页头图标注图.png::2-1静态首页头图标注图.png::

::template-mockup::标注图样机::assets/image/2-1/2-1静态首页头图标注图.png::

- 尺寸：750*500px
- 格式：PNG
- 每张文件大小：小于2MB

:::gray-box
1.危险区：{{red:如图红色区域为危险区，禁止出现文字和按钮}}

2.文案：建议精简表达并且包含游戏信息，避免文案过长，{{red:禁止文案进入危险区}}

3.IP：使用游戏IP或活动主视觉元素，尽量不要进入危险区，在模板中不要被框架ui遮挡

3.按钮：字号最小为20px；按钮需选取较为明亮的颜色

4.底色：根据KV主色调进行选择，{{red:必须保证白色文字在上面清晰可见}}（建议色值HSB：S ≤ 40% 且 B ≥ 60%）

5.底纹：{{red:必须使用20%透明度的KV背景作为底纹，不能只使用纯色底}}
:::

# 输出二：头图底色色值

::color-palette::色值::#A50000::

- 格式：HEX

:::gray-box
1.根据头图的主色调选取

2.建议选择饱和度和明度都较低的色值，保证框架ui的浅色字能够清晰可见
:::

# 模板样机

::template-mockup::assets/image/2-1/首页样机.png::

::template-mockup::橙色预警::assets/image/2-1/首页样机-橙色预警.png::

::template-mockup::红色预警::assets/image/2-1/首页样机-红色预警.png::

::template-mockup::雷暴预警::assets/image/2-1/首页样机-雷暴.png::

::template-mockup::台风预警::assets/image/2-1/首页样机-台风.png::

::template-mockup::头部底色::assets/image/2-1/首页样机-底色.png::

:::gray-box
1.标题和按钮要{{red:整体水平对齐于左侧的天气}}，不要太偏上或者偏下

2.确保QQ浏览器框架UI没有遮挡素材核心元素

3.需要保证台风预警、雷暴预警、橙色预警、红色预警的文字能够清晰可见
:::

`.trim(),
    designNotes: [],
    attentionNotes: [],
    guidelines: [],
    recommendedColors: [],
    examples: []
  },

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
    templateMockupPreviewAsset: {
      default: 'assets/image/4-9/1.png',
      byTitle: [
        { includes: '大尺寸', src: 'assets/image/4-9/1.png' },
        { includes: '小尺寸', src: 'assets/image/4-9/2.png' }
      ]
    },
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
          { name: '危险区', left: 0, top: 0, width: 330, height: 220, tip: '除 LOGO 区外禁止出现 IP、主元素和多余 LOGO' },
          { name: 'LOGO 区', left: 16, top: 16, width: 158, height: 40, tip: '游戏 LOGO 禁止超出' },
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
          { name: '危险区', left: 0, top: 0, width: 190, height: 220, tip: '除 LOGO 区外禁止出现 IP、主元素和多余 LOGO' },
          { name: 'LOGO 区', left: 16, top: 16, width: 158, height: 40, tip: '游戏 LOGO 禁止超出' },
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
        minRatio: 4.5,
        recommendedColors: ['#A50000', '#5B6919', '#381B96', '#523914', '#314733', '#5E1053', '#184054', '#253254'],
        tip: '主色需避开发灰发白区域，并与白色文字保持足够对比度；请换用饱和度更高或更深的底色'
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
        field: 'safeZone',
        label: '安全区',
        level: 'error',
        tolerance: 2,
        alignTolerance: 8,
        tip: 'LOGO 需完整处于左上角 158×40 LOGO 区内并与左边缘对齐；游戏 IP 或主元素需完整处于右侧 IP / 主元素区内，不能进入左侧红色危险区'
      },
      {
        field: 'dangerZone',
        label: 'IP 主元素位置',
        level: 'error',
        componentType: 'keyVisual',
        forbiddenZoneKeywords: ['危险区'],
        allowedZoneKeywords: ['LOGO'],
        minAreaRatio: 0.004,
        minOverlapRatio: 0.05,
        targetLabel: 'IP / 主元素',
        requiredText: '左半边危险区除左上角 LOGO 外，不允许出现 IP、主视觉或多余 LOGO',
        passText: '未发现 IP / 主元素进入左半边危险区',
        tip: '请把游戏人物、角色、道具或活动主视觉整体放在右半边'
      },
      {
        field: 'logoQuality',
        label: 'LOGO 大小清晰度',
        level: 'warning',
        minWidthRatio: 0.35,
        minHeightRatio: 0.35,
        maxWidthRatio: 1.05,
        maxHeightRatio: 1.05,
        requiredText: 'LOGO 需要在左上角 LOGO 区内保持适中大小和清晰度',
        tip: 'LOGO 过小会影响识别，过大则容易超出安全区'
      },
      {
        field: 'ipCoverage',
        label: 'IP 主元素占比',
        level: 'warning',
        minWidthRatio: 0.42,
        minHeightRatio: 0.35,
        minBoxAreaRatio: 0.18,
        requiredText: 'IP / 主元素需在右侧区域保持足够视觉占比',
        tip: '主元素过小会导致右侧画面空，建议选择轮廓饱满的 IP 或活动主视觉'
      },
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

![标注图](assets/image/4-9/biaozhu-1-样机.png)

::download::下载标注图::assets/image/4-9/biaozhu-1-样机.png::4-9新游戏频道大尺寸banner标注图.png::

::template-mockup::大尺寸标注图样机::assets/image/4-9/biaozhu-1-样机.png::

- 尺寸：660*220px
- 格式：PNG/JPG
- 文件大小：小于250KB

:::gray-box
1.危险区：左半边红色区域为危险区，{{red:除左上角 LOGO 区外禁止出现 IP 和 LOGO}}

2.LOGO：LOGO 放在左上角空白处，距离左边约 16px、距离顶部约 16px，可用范围 158*40px，{{red:LOGO 需要左对齐该区域}}

3.IP：右半边是游戏 IP 或活动主元素区，可用范围 330*220px，尽量选择轮廓饱满的元素撑满该区域

4.底纹：{{red:使用20%透明度的KV背景作为底纹}}

5.底色：根据KV主色调进行选择，{{red:必须保证白色文字在上面清晰可见}}（建议色值HSB：S ≤ 40% 且 B ≥ 60%）
:::

# 输出二：小尺寸banner

![标注图](assets/image/4-9/biaozhu-2-样机.png)

::download::下载标注图::assets/image/4-9/biaozhu-2-样机.png::4-9新游戏频道小尺寸banner标注图.png::

::template-mockup::小尺寸标注图样机::assets/image/4-9/biaozhu-2-样机.png::

- 尺寸：380*220px
- 格式：PNG/JPG
- 文件大小：小于250KB

:::gray-box
1.危险区：左半边红色区域为危险区，{{red:除左上角 LOGO 区外禁止出现 IP 和 LOGO}}

2.LOGO：LOGO 放在左上角空白处，距离左边约 16px、距离顶部约 16px，可用范围 158*40px，{{red:LOGO 需要左对齐该区域}}

3.IP：右半边是游戏 IP 或活动主元素区，可用范围 190*220px，其他保持与大尺寸相同制作方式
:::

# 模板样机

::template-mockup::游戏中心样机::assets/image/4-9/游戏中心样机.png::

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
