export interface AdContextMatch {
  intro: boolean;
  offer: boolean;
  strong: boolean;
  cta: boolean;
  reset: boolean;
  price: boolean;
  terms: string[];
  introTerms: string[];
  strongTerms: string[];
  weakTerms: string[];
  ctaTerms: string[];
}

const INTRO_TERMS = [
  "好消息", "挖到宝", "安利", "给大家推荐", "推荐一个", "今天推荐", "本期推荐", "好物推荐",
  "先别划走", "先别急着划走", "带大家看看", "今天带大家", "开讲之前", "正式开始之前",
  "在开始之前", "广告时间", "福利时间", "恰饭", "带货", "商务合作", "本期视频由",
  "本视频由", "联合出品", "品牌赞助", "赞助播出", "竟然是", "居然是", "原来是", "原来就是", "才发现是"
];

const STRONG_TERMS = [
  "赞助", "品牌赞助", "恰饭", "广告", "广告时间", "商务合作", "代言人", "官方旗舰店",
  "旗舰店", "官方授权", "正品保障", "优惠码", "折扣码", "专属优惠", "专属券", "优惠券",
  "大额券", "券后", "领券", "评论区链接", "下方链接", "点击下方", "点击链接", "购买链接",
  "购物链接", "小黄车", "购物车", "橱窗", "下单", "抢购", "限时优惠", "限时活动",
  "活动价", "到手价", "补贴", "百亿补贴", "立减", "满减", "包邮", "买一送一", "赠品",
  "赠送", "抽奖", "兑换码", "礼包码", "新服", "下载游戏", "点击下载", "注册领", "扫码",
  "报名", "训练营", "名额有限", "特价", "秒杀", "低至", "返现", "保价", "免息", "分期",
  "拼多多", "京东", "淘宝", "天猫", "大促", "促销", "抄底价", "全年底价", "买贵退差", "价保",
  "热销榜", "好评榜", "九九大促", "运费险", "运险"
];

const WEAK_TERMS = [
  "严选", "自营", "一手货源", "货源", "验机报告", "品质", "无理由", "退货", "质保",
  "售后", "优惠", "折扣", "便宜", "同款", "入手", "比价格", "价格", "性价比", "配置",
  "性能", "续航", "画质", "效果", "功能", "体验", "测评", "好评", "销量", "爆款",
  "二手", "二手机", "新机", "旧机", "低价", "划算", "省钱", "保障", "服务", "延长保", "送一年",
  "按摩仪", "肩颈", "颈椎", "热敷", "艾灸", "揉捏", "捶打", "酥麻", "斜方肌", "经络",
  "语音播报", "力度", "模式", "按摩店", "用了一年", "用了一年多", "轻快", "舒缓", "柔和",
  "放松", "教师节", "送恩师", "抗压", "低头", "剪视频", "soeasy", "舒服"
];

const CTA_TERMS = [
  "点击", "领券", "下单", "购买", "入手", "抢购", "链接", "小黄车", "购物车", "下载",
  "注册", "报名", "扫码", "进店", "搜索", "评论区", "福利", "薅", "冲冲冲", "冲冲",
  "买它", "带一个", "给家人", "送恩师", "试试", "冲"
];

const RESET_TERMS = [
  "回到本案", "回到案件", "回到正题", "言归正传", "话说回来", "我们继续讲", "接下来我们讲",
  "下面我们讲", "正式开始", "故事还要从", "大家想没有", "大家想知道"
];

function compact(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\u200b-\u200d\ufeff]+/g, "");
}

function matchedTerms(text: string, terms: string[]): string[] {
  const haystack = compact(text);
  return terms.filter((term) => haystack.includes(compact(term)));
}

export function matchAdContext(text: string): AdContextMatch {
  const introTerms = matchedTerms(text, INTRO_TERMS);
  const strongTerms = matchedTerms(text, STRONG_TERMS);
  const weakTerms = matchedTerms(text, WEAK_TERMS);
  const ctaTerms = matchedTerms(text, CTA_TERMS);
  const resetTerms = matchedTerms(text, RESET_TERMS);
  return {
    intro: introTerms.length > 0,
    offer: strongTerms.length > 0 || weakTerms.length > 0,
    strong: strongTerms.length > 0,
    cta: ctaTerms.length > 0,
    reset: resetTerms.length > 0,
    price: /(?:\d+(?:\.\d+)?(?:元|块|折)|[一二三四五六七八九十]+折|低至|到手价|元券|券后)/.test(compact(text)),
    terms: Array.from(new Set([...introTerms, ...strongTerms, ...weakTerms, ...ctaTerms])),
    introTerms,
    strongTerms,
    weakTerms,
    ctaTerms
  };
}
