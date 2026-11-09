export const INSIGHT_KEYS = [
  'danger', 'water', 'camp', 'rescue', 'exit', 'supply',
  'crossing', 'junction', 'summit', 'access', 'viewpoint',
];

const RULES = [
  {
    key: 'danger',
    important: true,
    positive: /危险|陡崖|悬崖|落石|滑坡|塌方|冰裂缝|雪崩|急流|禁止通行|注意安全|险段|易滑|暴露感|danger|cliff|rockfall|landslide|avalanche|crevasse|scramble|exposed|do not cross/gi,
    negative: /无危险|危险已解除|危险已排除|路况安全|danger cleared|no danger|safe route/gi,
  },
  {
    key: 'water',
    important: true,
    positive: /水源|补水|取水|泉眼|泉水|溪流|河边|井水|水潭|water source|water|spring|stream|river|creek|refill/gi,
    negative: /无水源|没有水源|水源干涸|干涸.*水源|补水点无水|取水点无水|no water|dry spring|water unavailable|water source dry/gi,
  },
  {
    key: 'camp',
    important: true,
    positive: /营地|扎营|露营|营位|宿营|适合扎营|营地平台|campsite|camp ground|campground|tent site|bivouac/gi,
    negative: /禁止扎营|不可露营|无营地|营地关闭|不适合扎营|no camping|no campsite|camping prohibited|campsite closed/gi,
  },
  {
    key: 'rescue',
    important: true,
    positive: /救援|求助|急救|应急点|应急电话|报警点|rescue|emergency help|emergency|call for help/gi,
    negative: /无救援|救援已撤销|no rescue|rescue unavailable/gi,
  },
  {
    key: 'exit',
    important: true,
    positive: /下撤|撤退点|撤离|逃生|出口|bailout|bail out|escape route|retreat|exit route/gi,
    negative: /不能下撤|无法下撤|出口关闭|no exit|exit closed|bailout unavailable/gi,
  },
  {
    key: 'supply',
    important: true,
    positive: /补给|商店|超市|餐饮|客栈|农家乐|食物|resupply|supply|shop|store|restaurant|food|guesthouse/gi,
    negative: /无补给|补给关闭|没有补给|no supply|resupply closed|shop closed/gi,
  },
  {
    key: 'crossing',
    important: false,
    positive: /过河|涉水|渡口|独木桥|石桥|木桥|冰面|river crossing|crossing|ford|bridge/gi,
    negative: /桥断|无法过河|禁止过河|bridge closed|no crossing|impassable/gi,
  },
  {
    key: 'junction',
    important: false,
    positive: /岔路|分叉|路口|汇合点|左转|右转|junction|fork|turnoff|split|turn left|turn right/gi,
    negative: /不是岔路|没有岔路|not a junction|no junction/gi,
  },
  {
    key: 'summit',
    important: false,
    positive: /主峰|山顶|峰顶|垭口|山脊|最高点|summit|mountain peak|\bpeak\b|\bsaddle\b|\bpass\b/gi,
    negative: /不是山顶|not the summit/gi,
  },
  {
    key: 'access',
    important: false,
    positive: /登山口|入口|停车场|公交站|车站|trailhead|entrance|parking|bus stop|station/gi,
    negative: /入口关闭|禁止进入|entrance closed|no entry|parking closed/gi,
  },
  {
    key: 'viewpoint',
    important: false,
    positive: /观景|景点|视野开阔|拍照点|摄影点|viewpoint|viewpoint|scene|photo spot|camera/gi,
    negative: /无景观|no view|view blocked/gi,
  },
];

function evidenceIn(text, pattern) {
  pattern.lastIndex = 0;
  const evidence = [];
  for (const match of text.matchAll(pattern)) {
    if (match[0] && !evidence.includes(match[0])) evidence.push(match[0]);
  }
  return evidence;
}

function splitSentences(text) {
  return text
    .split(/(?<=[。！？!?；;])|\n+|(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isNegated(text, rule) {
  if (!rule.negative) return false;
  rule.negative.lastIndex = 0;
  return rule.negative.test(text);
}

/**
 * Local, explainable classification of names, full descriptions and KML/GPX icon hints. Evidence is evaluated
 * per sentence so "near water, but camping prohibited" can keep water and reject camp.
 */
export function classifyWaypoint(point = {}) {
  const name = String(point.name || '');
  const description = String(point.insightText || point.description || '');
  const icon = String(point.icon || '');
  const sentences = splitSentences(description);
  const allText = `${name}\n${description}`.toLocaleLowerCase();
  const categories = [];

  for (const rule of RULES) {
    // A negative statement anywhere in the waypoint overrides an earlier positive label. This covers names
    // such as "旧营地" followed by "禁止扎营" and icon hints contradicted by the description.
    if (isNegated(allText, rule)) continue;
    const nameEvidence = evidenceIn(name.toLocaleLowerCase(), rule.positive);
    const descriptionEvidence = [];
    const contexts = [];
    for (const sentence of sentences) {
      const lower = sentence.toLocaleLowerCase();
      if (isNegated(lower, rule)) continue;
      const matches = evidenceIn(lower, rule.positive);
      if (matches.length === 0) continue;
      descriptionEvidence.push(...matches.filter((match) => !descriptionEvidence.includes(match)));
      if (!contexts.includes(sentence)) contexts.push(sentence);
    }
    const iconEvidence = evidenceIn(icon.toLocaleLowerCase(), rule.positive)
      .map((match) => `icon:${match}`);
    const evidence = [...new Set([...nameEvidence, ...descriptionEvidence, ...iconEvidence])];
    if (evidence.length === 0) continue;
    categories.push({
      key: rule.key,
      important: rule.important,
      confidence: nameEvidence.length > 0 ? 'high' : 'medium',
      evidence,
      contexts: nameEvidence.length > 0 && contexts.length === 0 ? [name] : contexts,
    });
  }

  return {
    primary: categories[0]?.key || null,
    categories,
    important: categories.some((category) => category.important),
    evidence: [...new Set(categories.flatMap((category) => category.evidence))],
    contexts: [...new Set(categories.flatMap((category) => category.contexts))],
  };
}
