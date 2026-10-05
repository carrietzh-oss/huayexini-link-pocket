(() => {
  const isInstagram = /(^|\.)instagram\.com$/.test(location.hostname);
  const isX = /(^|\.)(x|twitter)\.com$/.test(location.hostname);
  const isYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
  if (!isInstagram && !isX && !isYouTube) return;

  function cleanText(value = "") {
    return value.replace(/\s+/g, " ").trim();
  }

  function absoluteUrl(href = "") {
    try { return new URL(href, location.origin).href; } catch { return ""; }
  }

  function makeTitle(text, author, platform) {
    const clean = cleanText(text);
    if (clean) return clean.length > 72 ? `${clean.slice(0, 72)}…` : clean;
    return author ? `${author} 的 ${platform} 博文` : `${platform} 博文`;
  }

  function findXPermalink(container) {
    const timeLink = container.querySelector("time")?.closest('a[href*="/status/"]');
    const link = timeLink || [...container.querySelectorAll('a[href*="/status/"]')]
      .find(anchor => /\/status\/\d+/.test(anchor.getAttribute("href") || ""));
    return absoluteUrl(link?.getAttribute("href") || "");
  }

  function findInstagramPermalink(container) {
    const ownLink = container.matches?.('a[href^="/p/"],a[href^="/reel/"],a[href^="/tv/"]') ? container : null;
    const link = ownLink || container.querySelector('a[href^="/p/"],a[href^="/reel/"],a[href^="/tv/"]');
    return absoluteUrl(link?.getAttribute("href") || "");
  }

  function findYouTubePermalink(container) {
    if (container.id === "above-the-fold" && /\/(watch|shorts)/.test(location.pathname)) return location.href;
    const ownLink = container.matches?.('a[href^="/watch"],a[href^="/shorts/"]') ? container : null;
    const link = ownLink || container.querySelector('a#thumbnail[href^="/watch"],a[href^="/shorts/"],a#video-title[href^="/watch"]');
    return absoluteUrl(link?.getAttribute("href") || "");
  }

  function extractX(container) {
    const description = cleanText(container.querySelector('[data-testid="tweetText"]')?.innerText || "");
    const authorBlock = cleanText(container.querySelector('[data-testid="User-Name"]')?.innerText || "");
    const author = authorBlock.split("·")[0].trim();
    const video = container.querySelector("video");
    const image = container.querySelector('[data-testid="tweetPhoto"] img[src], img[src*="pbs.twimg.com/media"]');
    const cover = video?.poster || image?.currentSrc || image?.src || "";
    const mediaType = video ? "video" : image ? "image" : "";
    return {
      url: findXPermalink(container),
      title: makeTitle(description, author, "X"),
      description,
      author,
      cover,
      mediaType,
      platform: "X"
    };
  }

  function extractInstagram(container) {
    const video = container.querySelector("video");
    const images = [...container.querySelectorAll("img[src]")]
      .filter(image => !/profile|avatar/i.test(image.alt || ""));
    const image = images.sort((a, b) => (b.naturalWidth || b.width) - (a.naturalWidth || a.width))[0];
    const rawText = cleanText(container.querySelector("h1")?.innerText || container.innerText || image?.alt || "");
    const description = rawText.slice(0, 900);
    const profileLink = [...container.querySelectorAll("a[href]")].find(anchor => {
      const href = anchor.getAttribute("href") || "";
      return /^\/[A-Za-z0-9._]+\/?$/.test(href) && cleanText(anchor.innerText);
    });
    const author = cleanText(profileLink?.innerText || "").split(" ")[0];
    const cover = video?.poster || image?.currentSrc || image?.src || "";
    const mediaType = video ? "video" : image ? "image" : "";
    return {
      url: findInstagramPermalink(container),
      title: makeTitle(description, author, "Instagram"),
      description,
      author,
      cover,
      mediaType,
      platform: "Instagram"
    };
  }

  function extractYouTube(container) {
    const url = findYouTubePermalink(container);
    const title = cleanText(
      container.querySelector("#video-title")?.textContent ||
      container.querySelector("h1 yt-formatted-string, h1")?.textContent ||
      ""
    );
    const author = cleanText(
      container.querySelector("ytd-channel-name #text, #channel-name #text, .ytd-channel-name")?.textContent || ""
    );
    const descriptionText = cleanText(
      container.querySelector("#description-inner, #description")?.innerText || ""
    );
    const image = container.querySelector("a#thumbnail img, yt-image img, img");
    let cover = image?.currentSrc || image?.src || image?.getAttribute("data-thumb") || "";
    if (!cover) {
      try {
        const parsed = new URL(url);
        const videoId = parsed.searchParams.get("v") || parsed.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
        if (videoId) cover = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      } catch {}
    }
    return {
      url,
      title: title || makeTitle(descriptionText, author, "YouTube"),
      description: descriptionText || title,
      author,
      cover,
      mediaType: "video",
      platform: "YouTube"
    };
  }

  function extractPost(container) {
    if (isX) return extractX(container);
    if (isInstagram) return extractInstagram(container);
    return extractYouTube(container);
  }

  function showToast(message) {
    let toast = document.querySelector(".hy-link-pocket-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "hy-link-pocket-toast";
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("hy-show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("hy-show"), 2400);
  }

  function categoryName(categories, id) {
    return categories.find(category => category.id === id)?.name || "待整理";
  }

  function findMenuAnchor(container) {
    const selectors = isX
      ? [
          'button[data-testid="caret"]',
          '[data-testid="caret"]',
          'button[aria-label*="More"]',
          'button[aria-label*="更多"]'
        ]
      : isInstagram
        ? [
            'button[aria-label*="More"]',
            'button[aria-label*="更多"]',
            '[aria-label="More options"]',
            '[aria-label="更多选项"]'
          ]
        : [
            'ytd-menu-renderer button[aria-label*="More"]',
            'ytd-menu-renderer button[aria-label*="更多"]',
            'button[aria-label="More actions"]',
            'button[aria-label*="更多操作"]',
            'ytd-menu-renderer'
          ];

    for (const selector of selectors) {
      const found = container.querySelector(selector);
      if (!found) continue;
      return found.matches?.("button")
        ? found
        : found.closest?.("button") || found.querySelector?.("button") || found;
    }
    return null;
  }

  const trackedButtons = new Set();
  let positionFrame = 0;

  function positionButton(record) {
    const { container, button } = record;
    if (!container.isConnected || !button.isConnected) {
      trackedButtons.delete(record);
      return;
    }

    const menu = findMenuAnchor(container);
    if (!menu) {
      button.style.removeProperty("top");
      button.style.removeProperty("right");
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    if (!containerRect.width || !menuRect.width || !menuRect.height) return;

    const gap = 10;
    const top = Math.max(10, Math.round(menuRect.bottom - containerRect.top + gap));
    const right = Math.max(8, Math.round(containerRect.right - menuRect.right));
    button.style.setProperty("top", `${top}px`, "important");
    button.style.setProperty("right", `${right}px`, "important");
  }

  function refreshButtonPositions() {
    trackedButtons.forEach(positionButton);
  }

  function scheduleButtonPositionRefresh() {
    if (positionFrame) return;
    const requestFrame = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 0));
    positionFrame = requestFrame(() => {
      positionFrame = 0;
      refreshButtonPositions();
    });
  }

  function addButton(container) {
    if (!container || container.dataset.hyLinkPocketReady === "1") return;
    const extracted = extractPost(container);
    if (!extracted.url) return;
    container.dataset.hyLinkPocketReady = "1";
    container.classList.add("hy-link-pocket-target", isX ? "hy-platform-x" : isInstagram ? "hy-platform-instagram" : "hy-platform-youtube");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hy-link-pocket-save";
    button.textContent = "+";
    const contentName = isYouTube ? "视频" : "博文";
    button.title = `保存这条${contentName}到花野链接夹`;
    button.setAttribute("aria-label", `保存这条${contentName}到花野链接夹`);
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      button.classList.add("hy-saving");
      button.textContent = "…";
      try {
        const post = extractPost(container);
        const result = await HYCore.saveLink(post);
        const { categories } = await HYCore.ensureState();
        button.textContent = "✓";
        showToast(`${result.duplicate ? "已更新" : "已保存"}到：${categoryName(categories, result.link.categoryId)}`);
      } catch (error) {
        button.textContent = "!";
        showToast(error.message || "保存失败，请打开这条博文后再试");
      }
      setTimeout(() => {
        button.textContent = "+";
        button.classList.remove("hy-saving");
      }, 1800);
    }, true);
    container.appendChild(button);
    const record = { container, button };
    trackedButtons.add(record);
    positionButton(record);
    scheduleButtonPositionRefresh();
  }

  function candidates() {
    if (isX) {
      return [...document.querySelectorAll('article[data-testid="tweet"], article')]
        .filter(article => findXPermalink(article));
    }
    if (isYouTube) {
      const selectors = [
        "ytd-rich-item-renderer",
        "ytd-video-renderer",
        "ytd-grid-video-renderer",
        "ytd-compact-video-renderer",
        "ytd-reel-item-renderer",
        "ytm-shorts-lockup-view-model",
        "#above-the-fold"
      ].join(",");
      return [...new Set([...document.querySelectorAll(selectors)])]
        .filter(container => findYouTubePermalink(container));
    }
    const articles = [...document.querySelectorAll("article")].filter(article => findInstagramPermalink(article));
    const links = [...document.querySelectorAll('a[href^="/p/"],a[href^="/reel/"],a[href^="/tv/"]')]
      .filter(link => !link.closest("article"));
    return [...new Set([...articles, ...links])];
  }

  let scheduled = false;
  function scan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      candidates().forEach(addButton);
      scheduleButtonPositionRefresh();
    }, 180);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "HY_GET_CURRENT_POST") return;
    const current = candidates().find(container => HYCore.normalizeUrl(extractPost(container).url) === HYCore.normalizeUrl(location.href));
    sendResponse(current ? { ok: true, post: extractPost(current) } : { ok: false });
  });

  window.addEventListener("scroll", scheduleButtonPositionRefresh, true);
  document.addEventListener("scroll", scheduleButtonPositionRefresh, true);
  window.addEventListener("resize", scheduleButtonPositionRefresh);
  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
