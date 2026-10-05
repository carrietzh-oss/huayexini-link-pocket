let state = { categories: [], items: [] };
let captured = {};
let categoryChanged = false;

function fillCategorySelect(selectedId) {
  const select = document.querySelector("#category");
  select.replaceChildren(...state.categories.map(category => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    return option;
  }));
  if (selectedId && state.categories.some(category => category.id === selectedId)) select.value = selectedId;
}

function showTip(message) {
  const tip = document.querySelector("#tip");
  tip.textContent = message;
  tip.hidden = !message;
}

function isSocialUrl(url = "") {
  try { return /(^|\.)(x|twitter|instagram|youtube)\.com$/.test(new URL(url).hostname); } catch { return false; }
}

function isPostUrl(url = "") {
  return /\/(status\/\d+|p\/[^/?#]+|reel\/[^/?#]+|tv\/[^/?#]+|watch\?v=|shorts\/[^/?#]+)/i.test(url);
}

function setCaptured(data, { showClassification = true } = {}) {
  captured = { ...captured, ...data };
  document.querySelector("#title").value = captured.title || "";
  document.querySelector("#url").value = captured.url || "";
  const classification = HYCore.classifyLink(captured);
  if (!categoryChanged) fillCategorySelect(classification.categoryId);
  if (showClassification) {
    const name = state.categories.find(category => category.id === classification.categoryId)?.name || "待整理";
    showTip(`已根据页面内容推荐到「${name}」。如果不准确，可以直接换一个分类。`);
  }
  document.querySelector("#save").disabled = !captured.url;
}

async function getPostFromPage(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "HY_GET_CURRENT_POST" });
    return response?.ok ? response.post : null;
  } catch {
    return null;
  }
}

async function init() {
  state = await HYCore.ensureState();
  fillCategorySelect("reading");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = /^https?:/i.test(tab?.url || "") ? tab.url : "";

  if (tab?.id && isSocialUrl(url)) {
    const post = await getPostFromPage(tab.id);
    if (post) {
      setCaptured(post);
      return;
    }
    if (!isPostUrl(url)) {
      setCaptured({ title: "", url: "" }, { showClassification: false });
      showTip("你现在位于信息流。回到页面，把鼠标移到想保存的那条博文或视频上，点击右上角出现的紫色＋，插件就会保存那一条，而不是整个首页。首次升级后请刷新 X、Instagram 或 YouTube 页面。");
      return;
    }
  }

  setCaptured({ title: tab?.title || "", url, platform: isSocialUrl(url) ? "社交媒体" : "网页" });
}

document.querySelector("#category").addEventListener("change", () => { categoryChanged = true; });

document.querySelector("#quick-category").addEventListener("click", async () => {
  const name = window.prompt("新分类叫什么？")?.trim();
  if (!name) return;
  if (state.categories.some(category => category.name === name)) {
    document.querySelector("#category").value = state.categories.find(category => category.name === name).id;
    categoryChanged = true;
    return;
  }
  const category = HYCore.createCategory(name, state.categories);
  state.categories.push(category);
  await HYCore.storageSet({ categories: state.categories });
  fillCategorySelect(category.id);
  categoryChanged = true;
});

document.querySelector("#title").addEventListener("input", event => {
  captured.title = event.target.value;
  if (!categoryChanged) fillCategorySelect(HYCore.classifyLink(captured).categoryId);
});

document.querySelector("#url").addEventListener("input", event => {
  captured.url = event.target.value.trim();
  document.querySelector("#save").disabled = !captured.url;
  if (!categoryChanged) fillCategorySelect(HYCore.classifyLink(captured).categoryId);
});

document.querySelector("#save").addEventListener("click", async () => {
  const button = document.querySelector("#save");
  const status = document.querySelector("#status");
  button.disabled = true;
  try {
    const result = await HYCore.saveLink({
      ...captured,
      title: document.querySelector("#title").value,
      url: document.querySelector("#url").value,
      note: document.querySelector("#note").value,
      categoryId: document.querySelector("#category").value
    });
    status.textContent = result.duplicate ? "这个链接已经存过，已更新内容" : "保存好了 ✓";
    button.textContent = result.duplicate ? "已更新" : "已保存";
    setTimeout(() => window.close(), 900);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});

document.querySelector("#dashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

init();
