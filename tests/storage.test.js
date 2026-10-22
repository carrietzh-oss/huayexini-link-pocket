const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

function setup(initial = {}) {
  const data = structuredClone(initial);
  let listener;
  let writes = 0;
  const chrome = {
    storage: { local: {
      get: async () => structuredClone(data),
      set: async value => { writes++; Object.assign(data, structuredClone(value)); }
    } },
    runtime: { onMessage: { addListener: callback => { listener = callback; } } }
  };
  const context = vm.createContext({ chrome, URL, crypto: webcrypto, Date, Blob, Uint8Array, btoa, AbortSignal, setTimeout });
  context.importScripts = name => vm.runInContext(fs.readFileSync(name, "utf8"), context);
  context.fetch = async () => { throw new Error("Image unavailable"); };
  vm.runInContext(fs.readFileSync("background.js", "utf8"), context);
  async function send(message) {
    return new Promise(resolve => listener(message, {}, resolve));
  }
  return { core: context.HYCore, context, data, send, get writes() { return writes; } };
}

test("legacy state reads do not overwrite items and custom categories survive", async () => {
  const old = { categories: [{ id: "edit", name: "剪辑", color: "#fff" }], items: [{ id: "1", url: "https://x.com/a/status/1", title: "剪辑" }] };
  const app = setup(old);
  const state = await app.core.ensureState();
  assert.equal(app.writes, 0);
  assert.equal(state.categories[0].keywords.length, 0);
  assert.equal(state.items[0].title, "剪辑");
});

test("concurrent saves keep both links and custom classification", async () => {
  const app = setup({ categories: [...setup().core.DEFAULT_CATEGORIES, { id: "edit", name: "剪辑", color: "#fff", keywords: ["转场"] }], items: [] });
  const results = await Promise.all([
    app.send({ type: "HY_SAVE_LINK", raw: { url: "https://x.com/a/status/1", title: "剪辑教学" } }),
    app.send({ type: "HY_SAVE_LINK", raw: { url: "https://x.com/a/status/2", title: "转场教学" } })
  ]);
  assert.ok(results.every(result => result.ok));
  assert.equal(app.data.items.length, 2);
  assert.ok(app.data.items.every(item => item.categoryId === "edit"));
});

test("import merges old links and categories without removing newer bookmarks", async () => {
  const app = setup({ categories: setup().core.DEFAULT_CATEGORIES, items: [{ id: "new", url: "https://x.com/a/status/2", title: "新收藏" }] });
  const backup = {
    format: "huayexini-link-pocket",
    categories: [{ id: "edit", name: "剪辑", keywords: ["转场"] }],
    items: [
      { url: "https://x.com/a/status/1", title: "旧收藏", categoryId: "edit" },
      { url: "https://x.com/a/status/2", title: "重复", categoryId: "edit" }
    ]
  };
  const result = await app.send({ type: "HY_IMPORT_BACKUP", backup });
  assert.equal(result.result.imported, 1);
  assert.equal(app.data.items.length, 2);
  assert.equal(app.data.items.find(item => item.id === "new").title, "新收藏");
  assert.equal(app.data.items.find(item => item.title === "旧收藏").categoryId, app.data.categories.find(item => item.name === "剪辑").id);
});

test("YouTube, Instagram and X thumbnails are stored as local image data", async () => {
  const app = setup({ categories: setup().core.DEFAULT_CATEGORIES, items: [] });
  app.context.fetch = async () => ({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) });
  app.context.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  app.context.OffscreenCanvas = class {
    getContext() { return { drawImage() {} }; }
    async convertToBlob() { return new Blob(["thumbnail"], { type: "image/webp" }); }
  };
  for (const [url, cover] of [
    ["https://youtube.com/watch?v=123", "https://i.ytimg.com/vi/123/hqdefault.jpg"],
    ["https://instagram.com/p/test/", "https://scontent.cdninstagram.com/a.jpg"],
    ["https://x.com/a/status/123", "https://pbs.twimg.com/media/a.jpg"],
    ["https://instagram.com/p/other/", "https://lookaside.fbsbx.com/image.jpg"],
    ["https://youtube.com/watch?v=456", "https://i2.ytimg.com/vi/456/hqdefault.jpg"]
  ]) {
    const result = await app.send({ type: "HY_SAVE_LINK", raw: { url, cover } });
    assert.ok(result.ok);
    assert.match(result.result.link.cover, /^data:image\/webp;base64,/);
  }
});

test("a failed later cover fetch does not replace an existing local thumbnail", async () => {
  const app = setup({ categories: setup().core.DEFAULT_CATEGORIES, items: [] });
  const url = "https://x.com/a/status/88";
  const original = await app.send({ type: "HY_SAVE_LINK", raw: { url, cover: "data:image/webp;base64,dGVzdA==" } });
  assert.ok(original.ok);
  const repeat = await app.send({ type: "HY_SAVE_LINK", raw: { url, cover: "https://pbs.twimg.com/media/expired.jpg" } });
  assert.equal(repeat.result.link.cover, "data:image/webp;base64,dGVzdA==");
});

test("Instagram image failures report a reason while keeping the saved link", async () => {
  const app = setup({ categories: setup().core.DEFAULT_CATEGORIES, items: [] });
  app.context.fetch = async () => ({ ok: false, status: 403 });
  const result = await app.send({ type: "HY_SAVE_LINK", raw: {
    url: "https://instagram.com/p/test/", platform: "Instagram", cover: "https://lookaside.fbsbx.com/image.jpg"
  } });
  assert.equal(result.ok, true);
  assert.match(result.result.coverError, /403/);
  assert.equal(app.data.items.length, 1);
});

test("a missing Instagram cover reports extraction failure", async () => {
  const app = setup({ categories: setup().core.DEFAULT_CATEGORIES, items: [] });
  const result = await app.send({ type: "HY_SAVE_LINK", raw: {
    url: "https://instagram.com/p/test/", platform: "Instagram", cover: ""
  } });
  assert.match(result.result.coverError, /没有提取到/);
});
