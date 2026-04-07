import type { CityAgentState } from "../CityAgent";
import type { CitizenType, CitizenTypeInfo, CityCitizen } from "./types";

export const CITY_SIM_WAKEUP_STORY = "亦庄数字之城正在苏醒...";

export const CITIZEN_TYPES: Record<CitizenType, CitizenTypeInfo> = {
  resident: {
    typeLabel: "市民",
    accent: "#60a5fa",
    homeZones: ["eco_garden", "tongming_lake", "esports_center"],
    behaviors: [
      "在通明湖散步放松",
      "到电竞中心观看比赛",
      "在生态花园晨练",
      "去科创中心参观新展览",
      "到物流港取快递",
    ],
  },
  merchant: {
    typeLabel: "商家",
    accent: "#f59e0b",
    homeZones: ["logistics_port", "esports_center", "eco_garden"],
    behaviors: [
      "在物流港清点进货",
      "前往电竞中心摆摊",
      "到生态花园补充食材",
      "去数据中枢查看销售报表",
    ],
  },
  venue_operator: {
    typeLabel: "场馆经营者",
    accent: "#a855f7",
    homeZones: ["esports_center", "innovation_center", "city_hall"],
    behaviors: [
      "在电竞中心调试设备",
      "到科创中心洽谈合作",
      "前往中枢提交经营报告",
      "巡查场馆安全设施",
    ],
  },
  robot: {
    typeLabel: "机器人",
    accent: "#22d3ee",
    homeZones: ["robotics_park", "logistics_port", "data_hub"],
    behaviors: [
      "在机器人产业园充电维护",
      "前往物流港分拣快递",
      "到数据中枢上传巡检日志",
      "沿城市路网执行安防巡检",
      "在科创中心协助搬运实验器材",
    ],
  },
  developer: {
    typeLabel: "开发者",
    accent: "#34d399",
    homeZones: ["innovation_center", "data_hub", "robotics_park"],
    behaviors: [
      "在科创中心查看项目进展",
      "到数据中枢调试接口",
      "前往机器人产业园联调硬件",
      "在通明湖边写技术文档",
    ],
  },
  official: {
    typeLabel: "政务",
    accent: "#f87171",
    homeZones: ["city_hall", "data_hub"],
    behaviors: [
      "在中枢审批城市规划方案",
      "到数据中枢查看民生指标",
      "前往科创中心调研新项目",
      "巡视生态花园绿化工程",
    ],
  },
  creator: {
    typeLabel: "创作者",
    accent: "#c084fc",
    homeZones: ["tongming_lake", "esports_center", "eco_garden"],
    behaviors: [
      "在通明湖直播城市风光",
      "到电竞中心拍摄赛事花絮",
      "在生态花园创作短视频",
      "前往科创中心采访创业者",
    ],
  },
};

export const CITY_CITIZENS: CityCitizen[] = [
  { id: "c-res-01", name: "林小雨", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "eco_garden", description: "喜欢在花园晨跑的上班族" },
  { id: "c-res-02", name: "王建国", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "tongming_lake", description: "退休后每天绕湖走三圈" },
  { id: "c-res-03", name: "陈晨", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "esports_center", description: "电竞爱好者，周末常来观赛" },
  { id: "c-res-04", name: "赵敏", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "eco_garden", description: "带孩子在花园玩耍的年轻妈妈" },
  { id: "c-res-05", name: "孙文轩", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "tongming_lake", description: "通明湖畔的业余摄影师" },
  { id: "c-res-06", name: "周子涵", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "esports_center", description: "刚搬来亦庄的新住户" },
  { id: "c-res-07", name: "吴佳琪", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "eco_garden", description: "社区志愿者，热心肠" },
  { id: "c-res-08", name: "郑浩然", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "tongming_lake", description: "每天骑车通勤的程序员" },
  { id: "c-res-09", name: "冯雅婷", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "eco_garden", description: "在花园练太极的阿姨" },
  { id: "c-res-10", name: "黄子豪", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "esports_center", description: "放学后来电竞中心的中学生" },
  { id: "c-mer-01", name: "张师傅烤鸭", type: "merchant", typeLabel: "商家", accent: "#f59e0b", homeZoneId: "logistics_port", description: "物流港旁的老字号烤鸭摊" },
  { id: "c-mer-02", name: "李记便利", type: "merchant", typeLabel: "商家", accent: "#f59e0b", homeZoneId: "esports_center", description: "电竞中心门口的便利店老板" },
  { id: "c-mer-03", name: "陈大姐水果", type: "merchant", typeLabel: "商家", accent: "#f59e0b", homeZoneId: "eco_garden", description: "花园入口的鲜果铺" },
  { id: "c-mer-04", name: "老刘茶馆", type: "merchant", typeLabel: "商家", accent: "#f59e0b", homeZoneId: "tongming_lake", description: "通明湖旁的露天茶座" },
  { id: "c-ven-01", name: "张经理", type: "venue_operator", typeLabel: "场馆经营者", accent: "#a855f7", homeZoneId: "esports_center", description: "电竞中心运营负责人" },
  { id: "c-ven-02", name: "刘馆长", type: "venue_operator", typeLabel: "场馆经营者", accent: "#a855f7", homeZoneId: "innovation_center", description: "科创展览馆馆长" },
  { id: "c-ven-03", name: "何主任", type: "venue_operator", typeLabel: "场馆经营者", accent: "#a855f7", homeZoneId: "city_hall", description: "中枢服务大厅主任" },
  { id: "c-bot-01", name: "巡检 K7", type: "robot", typeLabel: "机器人", accent: "#22d3ee", homeZoneId: "robotics_park", description: "24 小时安防巡检机器人" },
  { id: "c-bot-02", name: "速递 D3", type: "robot", typeLabel: "机器人", accent: "#22d3ee", homeZoneId: "logistics_port", description: "物流港快递分拣机器人" },
  { id: "c-bot-03", name: "清扫 W1", type: "robot", typeLabel: "机器人", accent: "#22d3ee", homeZoneId: "eco_garden", description: "花园道路清扫机器人" },
  { id: "c-bot-04", name: "导览 G5", type: "robot", typeLabel: "机器人", accent: "#22d3ee", homeZoneId: "data_hub", description: "数据中枢访客导览机器人" },
  { id: "c-dev-01", name: "许明远", type: "developer", typeLabel: "开发者", accent: "#34d399", homeZoneId: "innovation_center", description: "AI 视觉算法工程师" },
  { id: "c-dev-02", name: "杨思琪", type: "developer", typeLabel: "开发者", accent: "#34d399", homeZoneId: "data_hub", description: "大数据平台后端开发" },
  { id: "c-dev-03", name: "钱磊", type: "developer", typeLabel: "开发者", accent: "#34d399", homeZoneId: "robotics_park", description: "机器人操作系统开发者" },
  { id: "c-off-01", name: "李副区长", type: "official", typeLabel: "政务", accent: "#f87171", homeZoneId: "city_hall", description: "分管科技与产业的副区长" },
  { id: "c-off-02", name: "王科长", type: "official", typeLabel: "政务", accent: "#f87171", homeZoneId: "data_hub", description: "数字化治理科科长" },
  { id: "c-cre-01", name: "苏小夏", type: "creator", typeLabel: "创作者", accent: "#c084fc", homeZoneId: "tongming_lake", description: "本地生活博主，粉丝 50 万" },
  { id: "c-cre-02", name: "方逸尘", type: "creator", typeLabel: "创作者", accent: "#c084fc", homeZoneId: "esports_center", description: "电竞赛事解说与短视频创作者" },
];

export const ARRIVAL_STATES: Record<CitizenType, CityAgentState[]> = {
  resident: ["working", "thinking"],
  merchant: ["working"],
  venue_operator: ["working"],
  robot: ["working", "reviewing"],
  developer: ["thinking", "working"],
  official: ["reviewing", "thinking"],
  creator: ["working", "celebrating"],
};
