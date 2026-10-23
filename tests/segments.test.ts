import { describe, expect, it } from "vitest";
import { buildSegments, matchedKeywords, nextCueForTarget } from "../src/core/segments";
import { parseVideoRef, videoKey } from "../src/content/bilibili";
import { DEFAULT_SETTINGS, normalizeKeywords, sanitizeSettings } from "../src/settings";
import type { Settings } from "../src/settings";
import type { Cue } from "../src/core/types";
import type { CustomRule } from "../src/core/rules";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  keywords: ["ACEMAGIC", "优惠码"],
  detectContextAds: false
};

function cue(id: string, from: number, to: number, text: string): Cue {
  return { id, startMs: from * 1000, endMs: to * 1000, text };
}

describe("keyword normalization", () => {
  it("drops empty values and merges case-insensitive duplicates", () => {
    expect(normalizeKeywords(["  AceMagic ", "", "acemagic", "优惠码"])).toEqual(["AceMagic", "优惠码"]);
  });

  it("matches English products without case sensitivity", () => {
    expect(matchedKeywords("这台 aceMAGIC 主机", ["ACEMAGIC"])).toEqual(["ACEMAGIC"]);
  });

  it("matches product names when ASR inserts spaces between Chinese characters", () => {
    expect(matchedKeywords("这期聊聊神 奇 小 鹿", ["神奇小鹿"])).toEqual(["神奇小鹿"]);
  });

  it("clamps numeric settings", () => {
    const result = sanitizeSettings({ mergeGapSeconds: -2, beforeBufferSeconds: 20, afterBufferSeconds: 100 });
    expect(result.mergeGapSeconds).toBe(0);
    expect(result.beforeBufferSeconds).toBe(10);
    expect(result.afterBufferSeconds).toBe(30);
    expect(result.detectContextAds).toBe(true);
    expect(result.danmakuJumpEnabled).toBe(true);
    expect(result.aiEnabled).toBe(false);
    expect(result.aiProvider).toBe("deepseek");
    expect(result.aiEndpoint).toBe("https://api.deepseek.com/v1");
    expect(result.aiModel).toBe("deepseek-chat");
    expect(sanitizeSettings({ detectContextAds: false }).detectContextAds).toBe(false);
    expect(result.customRules).toEqual([]);
  });

  it("keeps valid custom rules and drops broken ones", () => {
    const result = sanitizeSettings({
      customRules: [
        { name: "电商商单", keywords: ["旗舰店"] },
        { name: "坏正则", pattern: "(" }
      ] as unknown as CustomRule[]
    });
    expect(result.customRules).toHaveLength(1);
    expect(result.customRules[0]?.name).toBe("电商商单");
    expect(sanitizeSettings(undefined).customRules).toEqual([]);
  });
});

describe("Bilibili video navigation", () => {
  it("reads BVID and the selected page", () => {
    expect(parseVideoRef("https://www.bilibili.com/video/BV1Test0001/?p=3&spm=1")).toEqual({ bvid: "BV1Test0001", aid: undefined, page: 3 });
    expect(videoKey({ bvid: "BV1Test0001", page: 3 })).toBe("BV1Test0001:p3");
  });

  it("supports legacy av links and rejects non-video pages", () => {
    expect(parseVideoRef("https://www.bilibili.com/video/av123")).toEqual({ aid: 123, page: 1 });
    expect(parseVideoRef("https://www.bilibili.com/bangumi/play/ep1")).toBeNull();
  });
});

describe("segment building", () => {
  it("merges nearby hit subtitles, includes the middle cues, and applies buffers", () => {
    const cues = [
      cue("0", 0, 2, "今天讲一个案件"),
      cue("1", 10, 12, "接下来介绍一下 ACEMAGIC 主机"),
      cue("2", 15, 17, "这个配置确实不错"),
      cue("3", 19, 21, "记得使用优惠码购买"),
      cue("4", 22, 24, "我们回到案件本身")
    ];
    const segments = buildSegments(cues, settings.keywords, settings, 60_000);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.startMs).toBe(9_000);
    expect(segments[0]?.endMs).toBe(22_000);
    expect(segments[0]?.cues.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(segments[0]?.matchedKeywords).toEqual(["ACEMAGIC", "优惠码"]);
  });

  it("keeps hits separate when the subtitle gap exceeds the configured threshold", () => {
    const cues = [
      cue("1", 10, 12, "ACEMAGIC"),
      cue("2", 21, 23, "优惠码")
    ];
    const segments = buildSegments(cues, settings.keywords, { ...settings, mergeGapSeconds: 8 }, 60_000);
    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([
      [9_000, 14_000],
      [20_000, 25_000]
    ]);
  });

  it("does not extend beyond the video duration", () => {
    const cues = [cue("1", 58, 59.5, "ACEMAGIC")];
    const [segment] = buildSegments(cues, settings.keywords, settings, 60_000);
    expect(segment?.endMs).toBe(60_000);
  });

  it("ignores invalid cues and returns no segments for an empty keyword list", () => {
    const cues = [
      cue("bad", 5, 4, "ACEMAGIC"),
      cue("1", 10, 11, "ACEMAGIC")
    ];
    expect(buildSegments(cues, [], settings, 60_000)).toEqual([]);
    expect(buildSegments(cues, ["ACEMAGIC"], settings, 60_000)).toHaveLength(1);
  });

  it("finds the first cue at or after the skip target", () => {
    const cues = [cue("1", 1, 2, "a"), cue("2", 8, 9, "b")];
    expect(nextCueForTarget(cues, 7_500)?.id).toBe("2");
    expect(nextCueForTarget(cues, 9_500)).toBeUndefined();
  });

  it("bridges product mentions through an offer-heavy ad paragraph", () => {
    const cues = [
      cue("content-1", 72.12, 76.28, "今天给大家讲最有代表性的这期火车抛尸案"),
      cue("pre-ad", 76.28, 77.36, "在开讲之前"),
      cue("intro-1", 77.36, 79.7, "还是要告诉大家一个好消息"),
      cue("intro-2", 79.7, 81.28, "最近啊挖到宝了"),
      cue("product-1", 81.28, 83.88, "爱回收严选的二手机是真划算"),
      cue("detail-1", 83.88, 85.76, "就我手上这IPHONE15pro"),
      cue("detail-2", 85.76, 86.58, "别的平台啊"),
      cue("detail-3", 86.58, 88.68, "同款普遍在3200多"),
      cue("product-2", 88.68, 92.22, "在爱回收严选入手只要2971"),
      cue("detail-4", 92.22, 94.24, "便宜了200多呢想买二手机"),
      cue("product-3", 94.24, 97.12, "先去爱回收严选比比价格准没错"),
      cue("product-4", 97.12, 100.84, "而且爱回收严选的二手机都是自营一手货源"),
      cue("bridge-1", 100.84, 103.5, "每台机子标配详细验机报告"),
      cue("bridge-2", 103.5, 104.68, "品质一目了然"),
      cue("bridge-3", 104.68, 106.54, "还支持七天无理由退货"),
      cue("bridge-4", 106.54, 107.46, "整整一年"),
      cue("bridge-5", 107.46, 108.54, "质保不仅便宜"),
      cue("bridge-6", 108.54, 109.62, "还有售后兜底"),
      cue("bridge-7", 109.62, 110.68, "最近活动优惠"),
      cue("bridge-8", 110.68, 113.64, "每天派发2988元大额券包"),
      cue("bridge-9", 113.64, 114.46, "人人可领"),
      cue("bridge-10", 114.46, 115.34, "加19块九"),
      cue("bridge-11", 115.34, 117.08, "还能再送一年延长"),
      cue("product-5", 117.08, 122.8, "快跟爱回收全球品牌代言人吴磊一起薅福利吧"),
      cue("content-2", 124.06, 126.78, "大家想没有面部样貌和指纹")
    ];
    const segments = buildSegments(cues, ["爱回收"], settings, 1626_000);
    const [segment] = segments;
    expect(segments).toHaveLength(1);
    expect(segment?.startMs).toBe(76_280);
    expect(segment?.endMs).toBe(124_060);
    expect(segment?.adContextTerms).toEqual(expect.arrayContaining(["好消息", "挖到宝", "验机报告", "质保", "优惠", "福利"]));
    const generic = buildSegments(cues, [], { ...settings, keywords: [], detectContextAds: true }, 1626_000);
    expect(generic).toHaveLength(1);
    expect(generic[0]?.matchedKeywords).toEqual([]);
    expect(generic[0]?.startMs).toBe(76_280);
    expect(generic[0]?.endMs).toBe(124_060);
  });

  it("detects a sponsored block without any word-list match when commerce evidence is strong", () => {
    const cues = [
      cue("content", 0, 2, "今天先讲一个案件"),
      cue("intro", 10, 12, "在正式开讲之前先别划走"),
      cue("intro-2", 12, 14, "最近挖到宝了给大家推荐一个效率工具"),
      cue("detail", 14, 16, "这款工具价格不贵功能很多"),
      cue("strong-1", 16, 18, "官方旗舰店正品保障"),
      cue("strong-2", 18, 20, "还能领专属优惠券"),
      cue("cta", 20, 22, "点击下方链接下单"),
      cue("content-2", 24, 26, "我们回到案件本身")
    ];
    const noKeywordsSettings = { ...settings, keywords: [], detectContextAds: true };
    const segments = buildSegments(cues, [], noKeywordsSettings, 60_000);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.matchedKeywords).toEqual([]);
    expect(segments[0]?.startMs).toBe(9_000);
    expect(segments[0]?.endMs).toBe(24_000);
    expect(segments[0]?.adContextTerms).toEqual(expect.arrayContaining(["先别划走", "官方旗舰店", "优惠券", "点击"]));
    expect(buildSegments(cues, [], { ...noKeywordsSettings, detectContextAds: false }, 60_000)).toEqual([]);
  });

  it("does not classify an ordinary product review without offer or purchase language", () => {
    const cues = [
      cue("review-1", 10, 12, "今天聊聊这款相机的价格"),
      cue("review-2", 12, 14, "价格六千元画质和续航不错"),
      cue("review-3", 14, 16, "配置和功能也符合预期"),
      cue("review-4", 16, 18, "体验很好值得推荐")
    ];
    expect(buildSegments(cues, [], { ...settings, keywords: [], detectContextAds: true }, 60_000)).toEqual([]);
  });

  it("detects a story-reveal product demonstration without the product being in the word list", () => {
    const cues = [
      cue("content-1", 362.32, 366.11, "吓得我手电开到最大才敢回头偷瞄啊"),
      cue("reveal", 366.11, 368.93, "竟然是妙界柔垂肩颈按摩仪"),
      cue("comfort", 370.03, 372.78, "我说怎么一下一下搭着有点舒服呢"),
      cue("mechanism", 372.78, 374.98, "揉捏加捶打能不酥麻吗"),
      cue("testimonial", 374.98, 375.94, "用了一年多啊"),
      cue("benefit", 378.14, 381.44, "现在哪怕是全天唱跳也so easy"),
      cue("trial", 383.46, 386.44, "正好这波九九大促大家入手试试"),
      cue("feature", 386.8, 389.94, "还可以给家人恩师带个自带语音播报"),
      cue("other", 393.98, 395.34, "其他按摩仪都没有"),
      cue("heat", 399.79, 401.41, "再配上艾灸热敷"),
      cue("meridian", 401.41, 403.34, "把经络呀软化舒展"),
      cue("soft", 403.34, 406.48, "我的脖子像弹簧一样柔和"),
      cue("pressure", 409.28, 411.8, "另外还有朋友总问自己抗压呀"),
      cue("rank", 414.42, 416.46, "妙妙作为热销好评榜"),
      cue("editing", 432.8, 435.98, "瞧瞧我现在剪视频就习惯把它往身后扣上"),
      cue("light", 439.14, 441.94, "明显能感觉到起身巨轻快"),
      cue("price", 443.3, 445.1, "就是全年抄底价保价"),
      cue("guarantee", 445.1, 446.24, "一年买贵退差"),
      cue("warranty", 446.24, 447.62, "还有运险和质保"),
      cue("cta", 447.62, 451.48, "自己用教师节送恩师都冲冲冲"),
      cue("content-2", 452.2, 455.88, "这个故事发生在三四十年前的四川")
    ];
    const segments = buildSegments(cues, [], { ...settings, keywords: [], detectContextAds: true }, 1626_000);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.startMs).toBe(366_110);
    expect(segments[0]?.endMs).toBe(452_200);
    expect(segments[0]?.matchedKeywords).toEqual([]);
    expect(segments[0]?.adContextTerms).toEqual(expect.arrayContaining(["竟然是", "按摩仪", "大促", "好评榜", "买贵退差", "冲冲冲"]));
  });
});
