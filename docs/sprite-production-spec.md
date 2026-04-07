# 精灵形象批量生产规格

> 2025-04-05 · Pipeline 已验证通过

## 技术规格

| 项目 | 规格 |
|------|------|
| 参考图 | 512×768 px, PNG, 透明背景 |
| 动画精灵表 | 每状态 6 帧, 水平排列, 128×192 per frame → 768×192 sheet |
| 头像裁切 | 从参考图裁切头部区域, 256×256 圆形 (CSS clip) |
| 风格 | 像素 RPG (Stardew Valley / Fire Emblem chibi), 3头身, 可见像素点, 温暖柔和配色 |
| 流水线 | painter 生成参考图 → upload → video (idle/各状态动画) → extract-frames 6帧 → remove-bg → compose sheet |

## 6 个动画状态

| 状态 | 视频 prompt 关键词 | 动画描述 |
|------|-------------------|----------|
| `idle` | gentle idle breathing, subtle body sway, slow rhythmic, standing still | 微微呼吸起伏 + 轻微身体摇摆 |
| `thinking` | thinking pose, hand on chin, looking up, pondering, eyes looking upward | 手托下巴思考，眼睛看上方 |
| `speaking` | talking animation, mouth opening closing, gesturing with one hand, friendly | 张嘴说话 + 手势表达 |
| `working` | typing on floating holographic screen, focused expression, busy working | 专注操作虚拟屏幕/工具 |
| `happy` | celebrating, jumping slightly, arms raised, cheerful expression, excited | 开心跳跃/举手庆祝 |
| `error` | confused, scratching head, question mark, puzzled expression | 困惑挠头，问号 |

## 10 个角色形象包

每个角色 = 1 张参考图 (ref.png) + 6 张精灵表 (idle/thinking/speaking/working/happy/error.png)

| # | ID | 名字 | 性别 | 风格描述 | 主色 |
|---|-----|------|------|----------|------|
| 1 | `kael` | 凯尔 | 男 | **默认主角** · 蓝色冒险斗篷金边, 棕发蓝眸, 少年冒险者 | 皇家蓝 + 金 |
| 2 | `luna` | 露娜 | 女 | **月光学者** · 深紫长袍银星纹, 银白长发紫眸, 手持魔法书 | 深紫 + 银 |
| 3 | `ember` | 烬火 | 男 | **铁匠工匠** · 皮围裙锻造服, 红棕短发琥珀眼, 肩扛小锤 | 赤铜 + 暖橙 |
| 4 | `iris` | 鸢尾 | 女 | **花园精灵** · 绿色藤蔓连衣裙, 蜜金卷发绿眸, 头戴花冠 | 翠绿 + 花粉 |
| 5 | `zephyr` | 泽风 | 男 | **赛博行者** · 黑色电路纹夹克, 深蓝乱发, 发光护目镜推头顶 | 暗灰 + 青光 |
| 6 | `yuki` | 雪绘 | 女 | **冰晶巫女** · 白色巫女袍冰蓝腰带, 浅蓝双马尾, 冰晶耳饰 | 冰蓝 + 白 |
| 7 | `rex` | 锐克 | 男 | **骑士卫兵** · 轻铠配红披风, 金发碧眼, 英气正义 | 银甲 + 赤红 |
| 8 | `sage` | 知微 | 中性 | **书院先生** · 墨绿汉服交领, 黑发束发髻, 折扇半开, 温文 | 墨绿 + 宣纸白 |
| 9 | `coral` | 珊瑚 | 女 | **海岸航海士** · 水手条纹衫+防风夹克, 短红发, 望远镜 | 海军蓝 + 珊瑚 |
| 10 | `flint` | 燧石 | 男 | **矿洞探险家** · 皮风帽+工装背带裤, 深肤色棕眼, 头灯 | 土黄 + 矿石青 |

## 文件结构

```
webchat/public/sprites/
  kael/
    ref.png              ← 参考原图 (512×768)
    idle.png             ← 精灵表 (768×192, 6帧)
    thinking.png
    speaking.png
    working.png
    happy.png
    error.png
  luna/
    ref.png
    idle.png ...
  ...
```

## 组件改造

### SpriteAvatar 改造
- **展开态 (lg)**: 全身精灵表动画, 128×192 每帧, CSS `steps(6)` 或 rAF 逐帧播放
- **折叠态 (sm)**: 从 ref.png 裁切头部, 48px 圆形, `object-position: top` + `object-fit: cover`
- 新增 `spritePackId` prop (替代 `agentId` 作为资产路径)

### sprite-packs.ts 注册表
```ts
interface SpritePack {
  id: string;         // 'kael'
  name: string;       // '凯尔'
  description: string;
  gender: 'male' | 'female' | 'neutral';
  accentColor: string;
  preview: string;    // '/sprites/kael/ref.png'
}
```

### 形象选择器
- ProfileEditor / 团队模板: 新增 AvatarPicker 组件
- 网格展示所有可用形象包, 点选
- 选中的 spritePackId 存入 profile / localStorage

## 并行生产计划

5 个 deep 线程, 每线程 2 角色:
- Thread A: kael + luna
- Thread B: ember + iris  
- Thread C: zephyr + yuki
- Thread D: rex + sage
- Thread E: coral + flint

1 个 deep 线程: 代码实现
- Thread F: SpriteAvatar 改造 + sprite-packs.ts + AvatarPicker + CSS 动画
