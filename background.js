importScripts("core.js");

function imageHost(url = "") {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    const host = parsed.hostname;
    return host === "img.youtube.com" || ["cdninstagram.com", "fbcdn.net", "fbsbx.com", "twimg.com", "ytimg.com", "ggpht.com"]
      .some(domain => host === domain || host.endsWith(`.${domain}`)) ? host : "";
  } catch {
    return "";
  }
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function toCompactImageDataUrl(url) {
  if (!imageHost(url)) throw new Error("图片地址不属于已支持的平台图片域名");
  if (chrome.permissions?.contains && !await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] })) {
    throw new Error(`扩展未获图片访问权限：${new URL(url).hostname}`);
  }

  let response;
  for (const credentials of ["include", "omit"]) {
    try {
      response = await fetch(url, { credentials, cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (response.ok) break;
    } catch (error) {
      if (credentials === "omit") throw new Error(error.name === "TimeoutError" ? "图片下载超时" : "图片服务器拒绝扩展下载");
    }
  }
  if (!response?.ok) throw new Error(`图片服务器返回 ${response?.status || "错误"}`);

  let blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("图片地址返回了非图片内容");

  try {
    const bitmap = await createImageBitmap(blob);
    if (Math.min(bitmap.width, bitmap.height) < 320) {
      bitmap.close?.();
      throw new Error("图片尺寸太小，继续尝试其他封面");
    }
    const maxSide = 960;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
  } catch (error) {
    if (error.message === "图片尺寸太小，继续尝试其他封面") throw error;
    if (blob.size > 2500000) throw new Error("图片无法压缩且超过 2.5 MB");
  }

  if (blob.size > 2500000) throw new Error("图片超过 2.5 MB，无法保存缩略图");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || "image/webp"};base64,${bytesToBase64(bytes)}`;
}

function coverCandidates(raw) {
  const urls = [];
  let videoId = "";
  if (raw.platform === "YouTube") {
    try {
      const parsed = new URL(raw.url);
      if (/(^|\.)youtube\.com$/.test(parsed.hostname)) {
        const id = parsed.searchParams.get("v") || parsed.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
        if (/^[A-Za-z0-9_-]{11}$/.test(id || "")) {
          videoId = id;
          urls.push(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
            `https://i.ytimg.com/vi/${id}/sddefault.jpg`);
        }
      }
    } catch {}
  }
  urls.push(raw.coverSource, raw.cover, ...(Array.isArray(raw.coverCandidates) ? raw.coverCandidates : []));
  if (videoId) {
    urls.push(`https://i.ytimg.com/vi_webp/${videoId}/hqdefault.webp`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
  }
  return [...new Set(urls.filter(url => typeof url === "string" && imageHost(url)))].slice(0, 8);
}

async function cacheFirstCover(raw) {
  const errors = new Set();
  for (const url of coverCandidates(raw)) {
    try { return { dataUrl: await toCompactImageDataUrl(url), source: url }; }
    catch (error) { errors.add(error.message); }
  }
  throw new Error([...errors].slice(0, 3).join("；") || "页面中没有提取到这条内容的封面");
}

let saveQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (["HY_MOVE_LINK", "HY_DELETE_LINK", "HY_REMOVE_CATEGORY"].includes(message?.type)) {
    const next = saveQueue.then(async () => {
      const { categories, items } = await HYCore.ensureState();
      if (message.type === "HY_MOVE_LINK") {
        if (!categories.some(category => category.id === message.categoryId)) throw new Error("分类不存在");
        const item = items.find(entry => entry.id === message.id);
        if (!item) throw new Error("链接不存在");
        item.categoryId = message.categoryId;
        item.updatedAt = new Date().toISOString();
        await HYCore.storageSet({ items });
      } else if (message.type === "HY_DELETE_LINK") {
        await HYCore.storageSet({ items: items.filter(item => item.id !== message.id) });
      } else {
        if (message.id === "inbox" || !categories.some(category => category.id === message.id)) throw new Error("分类不存在");
        await HYCore.storageSet({ categories: categories.filter(category => category.id !== message.id),
          items: items.map(item => item.categoryId === message.id ? { ...item, categoryId: "inbox" } : item) });
      }
      return true;
    });
    saveQueue = next.catch(() => {});
    next.then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "HY_IMPORT_BACKUP") {
    const next = saveQueue.then(async () => {
      const merged = HYCore.mergeBackup(await HYCore.ensureState(), message.backup);
      await HYCore.storageSet({ categories: merged.categories, items: merged.items });
      return { imported: merged.imported, total: merged.items.length };
    });
    saveQueue = next.catch(() => {});
    next.then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "HY_REFRESH_COVER") {
    const next = saveQueue.then(async () => {
      const { items } = await HYCore.ensureState();
      const item = items.find(entry => entry.id === message.id);
      if (!item || !coverCandidates(item).length) throw new Error("没有可重试的封面地址，请打开原内容重新保存");
      const cover = await cacheFirstCover(item);
      item.cover = cover.dataUrl;
      item.coverSource = cover.source;
      await HYCore.storageSet({ items });
      return item;
    });
    saveQueue = next.catch(() => {});
    next.then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "HY_SAVE_LINK") {
    const next = saveQueue.then(async () => {
      let raw = message.raw;
      let coverError = "";
      if (!raw.cover?.startsWith("data:image/") && coverCandidates(raw).length) {
        try {
          const cover = await cacheFirstCover(raw);
          raw = { ...raw, cover: cover.dataUrl, coverSource: cover.source };
        }
        catch (error) { coverError = error.message; }
      } else if (!raw.cover?.startsWith("data:image/") && ["Instagram", "X", "YouTube"].includes(raw.platform)) {
        let host = "";
        try { host = new URL(raw.cover).hostname; } catch {}
        coverError = raw.cover ? `图片域名不受支持${host ? `：${host}` : ""}` : "页面中没有提取到这条内容的封面";
      }
      const result = await HYCore.saveLink({ ...raw, skipCoverCache: true });
      return { ...result, coverError };
    });
    saveQueue = next.catch(() => {});
    next.then(({ link, duplicate, classification, coverError }) => sendResponse({ ok: true, result: { link, duplicate, classification, coverError } }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== "HY_CACHE_COVER") return;

  toCompactImageDataUrl(message.url)
    .then(dataUrl => sendResponse({ ok: true, dataUrl }))
    .catch(error => sendResponse({ ok: false, error: error.message }));

  return true;
});
