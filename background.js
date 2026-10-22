importScripts("core.js");

function isAllowedImageHost(url = "") {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname;
    return host === "cdninstagram.com" ||
      host.endsWith(".cdninstagram.com") ||
      host === "fbcdn.net" ||
      host.endsWith(".fbcdn.net") ||
      host === "pbs.twimg.com" ||
      host === "video.twimg.com" ||
      host === "i.ytimg.com" ||
      host === "img.youtube.com";
  } catch {
    return false;
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
  if (!isAllowedImageHost(url)) throw new Error("Unsupported image host");

  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);

  let blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Not an image");

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
    if (blob.size > 120000) throw new Error("Image too large to cache");
  }

  if (blob.size > 120000) throw new Error("Cached image too large");
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
      if (!item || !isAllowedImageHost(item.cover)) throw new Error("没有可重试的封面地址，请打开原内容重新保存");
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
      if (isAllowedImageHost(raw.cover)) {
        try { raw = { ...raw, cover: await toCompactImageDataUrl(raw.cover) }; } catch {}
      }
      return HYCore.saveLink({ ...raw, skipCoverCache: true });
    });
    saveQueue = next.catch(() => {});
    next.then(({ link, duplicate, classification }) => sendResponse({ ok: true, result: { link, duplicate, classification } }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== "HY_CACHE_COVER") return;

  toCompactImageDataUrl(message.url)
    .then(dataUrl => sendResponse({ ok: true, dataUrl }))
    .catch(error => sendResponse({ ok: false, error: error.message }));

  return true;
});
