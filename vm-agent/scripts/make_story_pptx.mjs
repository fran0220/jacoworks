import PptxGenJS from "pptxgenjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// ─────────────────────────────────────────────
// 配色 & 风格（暗黑悬疑 × 深夜城市）
// ─────────────────────────────────────────────
const COLOR = {
  bg:         "0D0D0D",
  card:       "1A1A1A",
  accent:     "C0392B",
  accentMid:  "922B21",
  gold:       "D4AC0D",
  text:       "E8E8E8",
  textMuted:  "8A8A8A",
  white:      "FFFFFF",
};

const W = 13.33;
const H = 7.5;

// ─────────────────────────────────────────────
// 故事幻灯片数据
// ─────────────────────────────────────────────
const Q = "\u201c"; // "
const QQ = "\u201d"; // "

const slides = [
  {
    type: "cover",
    title: "红  伞",
    subtitle: "一个关于门、黑暗与人间琐碎的故事",
    label: "深夜悬疑  ·  短篇小说",
  },
  {
    type: "chapter",
    chapterNum: "01",
    chapterTitle: "凌晨两点十七分",
    body: `林澈的手机震了一下。\n屏幕亮起——一条陌生短信，只有四个字：\n\n${Q}别回消息。${QQ}`,
    label: "INCIDENT",
  },
  {
    type: "chapter",
    chapterNum: "02",
    chapterTitle: "窗外的城市",
    body: `第二条短信弹出：\n${Q}你现在窗边吗？${QQ}\n\n林澈住在十二楼。窗外是沉下去的城市，路灯把雨后的人行道照得像刚擦过的玻璃。`,
    label: "SETTING",
  },
  {
    type: "chapter",
    chapterNum: "03",
    chapterTitle: "规则",
    body: `第三条短信到来：\n\n${Q}如果你看见一个拿着红伞的人，\n别让他进门。${QQ}`,
    label: "WARNING",
    highlight: true,
  },
  {
    type: "chapter",
    chapterNum: "04",
    chapterTitle: "门铃响了",
    body: `短促、坚定，像有人不打算离开。\n\n林澈走到猫眼前：黑色外套，手握一把收拢的红伞，伞尖还在滴水。\n\n他握住门把的手停住了。`,
    label: "TENSION",
  },
  {
    type: "chapter",
    chapterNum: "05",
    chapterTitle: "第二个影子",
    body: `智能门铃回放画面里——\n那人身后还有第二个影子，贴在墙上，扁平得不合理，\n\n手指的形状从墙面里${Q}长${QQ}出来。`,
    label: "HORROR",
  },
  {
    type: "chapter",
    chapterNum: "06",
    chapterTitle: "门缝里的选择",
    body: `${Q}开门。${QQ}\n\n门外的人这次没再客气。\n\n林澈把黑伞从门缝里伸出去，伞尖对准那把红伞的伞柄——\n用力一挑。`,
    label: "ACTION",
  },
  {
    type: "chapter",
    chapterNum: "07",
    chapterTitle: "红伞打开",
    body: `伞面撑开的瞬间，走廊里所有的灯同时熄灭。\n黑暗像一口井罩下来，连呼吸都被吞掉。\n\n最后一条短信亮起：\n${Q}红伞打开时，门就不是你的门了。${QQ}`,
    label: "REVELATION",
    highlight: true,
  },
  {
    type: "chapter",
    chapterNum: "08",
    chapterTitle: "门把手开始自己向下压",
    body: `链条锁不知何时已经解开。\n\n就在门即将被推开的那一刻——\n楼下便利店的自动门${Q}叮咚${QQ}一声。\n\n那声响像远处的灯塔，穿过一层层楼板爬上来。`,
    label: "TURNING POINT",
  },
  {
    type: "chapter",
    chapterNum: "09",
    chapterTitle: "别站在门后",
    body: `如果门不再是你的门，\n那就别站在门后。\n\n林澈转身冲向窗边，拉开窗帘，\n把手机举到窗外，朝楼下按下拨号键。`,
    label: "ESCAPE",
  },
  {
    type: "chapter",
    chapterNum: "10",
    chapterTitle: "便利店夜班",
    body: `${Q}便利店夜班，有什么需要？${QQ}\n\n${Q}我需要你……一直跟我说话。别停。${QQ}\n\n女声开始讲货架、讲雨后进货、讲早晨五点第一辆公交……\n一切普通到不能再普通的事。`,
    label: "CONNECTION",
  },
  {
    type: "chapter",
    chapterNum: "11",
    chapterTitle: "人间的琐碎",
    body: `黑暗在门口停住了，像犹豫，像在倾听。\n\n有些东西不是害怕光，\n而是害怕人间的琐碎——\n害怕有人用平常的声音，把你从一扇不属于你的门里，\n拉回你自己的生活。`,
    label: "THEME",
    highlight: true,
  },
  {
    type: "chapter",
    chapterNum: "12",
    chapterTitle: "天边泛起灰白",
    body: `他把额头抵在玻璃上，听着电话里持续的絮语，\n直到天边泛起一点点灰白。\n\n他这才发现，自己今晚出门没带钥匙，\n却带着父亲留下的那块旧怀表。\n\n指针走得很慢，但在走。`,
    label: "DAWN",
  },
  {
    type: "end",
    title: "红  伞",
    quote: "指针走得很慢，但在走。",
    label: "FIN",
  },
];

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

function addBackground(slide, color = COLOR.bg) {
  slide.addShape("rect", {
    x: 0, y: 0, w: W, h: H,
    fill: { color },
    line: { color },
  });
}

function addLeftBar(slide, x = 0.5, y = 0.8, h = 5.9) {
  slide.addShape("rect", {
    x, y, w: 0.06, h,
    fill: { color: COLOR.accent },
    line: { color: COLOR.accent },
  });
}

function addLabel(slide, text) {
  slide.addText(text, {
    x: W - 2.8, y: H - 0.55, w: 2.6, h: 0.35,
    fontSize: 8,
    color: COLOR.textMuted,
    align: "right",
    fontFace: "Courier New",
    charSpacing: 3,
  });
}

function addPageNum(slide, n, total) {
  slide.addText(`${String(n).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, {
    x: 0.4, y: H - 0.55, w: 1.4, h: 0.35,
    fontSize: 8,
    color: COLOR.textMuted,
    fontFace: "Courier New",
  });
}

// ─────────────────────────────────────────────
// 渲染函数
// ─────────────────────────────────────────────

function renderCover(pptx, data) {
  const slide = pptx.addSlide();
  addBackground(slide);

  // 左侧红色色块
  slide.addShape("rect", {
    x: 0, y: 0, w: W * 0.42, h: H,
    fill: { color: COLOR.accent },
    line: { color: COLOR.accent },
  });

  // 标题（左侧白字）
  slide.addText(data.title, {
    x: 0.4, y: 1.6, w: W * 0.40, h: 2.8,
    fontSize: 80,
    bold: true,
    color: COLOR.white,
    fontFace: "SimHei",
    align: "center",
    charSpacing: 20,
  });

  // 右侧副标题
  slide.addText(data.subtitle, {
    x: W * 0.48, y: 2.2, w: W * 0.48, h: 1.6,
    fontSize: 20,
    color: COLOR.text,
    fontFace: "SimSun",
    align: "left",
    lineSpacingMultiple: 1.8,
  });

  slide.addText(data.label, {
    x: W * 0.48, y: 5.8, w: W * 0.48, h: 0.5,
    fontSize: 10,
    color: COLOR.textMuted,
    fontFace: "Courier New",
    charSpacing: 4,
  });
}

function renderChapter(pptx, data, index, total) {
  const slide = pptx.addSlide();
  addBackground(slide);
  addLeftBar(slide);

  if (data.highlight) {
    slide.addShape("rect", {
      x: 0.7, y: 0.6, w: W - 1.4, h: H - 1.2,
      fill: { color: "1A0A0A" },
      line: { color: "2A0000" },
    });
  }

  // 章节编号
  slide.addText(data.chapterNum, {
    x: 0.75, y: 0.65, w: 1.5, h: 0.8,
    fontSize: 36,
    bold: true,
    color: data.highlight ? COLOR.accent : COLOR.accentMid,
    fontFace: "Courier New",
    charSpacing: 2,
  });

  // 章节标题
  slide.addText(data.chapterTitle, {
    x: 0.75, y: 1.35, w: W - 1.5, h: 0.75,
    fontSize: 28,
    bold: true,
    color: COLOR.white,
    fontFace: "SimHei",
  });

  // 分隔线
  slide.addShape("line", {
    x: 0.75, y: 2.1, w: W - 1.5, h: 0,
    line: { color: data.highlight ? COLOR.accent : "333333", width: 1 },
  });

  // 正文
  slide.addText(data.body, {
    x: 0.75, y: 2.3, w: W - 1.5, h: H - 3.2,
    fontSize: 18,
    color: data.highlight ? "F0CCCC" : COLOR.text,
    fontFace: "SimSun",
    align: "left",
    lineSpacingMultiple: 1.9,
  });

  addLabel(slide, data.label);
  addPageNum(slide, index, total);
}

function renderEnd(pptx, data) {
  const slide = pptx.addSlide();
  addBackground(slide);

  slide.addText(data.title, {
    x: 0, y: 1.8, w: W, h: 2,
    fontSize: 72,
    bold: true,
    color: COLOR.accent,
    fontFace: "SimHei",
    align: "center",
    charSpacing: 20,
  });

  slide.addText(`"${data.quote}"`, {
    x: 1.5, y: 4.2, w: W - 3, h: 1.2,
    fontSize: 20,
    color: COLOR.textMuted,
    fontFace: "SimSun",
    align: "center",
    italic: true,
    lineSpacingMultiple: 1.6,
  });

  slide.addShape("line", {
    x: W / 2 - 1.5, y: 5.6, w: 3, h: 0,
    line: { color: COLOR.accent, width: 1 },
  });

  slide.addText(data.label, {
    x: 0, y: H - 0.8, w: W, h: 0.5,
    fontSize: 12,
    color: "333333",
    fontFace: "Courier New",
    align: "center",
    charSpacing: 8,
  });
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";

const chapterSlides = slides.filter(s => s.type === "chapter");
const totalChapters = chapterSlides.length;
let chapterIndex = 0;

for (const s of slides) {
  if (s.type === "cover") {
    renderCover(pptx, s);
  } else if (s.type === "chapter") {
    chapterIndex++;
    renderChapter(pptx, s, chapterIndex, totalChapters);
  } else if (s.type === "end") {
    renderEnd(pptx, s);
  }
}

const outDir = join(process.cwd(), "output");
mkdirSync(outDir, { recursive: true });

const outPath = join(outDir, "story-linche-red-umbrella.pptx");
await pptx.writeFile({ fileName: outPath });

console.log("PPT 生成成功：" + outPath);
