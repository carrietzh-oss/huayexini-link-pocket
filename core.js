const DEFAULT_CATEGORIES = [
  { id: "inbox", name: "待整理", color: "#C9C4D7" },
  { id: "ai-products", name: "需要体验的 AI 产品", color: "#B8A7FF" },
  { id: "reading", name: "需要阅读的内容", color: "#FFD36E" },
  { id: "visual-reference", name: "可参考的设计以及视频", color: "#FF9FBA" },
  { id: "actionable-ideas", name: "可以落地的想法", color: "#8EDBC4" },
  { id: "prompts", name: "好用 Prompt", color: "#FFB37A" },
  { id: "web-coding", name: "Web Coding Idea", color: "#82C7FF" }
];

const CATEGORY_COLORS = ["#B8A7FF", "#FFD36E", "#FF9FBA", "#8EDBC4", "#82C7FF", "#FFB37A", "#A9D8FF", "#DDB7F5"];

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(value) {
  return chrome.storage.local.set(value);
}

async function ensureState() {
  const state = await storageGet(["categories", "items"]);
  const categories = Array.isArray(state.categories) && state.categories.length
    ? state.categories.map(({ id, name, color }) => ({ id, name, color }))
    : DEFAULT_CATEGORIES;
  const items = Array.isArray(state.items) ? state.items.map(item => ({
    author: "",
    description: "",
    cover: "",
    platform: "",
    mediaType: "",
    classificationReason: "",
    ...item
  })) : [];
  await storageSet({ categories, items });
  return { categories, items };
}

function normalizeUrl(url = "") {
  try {
    const parsed = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(key => parsed.searchParams.delete(key));
    parsed.hash = "";
    if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(parsed.hostname)) {
      const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      if (match) parsed.pathname = `/${match[1]}/status/${match[2]}`;
      parsed.search = "";
    }
    if (/(^|\.)instagram\.com$/.test(parsed.hostname)) {
      const match = parsed.pathname.match(/^\/(p|reel|tv)\/([^/]+)/);
      if (match) parsed.pathname = `/${match[1]}/${match[2]}/`;
      parsed.search = "";
    }
    if (/(^|\.)youtube\.com$/.test(parsed.hostname)) {
      if (parsed.pathname === "/watch") {
        const videoId = parsed.searchParams.get("v");
        parsed.search = videoId ? `?v=${videoId}` : "";
      } else {
        const match = parsed.pathname.match(/^\/shorts\/([^/]+)/);
        if (match) parsed.pathname = `/shorts/${match[1]}`;
        parsed.search = "";
      }
    }
    if (parsed.hostname === "youtu.be") {
      const videoId = parsed.pathname.split("/").filter(Boolean)[0];
      if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

const CLASSIFICATION_RULES = [
  {
    id: "prompts",
    reason: "内容中出现 Prompt / 提示词相关表达",
    weight: 8,
    pattern: /\bprompt(?:ing|s)?\b|提示词|提示语|系统指令|咒语/gi
  },
  {
    id: "web-coding",
    reason: "内容与网页、编程或开源项目有关",
    weight: 5,
    pattern: /vibe[ -]?coding|web\s?(?:site|app|design)|front[ -]?end|github|open source|html|css|javascript|typescript|react|next\.?js|代码|编程|前端|网页开发|开源项目|浏览器插件/gi
  },
  {
    id: "ai-products",
    reason: "内容在介绍或测评 AI 产品",
    weight: 6,
    pattern: /\bai\b|artificial intelligence|人工智能|大模型|智能体|\bagent\b|ai工具|ai产品|模型发布|新工具|产品发布|上线|测评|体验|chatgpt|claude|midjourney|runway|comfyui/gi
  },
  {
    id: "visual-reference",
    reason: "内容以设计、影像或视觉参考为主",
    weight: 4,
    pattern: /design|visual|motion|animation|cinematic|transition|after effects|\bae\b|blender|\b3d\b|摄影|设计|视觉|剪辑|视频|动效|转场|构图|配色|排版|海报|字体|插画|包装|品牌视觉/gi
  },
  {
    id: "actionable-ideas",
    reason: "内容包含可实践的方法、玩法或创意",
    weight: 3,
    pattern: /workflow|how to|tutorial|step by step|experiment|project idea|工作流|教程|步骤|方法|实现|复刻|玩法|可以做|落地|创意|灵感|项目想法/gi
  },
  {
    id: "reading",
    reason: "内容更适合作为文章或观点阅读",
    weight: 3,
    pattern: /article|thread|newsletter|research|paper|interview|essay|report|文章|长文|阅读|观点|分析|研究|论文|报告|访谈|书摘|知识/gi
  }
];

function classifyLink(raw = {}) {
  const text = [raw.title, raw.description, raw.note, raw.url, raw.author].filter(Boolean).join(" ");
  const scores = Object.fromEntries(CLASSIFICATION_RULES.map(rule => [rule.id, 0]));
  const reasons = {};

  for (const rule of CLASSIFICATION_RULES) {
    const matches = text.match(rule.pattern) || [];
    if (matches.length) {
      scores[rule.id] += Math.min(matches.length, 3) * rule.weight;
      reasons[rule.id] = rule.reason;
    }
  }

  if (raw.mediaType === "video") {
    scores["visual-reference"] += 2;
    reasons["visual-reference"] = "这是一条视频内容，并带有视觉参考特征";
  } else if (raw.mediaType === "image") {
    scores["visual-reference"] += 2;
    reasons["visual-reference"] ||= "这是一条以图片为主的内容";
  }
  if ((raw.description || "").length > 360) {
    scores.reading += 3;
    reasons.reading ||= "正文较长，更适合稍后阅读";
  }

  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (!winner || winner[1] === 0) {
    return {
      categoryId: raw.mediaType ? "visual-reference" : "reading",
      reason: raw.mediaType ? "这是一条图片或视频内容" : "没有明显关键词，先归入待读内容",
      score: 0
    };
  }
  return { categoryId: winner[0], reason: reasons[winner[0]], score: winner[1] };
}

function isSafeWebUrl(url = "") {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function isSafeImageUrl(url = "") {
  if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(url)) return true;
  return isSafeWebUrl(url);
}

async function stabilizeCover(raw = {}) {
  if (raw.platform !== "Instagram" || !isSafeWebUrl(raw.cover)) return raw;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "HY_CACHE_INSTAGRAM_COVER",
      url: raw.cover
    });
    if (response?.ok && response.dataUrl) {
      return { ...raw, cover: response.dataUrl };
    }
  } catch {}
  return raw;
}

function createCategory(name, categories) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "") || "category";
  let id = base;
  let index = 2;
  while (categories.some(category => category.id === id)) id = `${base}-${index++}`;
  return {
    id,
    name: String(name).trim(),
    color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]
  };
}

async function saveLink(raw) {
  raw = await stabilizeCover(raw);
  const { categories, items } = await ensureState();
  if (!isSafeWebUrl(raw.url)) throw new Error("请输入以 http:// 或 https:// 开头的网页链接");
  const classification = classifyLink(raw);
  const requestedCategory = raw.categoryId || classification.categoryId;
  const categoryId = categories.some(category => category.id === requestedCategory)
    ? requestedCategory
    : (categories.find(category => category.id === "inbox")?.id || categories[0]?.id);
  if (!categoryId) throw new Error("请先创建一个分类");

  const normalized = normalizeUrl(raw.url);
  const existingIndex = items.findIndex(item => normalizeUrl(item.url) === normalized);
  const existing = existingIndex >= 0 ? items[existingIndex] : null;
  const link = {
    id: existing?.id || crypto.randomUUID(),
    url: raw.url.trim(),
    title: raw.title?.trim() || existing?.title || raw.url.trim(),
    note: raw.note?.trim() || existing?.note || "",
    author: raw.author?.trim() || existing?.author || "",
    description: raw.description?.trim() || existing?.description || "",
    cover: raw.cover?.trim() || existing?.cover || "",
    platform: raw.platform?.trim() || existing?.platform || "",
    mediaType: raw.mediaType?.trim() || existing?.mediaType || "",
    categoryId,
    classificationReason: raw.categoryId
      ? "由你手动选择"
      : classification.reason,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const nextItems = existingIndex >= 0
    ? items.map((item, index) => index === existingIndex ? link : item)
    : [link, ...items];
  await storageSet({ items: nextItems });
  return { link, duplicate: existingIndex >= 0, items: nextItems, classification };
}

globalThis.HYCore = {
  DEFAULT_CATEGORIES,
  CATEGORY_COLORS,
  ensureState,
  storageGet,
  storageSet,
  normalizeUrl,
  isSafeWebUrl,
  isSafeImageUrl,
  stabilizeCover,
  classifyLink,
  createCategory,
  saveLink
};
