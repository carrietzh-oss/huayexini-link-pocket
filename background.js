function isAllowedInstagramCdn(url = "") {
  try {
    const host = new URL(url).hostname;
    return host === "cdninstagram.com" ||
      host.endsWith(".cdninstagram.com") ||
      host === "fbcdn.net" ||
      host.endsWith(".fbcdn.net");
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
  if (!isAllowedInstagramCdn(url)) throw new Error("Unsupported image host");

  const response = await fetch(url, {
    credentials: "omit",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);

  let blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Not an image");

  try {
    const bitmap = await createImageBitmap(blob);
    const maxSide = 520;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.72 });
  } catch {
    if (blob.size > 350000) throw new Error("Image too large to cache");
  }

  if (blob.size > 450000) throw new Error("Cached image too large");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || "image/webp"};base64,${bytesToBase64(bytes)}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "HY_CACHE_INSTAGRAM_COVER") return;

  toCompactImageDataUrl(message.url)
    .then(dataUrl => sendResponse({ ok: true, dataUrl }))
    .catch(error => sendResponse({ ok: false, error: error.message }));

  return true;
});
