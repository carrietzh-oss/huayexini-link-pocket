let state = { categories: [], items: [] };
let currentCategory = "all";
let draggedItemId = null;
let linkCategoryChanged = false;

const $ = selector => document.querySelector(selector);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function fillSelect(select, selectedId = "inbox") {
  select.replaceChildren(...state.categories.map(category => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    return option;
  }));
  if (state.categories.some(category => category.id === selectedId)) select.value = selectedId;
}

async function load() {
  state = await HYCore.ensureState();
  render();
}

function render() {
  renderCategories();
  renderCards();
  const uncategorized = state.items.filter(item => item.categoryId === "inbox").length;
  $("#stats").innerHTML = `<span class="stat">共 ${state.items.length} 个链接</span><span class="stat">待整理 ${uncategorized} 个</span><span class="stat">${state.categories.length - 1} 个正式分类</span>`;
}

function renderCategories() {
  const all = { id: "all", name: "全部链接", color: "#2f2938" };
  $("#categories").innerHTML = [all, ...state.categories].map(category => {
    const count = category.id === "all" ? state.items.length : state.items.filter(item => item.categoryId === category.id).length;
    return `<button class="nav-item ${currentCategory === category.id ? "active" : ""}" data-category="${escapeHtml(category.id)}">
      <span class="nav-dot" style="background:${category.color}"></span><span>${escapeHtml(category.name)}</span><span class="count">${count}</span>
    </button>`;
  }).join("");

  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => { currentCategory = button.dataset.category; render(); });
    button.addEventListener("dragover", event => {
      if (button.dataset.category !== "all") {
        event.preventDefault();
        button.classList.add("drag-over");
      }
    });
    button.addEventListener("dragleave", () => button.classList.remove("drag-over"));
    button.addEventListener("drop", async event => {
      event.preventDefault();
      button.classList.remove("drag-over");
      if (!draggedItemId || button.dataset.category === "all") return;
      const response = await chrome.runtime.sendMessage({ type: "HY_MOVE_LINK", id: draggedItemId, categoryId: button.dataset.category });
      if (!response?.ok) return showToast(response?.error || "移动失败");
      state = await HYCore.ensureState();
      showToast("已经移到新分类");
      render();
    });
  });
}

function renderCards() {
  const query = $("#search").value.trim().toLowerCase();
  const visible = state.items.filter(item => {
    const inCategory = currentCategory === "all" || item.categoryId === currentCategory;
    const haystack = [item.title, item.note, item.description, item.author, item.platform, item.url].join(" ").toLowerCase();
    return inCategory && (!query || haystack.includes(query));
  });
  $("#view-title").textContent = currentCategory === "all"
    ? "全部链接"
    : state.categories.find(category => category.id === currentCategory)?.name || "全部链接";
  $("#empty").hidden = visible.length > 0;
  $("#cards").innerHTML = visible.map(item => {
    const category = state.categories.find(entry => entry.id === item.categoryId) || state.categories[0];
    let source = "网页";
    try { source = new URL(item.url).hostname.replace(/^www\./, ""); } catch {}
    const hasCover = item.cover && HYCore.isSafeImageUrl(item.cover);
    const platform = item.platform || source;
    const description = item.description || item.note || "没有提取到正文，点击可返回原页面查看。";
    const cover = hasCover
      ? `<div class="card-cover"><img src="${escapeHtml(item.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer"><div class="cover-fallback">${escapeHtml(platform.slice(0, 1).toUpperCase())}</div></div>`
      : `<div class="card-cover no-image"><div class="cover-fallback">${escapeHtml(platform.slice(0, 1).toUpperCase())}</div></div>`;
    return `<article class="card" draggable="true" data-id="${item.id}">
      ${cover}
      <div class="card-top"><span class="pill" style="background:${category.color}33;color:#403849">${escapeHtml(category.name)}</span><span class="date">${new Date(item.createdAt).toLocaleDateString("zh-CN")}</span></div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="card-copy">${escapeHtml(description)}</p>
      ${item.note && item.description ? `<p class="card-note">我的备注：${escapeHtml(item.note)}</p>` : ""}
      <div class="source">${escapeHtml(item.author ? `${item.author} · ${platform}` : platform)} · ${escapeHtml(source)}</div>
      <div class="card-actions"><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">打开原页面 ↗</a>${item.coverSource || (hasCover && !item.cover.startsWith("data:")) || item.platform === "YouTube" ? `<button data-refresh-cover="${item.id}">重试封面</button>` : ""}<button data-delete="${item.id}">删除</button></div>
    </article>`;
  }).join("");

  document.querySelectorAll(".card").forEach(card => {
    card.addEventListener("dragstart", () => { draggedItemId = card.dataset.id; card.classList.add("dragging"); });
    card.addEventListener("dragend", () => { draggedItemId = null; card.classList.remove("dragging"); });
  });
  document.querySelectorAll(".card-cover img").forEach(image => image.addEventListener("error", () => {
    image.closest(".card-cover")?.classList.add("no-image");
    image.remove();
  }));
  document.querySelectorAll("[data-refresh-cover]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "HY_REFRESH_COVER", id: button.dataset.refreshCover });
      if (!response?.ok) throw new Error(response?.error || "封面获取失败");
      state.items = state.items.map(item => item.id === response.result.id ? response.result : item);
      render();
      showToast("封面已保存到本地");
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  }));
  document.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "HY_DELETE_LINK", id: button.dataset.delete });
    if (!response?.ok) return showToast(response?.error || "删除失败");
    state = await HYCore.ensureState();
    render();
    showToast("已删除");
  }));
}

function renderCategoryManager() {
  $("#category-manager").innerHTML = state.categories.map((category, index) => `
    <div class="manager-row" data-manager-id="${escapeHtml(category.id)}">
      <span class="nav-dot" style="background:${category.color}"></span>
      <span>${escapeHtml(category.name)}${category.keywords?.length ? " · " + escapeHtml(category.keywords.join("、")) : ""}</span>
      <span class="manager-actions">
        <button type="button" data-move="up" ${index === 0 ? "disabled" : ""} title="上移">↑</button>
        <button type="button" data-move="down" ${index === state.categories.length - 1 ? "disabled" : ""} title="下移">↓</button>
        <button type="button" data-rename title="改名">✎</button>
        <button type="button" data-keywords title="编辑自动匹配词">词</button>
        <button type="button" data-remove ${category.id === "inbox" ? "disabled" : ""} title="删除">×</button>
      </span>
    </div>`).join("");

  document.querySelectorAll("[data-manager-id]").forEach(row => {
    const id = row.dataset.managerId;
    row.querySelector("[data-rename]").addEventListener("click", async () => {
      const category = state.categories.find(entry => entry.id === id);
      const name = window.prompt("新的分类名称", category.name)?.trim();
      if (!name || state.categories.some(entry => entry.id !== id && entry.name === name)) return;
      category.name = name;
      await HYCore.storageSet({ categories: state.categories });
      renderCategoryManager();
      render();
    });
    row.querySelector("[data-keywords]").addEventListener("click", async () => {
      const category = state.categories.find(entry => entry.id === id);
      const value = window.prompt("自动匹配词，用逗号分隔；留空可清除", (category.keywords || []).join("、"));
      if (value === null) return;
      category.keywords = HYCore.categoryKeywords(value);
      await HYCore.storageSet({ categories: state.categories });
      renderCategoryManager();
      showToast("自动匹配词已更新");
    });
    row.querySelector("[data-remove]").addEventListener("click", async () => {
      const category = state.categories.find(entry => entry.id === id);
      if (!window.confirm(`删除“${category.name}”？其中的链接会移到“待整理”。`)) return;
      const response = await chrome.runtime.sendMessage({ type: "HY_REMOVE_CATEGORY", id });
      if (!response?.ok) return showToast(response?.error || "删除分类失败");
      if (currentCategory === id) currentCategory = "all";
      state = await HYCore.ensureState();
      renderCategoryManager();
      render();
    });
    row.querySelectorAll("[data-move]").forEach(button => button.addEventListener("click", async () => {
      const index = state.categories.findIndex(entry => entry.id === id);
      const next = button.dataset.move === "up" ? index - 1 : index + 1;
      if (next < 0 || next >= state.categories.length) return;
      [state.categories[index], state.categories[next]] = [state.categories[next], state.categories[index]];
      await HYCore.storageSet({ categories: state.categories });
      renderCategoryManager();
      render();
    }));
  });
}

$("#search").addEventListener("input", renderCards);
$("#export-backup").addEventListener("click", async () => {
  const snapshot = await HYCore.ensureState();
  const backup = { format: "huayexini-link-pocket", version: 1, exportedAt: new Date().toISOString(), ...snapshot };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `花野链接夹-备份-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  showToast(`已导出 ${snapshot.items.length} 条链接`);
});
$("#import-backup").addEventListener("click", () => $("#backup-file").click());
$("#backup-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error("备份文件超过 100 MB");
    const backup = JSON.parse(await file.text());
    const response = await chrome.runtime.sendMessage({ type: "HY_IMPORT_BACKUP", backup });
    if (!response?.ok) throw new Error(response?.error || "导入失败");
    state = await HYCore.ensureState();
    render();
    showToast(`导入 ${response.result.imported} 条，现有 ${response.result.total} 条`);
  } catch (error) {
    showToast(error.message || "备份文件无法读取");
  }
  event.target.value = "";
});
$("#add-link").addEventListener("click", () => {
  linkCategoryChanged = currentCategory !== "all";
  fillSelect($("#link-category"), currentCategory === "all" ? "reading" : currentCategory);
  $("#link-dialog").showModal();
});
$("#link-category").addEventListener("change", () => { linkCategoryChanged = true; });
["#link-title", "#link-url", "#link-note"].forEach(selector => $(selector).addEventListener("input", () => {
  if (linkCategoryChanged) return;
  const categoryId = HYCore.classifyLink({
    title: $("#link-title").value,
    url: $("#link-url").value,
    note: $("#link-note").value
  }, state.categories).categoryId;
  fillSelect($("#link-category"), categoryId);
}));
$("#add-category").addEventListener("click", () => $("#category-dialog").showModal());
$("#manage-categories").addEventListener("click", () => {
  renderCategoryManager();
  $("#manage-dialog").showModal();
});
$("#category-form").addEventListener("submit", async event => {
  event.preventDefault();
  const name = $("#category-name").value.trim();
  if (!name) return;
  if (state.categories.some(category => category.name === name)) return showToast("已经有同名分类了");
  state.categories.push(HYCore.createCategory(name, state.categories, $("#category-keywords").value));
  await HYCore.storageSet({ categories: state.categories });
  event.target.reset();
  $("#category-dialog").close();
  render();
  showToast("新分类已创建");
});
$("#link-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const result = await HYCore.requestSaveLink({
      title: $("#link-title").value,
      url: $("#link-url").value,
      note: $("#link-note").value,
      categoryId: $("#link-category").value
    });
    state = await HYCore.ensureState();
    event.target.reset();
    $("#link-dialog").close();
    render();
    showToast(result.coverError && !result.link.cover?.startsWith("data:image/")
      ? `链接已保存；封面：${result.coverError}`
      : result.duplicate ? "这个链接已存在，已更新" : "链接已保存");
  } catch (error) {
    showToast(error.message);
  }
});

load();
