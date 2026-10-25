/**
 * Canonical product vocabulary. Every user-facing label for a core
 * concept comes from here so the same thing is never called two
 * different names across surfaces. Platform/source names are NOT
 * defined here - they live in lib/source-label.ts.
 *
 * Retired names that must not come back: 首页 for the todo queue,
 * 采购清单 for the cart, 捡漏 / 扫描 / 发现 for the catalog, 协作 /
 * 团队 / 团队空间 for the message surface, 监控配置 for monitoring
 * settings, 采购记录 for the purchase records.
 */
export const TERMS = {
  // Primary navigation
  todo: "待办",
  catalog: "选货",
  messages: "消息",
  workbench: "工作台",

  // Pages and surfaces
  favorites: "收藏",
  sellers: "商家",
  links: "链接导入",
  purchases: "购买记录",
  orders: "库存订单",
  procurement: "采购",
  calculator: "采购测算",
  logistics: "物流",
  costTool: "算账",
  intel: "市场情报",
  resale: "转售",
  monitoring: "监控设置",
  disliked: "不感兴趣",

  // Actions and objects
  cart: "购物车",
  addToCart: "加入购物车",
  decisionWant: "要",
  decisionPass: "不要",
  decisionBought: "已买下",
  decided: "已定",
  bundle: "待发清单",
  sendBundle: "发给搭档",
  shareRound: "分享轮次",
  partner: "搭档",
  negotiate: "砍价",
  negotiationScript: "砍价话术",
  registerPurchase: "登记购买",
  remove: "删除",
  notInterested: "不感兴趣",

  // Listing states and purchase types
  sold: "已售",
  ended: "已结束",
  delisted: "已下架",
  unverifiable: "暂无法核验",
  directPurchase: "直购",
  auction: "拍卖",

  // AI surface
  aiAssistant: "AI 助手",
  aiQuota: "AI 额度",
  aiSuggestion: "AI 建议",

  // Todo home queues
  queueReview: "待评估",
  queueNegotiating: "砍价中",
  queueRegister: "待登记",
  queueInventory: "库存提醒",
  queueSystem: "系统提醒",
  overview: "概览",
  allClear: "全部处理完",
} as const;

export type TermKey = keyof typeof TERMS;
