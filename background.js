importScripts("core.js");

function imageHost(url = "") {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    const host = parsed.hostname;
    return ["cdninstagram.com", "fbcdn.net", "fbsbx.com", "twimg.com", "ytimg.com", "ggpht.com"]
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

  let response;
  for (const credentials of ["include", "omit"]) {
    try {
      response = await fetch(url, { credentials, cache: "no-store", signal: AbortSignal.timeout(12000) });
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
    const maxSide = 320;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.62 });
  } catch {
    if (blob.size > 1000000) throw new Error("图片无法压缩且超过 1 MB");
  }

  if (blob.size > 1000000) throw new Error("图片超过 1 MB，无法保存缩略图");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || "image/webp"};base64,${bytesToBase64(bytes)}`;
}

let saveQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      if (!item || !imageHost(item.cover)) throw new Error("没有可重试的封面地址，请打开原内容重新保存");
      const cover = await toCompactImageDataUrl(item.cover);
      item.cover = cover;
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
      if (raw.cover && !raw.cover.startsWith("data:image/")) {
        try { raw = { ...raw, cover: await toCompactImageDataUrl(raw.cover) }; }
        catch (error) { coverError = error.message; }
      } else if (!raw.cover && ["Instagram", "X", "YouTube"].includes(raw.platform)) {
        coverError = "页面中没有提取到这条内容的封面";
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
