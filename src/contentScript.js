(function brazeCatalogImagePreview() {
  "use strict";

  const PREFIX = "braze-catalog-image-preview";
  const ROOT_CLASS = `${PREFIX}-root`;
  const MODAL_OPEN_CLASS = `${PREFIX}-modal-open`;
  const ROUTE_CHECK_INTERVAL_MS = 750;

  const CONFIG = {
    // Keep Braze host and Catalog route detection in one place for easy updates.
    brazeHostPatterns: [
      /(^|\.)braze\.com$/i,
      /(^|\.)braze\.eu$/i
    ],
    catalogRoutePatterns: [
      /(^|[/?#&=])catalogs?(?=$|[/?#&=])/i,
      /(^|[/?#&=])catalog_items?(?=$|[/?#&=])/i
    ],
    imageUrlPattern: /\bhttps?:\/\/[^\s"'<>`]+?\.(?:jpe?g|png|gif|webp|avif|svg)(?:[?#][^\s"'<>`]*)?/gi,
    imagePathPattern: /\.(?:jpe?g|png|gif|webp|avif|svg)$/i,
    scanRootSelectors: [
      "main",
      "[role='main']",
      "[data-testid*='catalog' i]",
      "[data-test*='catalog' i]",
      "[class*='catalog' i]",
      "table",
      "[role='table']",
      "[role='grid']",
      "[class*='table' i]",
      "[class*='grid' i]",
      "[class*='ReactVirtualized' i]",
      "[class*='ag-root' i]"
    ],
    cellValueSelectors: [
      "td",
      "[role='cell']",
      "[role='gridcell']",
      "[class*='cell' i]",
      "[data-testid*='cell' i]",
      "[data-test*='cell' i]"
    ],
    urlValueElementSelectors: [
      "td",
      "span",
      "div",
      "[role='cell']",
      "[role='gridcell']",
      "[class*='cell' i]",
      "[class*='value' i]",
      "[class*='url' i]",
      "[data-testid*='cell' i]",
      "[data-testid*='value' i]",
      "[data-testid*='url' i]",
      "[data-test*='cell' i]",
      "[data-test*='value' i]",
      "[data-test*='url' i]"
    ],
    attributeUrlNames: [
      "title",
      "aria-label",
      "data-value",
      "data-original-value",
      "data-cell-value"
    ],
    attributeValueSelectors: [
      "[title]",
      "[aria-label]",
      "[data-value]",
      "[data-original-value]",
      "[data-cell-value]"
    ],
    urlBreakCharactersPattern: /[\u00ad\u200b-\u200d\ufeff]/g,
    ignoredAncestorSelector: [
      `.${ROOT_CLASS}`,
      "a",
      "button",
      "input",
      "textarea",
      "select",
      "option",
      "script",
      "style",
      "noscript",
      "svg",
      "img",
      "picture",
      "video",
      "canvas",
      "code",
      "pre",
      "[contenteditable='true']",
      "[aria-hidden='true']"
    ].join(","),
    maxTextNodeLength: 4000,
    processDebounceMs: 150
  };

  let isActive = false;
  let mutationObserver = null;
  let routeTimer = null;
  let debounceTimer = null;
  let lastHref = window.location.href;
  let lastFocusedElement = null;
  let modalElements = null;
  const seenTextValues = new WeakMap();

  init();

  function init() {
    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("popstate", handleRoutePossiblyChanged);
    window.addEventListener("hashchange", handleRoutePossiblyChanged);
    window.addEventListener("pagehide", destroy, { once: true });

    routeTimer = window.setInterval(checkForRouteChange, ROUTE_CHECK_INTERVAL_MS);
    setActiveState(isBrazeCatalogUrl(window.location));
  }

  function destroy() {
    stopMutationObserver();
    closeModal();
    window.clearInterval(routeTimer);
    window.clearTimeout(debounceTimer);
    document.removeEventListener("click", handleDocumentClick, true);
    window.removeEventListener("popstate", handleRoutePossiblyChanged);
    window.removeEventListener("hashchange", handleRoutePossiblyChanged);
  }

  function checkForRouteChange() {
    if (window.location.href === lastHref) {
      return;
    }

    lastHref = window.location.href;
    handleRoutePossiblyChanged();
  }

  function handleRoutePossiblyChanged() {
    setActiveState(isBrazeCatalogUrl(window.location));
  }

  function isBrazeCatalogUrl(locationLike) {
    let url;

    try {
      url = new URL(locationLike.href);
    } catch (_error) {
      return false;
    }

    const isBrazeHost = CONFIG.brazeHostPatterns.some((pattern) => pattern.test(url.hostname));
    if (!isBrazeHost) {
      return false;
    }

    const routeText = `${url.pathname}${url.hash}`;
    return CONFIG.catalogRoutePatterns.some((pattern) => pattern.test(routeText));
  }

  function setActiveState(shouldBeActive) {
    if (shouldBeActive) {
      if (!isActive) {
        isActive = true;
        startMutationObserver();
      }

      scheduleProcess();
      return;
    }

    if (!isActive) {
      return;
    }

    isActive = false;
    stopMutationObserver();
    closeModal();
    restoreGeneratedPreviewText();
  }

  function startMutationObserver() {
    if (mutationObserver || !document.documentElement) {
      return;
    }

    mutationObserver = new MutationObserver((mutations) => {
      if (!isActive || !mutations.some(shouldMutationTriggerScan)) {
        return;
      }

      scheduleProcess();
    });

    mutationObserver.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function stopMutationObserver() {
    if (!mutationObserver) {
      return;
    }

    mutationObserver.disconnect();
    mutationObserver = null;
  }

  function shouldMutationTriggerScan(mutation) {
    if (mutation.type === "characterData") {
      const parent = mutation.target.parentElement;
      return Boolean(parent && !parent.closest(`.${ROOT_CLASS}`) && mutation.target.nodeValue && mutation.target.nodeValue.includes("http"));
    }

    return Array.from(mutation.addedNodes).some((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return Boolean(node.nodeValue && node.nodeValue.includes("http"));
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      return !node.classList.contains(ROOT_CLASS);
    });
  }

  function scheduleProcess() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(processCatalogContent, CONFIG.processDebounceMs);
  }

  function processCatalogContent() {
    if (!isActive || !document.body || !isBrazeCatalogUrl(window.location)) {
      return;
    }

    const roots = getScanRoots();
    roots.forEach((root) => {
      processImageAnchors(root);
      processAttributeBackedValues(root);
      processTextBackedValues(root);
      scanTextNodes(root);
    });
  }

  function getScanRoots() {
    const candidates = [];

    CONFIG.scanRootSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (element instanceof HTMLElement && isElementVisible(element)) {
          candidates.push(element);
        }
      });
    });

    const roots = compactRootCandidates(candidates);
    return roots.length > 0 ? roots : [document.body];
  }

  function compactRootCandidates(candidates) {
    const roots = [];

    candidates.forEach((candidate) => {
      if (candidate === document.documentElement || candidate.classList.contains(ROOT_CLASS)) {
        return;
      }

      if (roots.some((root) => root.contains(candidate))) {
        return;
      }

      for (let index = roots.length - 1; index >= 0; index -= 1) {
        if (candidate.contains(roots[index])) {
          roots.splice(index, 1);
        }
      }

      roots.push(candidate);
    });

    return roots;
  }

  function scanTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!shouldProcessTextNode(node)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }

    nodes.forEach(transformTextNode);
  }

  function processImageAnchors(root) {
    const anchors = getMatchingElements(root, "a[href]");

    anchors.forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement) || anchor.closest(`.${ROOT_CLASS}`) || !isElementVisible(anchor)) {
        return;
      }

      const url = getFirstSupportedImageUrl([
        anchor.href,
        anchor.textContent,
        ...CONFIG.attributeUrlNames.map((attributeName) => anchor.getAttribute(attributeName))
      ]);

      if (!url || !isPlainUrlAnchor(anchor)) {
        return;
      }

      anchor.replaceWith(createThumbnail(url));
    });
  }

  function processAttributeBackedValues(root) {
    const elements = getMatchingElements(root, [
      ...CONFIG.cellValueSelectors,
      ...CONFIG.attributeValueSelectors
    ].join(","));

    elements.forEach((element) => {
      if (!(element instanceof HTMLElement) || element.closest(`.${ROOT_CLASS}`) || !isElementVisible(element)) {
        return;
      }

      if (!canReplaceElementContent(element)) {
        return;
      }

      const url = getFirstSupportedImageUrl(CONFIG.attributeUrlNames.map((attributeName) => element.getAttribute(attributeName)));
      if (!url) {
        return;
      }

      element.replaceChildren(createThumbnail(url));
    });
  }

  function processTextBackedValues(root) {
    const elements = getMatchingElements(root, CONFIG.urlValueElementSelectors.join(","));

    elements.forEach((element) => {
      if (!(element instanceof HTMLElement) || element.closest(`.${ROOT_CLASS}`) || !isElementVisible(element)) {
        return;
      }

      if (!canReplaceElementContent(element) || hasProcessableCellDescendant(element)) {
        return;
      }

      const text = element.textContent.trim();
      const url = getFirstSupportedImageUrl([text]);
      if (!url || !isSingleUrlishValue(text, url)) {
        return;
      }

      element.replaceChildren(createThumbnail(url));
    });
  }

  function getMatchingElements(root, selector) {
    const elements = [];

    if (root instanceof Element && root.matches(selector)) {
      elements.push(root);
    }

    if (root instanceof Element || root instanceof Document || root instanceof DocumentFragment) {
      root.querySelectorAll(selector).forEach((element) => elements.push(element));
    }

    return elements;
  }

  function getFirstSupportedImageUrl(values) {
    for (const value of values) {
      if (!value || !String(value).includes("http")) {
        continue;
      }

      const searchTexts = getUrlSearchTexts(String(value));

      for (const searchText of searchTexts) {
        CONFIG.imageUrlPattern.lastIndex = 0;

        for (let match = CONFIG.imageUrlPattern.exec(searchText); match; match = CONFIG.imageUrlPattern.exec(searchText)) {
          const candidate = normalizeUrlCandidate(match[0]);
          if (isSupportedImageUrl(candidate.url)) {
            return candidate.url;
          }
        }
      }
    }

    return "";
  }

  function getUrlSearchTexts(value) {
    const withoutBreakCharacters = value.replace(CONFIG.urlBreakCharactersPattern, "");
    const compacted = withoutBreakCharacters.replace(/\s+/g, "");

    return Array.from(new Set([
      value,
      withoutBreakCharacters,
      compacted
    ]));
  }

  function isPlainUrlAnchor(anchor) {
    if (anchor.querySelector(`.${ROOT_CLASS}, button, input, textarea, select, img, video, canvas`)) {
      return false;
    }

    const text = anchor.textContent.trim();
    return isUrlishVisibleText(text);
  }

  function canReplaceElementContent(element) {
    if (element.matches(CONFIG.ignoredAncestorSelector) || element.closest(CONFIG.ignoredAncestorSelector)) {
      return false;
    }

    if (element.querySelector(`.${ROOT_CLASS}, a, button, input, textarea, select, img, svg, video, canvas, [contenteditable='true']`)) {
      return false;
    }

    const text = element.textContent.trim();
    return isUrlishVisibleText(text);
  }

  function hasProcessableCellDescendant(element) {
    const selector = CONFIG.urlValueElementSelectors.join(",");
    return Array.from(element.querySelectorAll(selector)).some((descendant) => {
      if (!(descendant instanceof HTMLElement) || descendant.closest(`.${ROOT_CLASS}`)) {
        return false;
      }

      const descendantText = descendant.textContent.trim();
      return descendantText && descendantText.includes("http") && getFirstSupportedImageUrl([descendantText]);
    });
  }

  function isSingleUrlishValue(text, url) {
    const compactText = text
      .replace(CONFIG.urlBreakCharactersPattern, "")
      .replace(/\s+/g, "");
    return compactText === url || compactText === truncateMiddle(url) || compactText.includes(url);
  }

  function truncateMiddle(value) {
    if (value.length <= 32) {
      return value;
    }

    return `${value.slice(0, 16)}...${value.slice(-16)}`;
  }

  function isUrlishVisibleText(text) {
    return !text || text.includes("http") || text.includes("...") || text.includes("\u2026");
  }

  function shouldProcessTextNode(node) {
    const text = node.nodeValue;
    if (!text || text.length > CONFIG.maxTextNodeLength || !text.includes("http")) {
      return false;
    }

    if (seenTextValues.get(node) === text) {
      return false;
    }

    const parent = node.parentElement;
    if (!parent || parent.closest(CONFIG.ignoredAncestorSelector) || !isElementVisible(parent)) {
      return false;
    }

    CONFIG.imageUrlPattern.lastIndex = 0;
    return getFirstSupportedImageUrl([text]) !== "";
  }

  function transformTextNode(node) {
    const text = node.nodeValue;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let didReplace = false;

    seenTextValues.set(node, text);
    CONFIG.imageUrlPattern.lastIndex = 0;

    for (let match = CONFIG.imageUrlPattern.exec(text); match; match = CONFIG.imageUrlPattern.exec(text)) {
      const rawMatch = match[0];
      const candidate = normalizeUrlCandidate(rawMatch);

      if (match.index > lastIndex) {
        fragment.append(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      if (isSupportedImageUrl(candidate.url)) {
        fragment.append(createThumbnail(candidate.url));
        didReplace = true;
      } else {
        fragment.append(document.createTextNode(candidate.url));
      }

      if (candidate.trailingText) {
        fragment.append(document.createTextNode(candidate.trailingText));
      }

      lastIndex = match.index + rawMatch.length;
    }

    if (!didReplace) {
      return;
    }

    if (lastIndex < text.length) {
      fragment.append(document.createTextNode(text.slice(lastIndex)));
    }

    node.replaceWith(fragment);
  }

  function normalizeUrlCandidate(value) {
    let url = value;
    let trailingText = "";

    while (/[),.;:!?]$/.test(url)) {
      trailingText = `${url.slice(-1)}${trailingText}`;
      url = url.slice(0, -1);
    }

    return { url, trailingText };
  }

  function isSupportedImageUrl(value) {
    let url;

    try {
      url = new URL(value);
    } catch (_error) {
      return false;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    return CONFIG.imagePathPattern.test(url.pathname);
  }

  function createThumbnail(url) {
    const wrapper = document.createElement("span");
    wrapper.className = `${ROOT_CLASS} ${PREFIX}-thumbnail-wrapper`;
    wrapper.dataset.originalUrl = url;

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = `${PREFIX}-thumbnail-button`;
    previewButton.dataset.originalUrl = url;
    previewButton.title = "Open image preview";
    previewButton.setAttribute("aria-label", "Open image preview");

    const image = document.createElement("img");
    image.className = `${PREFIX}-thumbnail`;
    image.src = url;
    image.alt = "Image preview";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      wrapper.classList.add(`${PREFIX}-thumbnail-wrapper-error`);
      previewButton.classList.add(`${PREFIX}-thumbnail-button-error`);
      image.hidden = true;

      if (!previewButton.querySelector(`.${PREFIX}-thumbnail-error-label`)) {
        const errorLabel = document.createElement("span");
        errorLabel.className = `${PREFIX}-thumbnail-error-label`;
        errorLabel.textContent = "Preview unavailable";
        previewButton.append(errorLabel);
      }
    }, { once: true });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = `${PREFIX}-copy-button`;
    copyButton.dataset.originalUrl = url;
    copyButton.textContent = "Copy URL";
    copyButton.title = "Copy original image URL";

    previewButton.append(image);
    wrapper.append(previewButton, copyButton);

    return wrapper;
  }

  function createFallbackUrlText(url) {
    const fallback = document.createElement("span");
    fallback.className = `${ROOT_CLASS} ${PREFIX}-fallback-url`;
    fallback.dataset.originalUrl = url;
    fallback.textContent = url;
    return fallback;
  }

  function restoreGeneratedPreviewText() {
    document.querySelectorAll(`.${PREFIX}-thumbnail-wrapper, .${PREFIX}-fallback-url`).forEach((element) => {
      const originalUrl = element.dataset.originalUrl;
      if (originalUrl) {
        element.replaceWith(document.createTextNode(originalUrl));
      }
    });
  }

  function handleDocumentClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const copyButton = target.closest(`.${PREFIX}-copy-button`);
    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();
      copyOriginalUrl(copyButton.dataset.originalUrl, copyButton);
      return;
    }

    const previewButton = target.closest(`.${PREFIX}-thumbnail-button`);
    if (previewButton) {
      event.preventDefault();
      event.stopPropagation();
      openModal(previewButton.dataset.originalUrl);
      return;
    }

    if (target.closest(`.${PREFIX}-modal-close`)) {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
      return;
    }

    if (target.classList.contains(`${PREFIX}-modal`)) {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    }
  }

  function ensureModal() {
    if (modalElements) {
      return modalElements;
    }

    const overlay = document.createElement("div");
    overlay.className = `${ROOT_CLASS} ${PREFIX}-modal`;
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Image preview");

    const panel = document.createElement("div");
    panel.className = `${PREFIX}-modal-panel`;

    const header = document.createElement("div");
    header.className = `${PREFIX}-modal-header`;

    const title = document.createElement("h2");
    title.className = `${PREFIX}-modal-title`;
    title.textContent = "Image preview";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = `${PREFIX}-modal-close`;
    closeButton.textContent = "Close";
    closeButton.setAttribute("aria-label", "Close image preview");

    const imageWrap = document.createElement("div");
    imageWrap.className = `${PREFIX}-modal-image-wrap`;

    const image = document.createElement("img");
    image.className = `${PREFIX}-modal-image`;
    image.alt = "Full image preview";
    image.decoding = "async";

    const errorMessage = document.createElement("p");
    errorMessage.className = `${PREFIX}-modal-error`;
    errorMessage.hidden = true;
    errorMessage.textContent = "Image could not be loaded.";

    image.addEventListener("load", () => {
      errorMessage.hidden = true;
    });

    image.addEventListener("error", () => {
      errorMessage.hidden = false;
    });

    const footer = document.createElement("div");
    footer.className = `${PREFIX}-modal-footer`;

    const urlLink = document.createElement("a");
    urlLink.className = `${PREFIX}-modal-url`;
    urlLink.target = "_blank";
    urlLink.rel = "noopener noreferrer";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = `${PREFIX}-copy-button ${PREFIX}-modal-copy`;
    copyButton.textContent = "Copy URL";

    imageWrap.append(image, errorMessage);
    footer.append(urlLink, copyButton);
    header.append(title, closeButton);
    panel.append(header, imageWrap, footer);
    overlay.append(panel);
    document.body.append(overlay);

    modalElements = {
      overlay,
      closeButton,
      image,
      urlLink,
      copyButton,
      errorMessage
    };

    return modalElements;
  }

  function openModal(url) {
    if (!url || !isSupportedImageUrl(url)) {
      return;
    }

    const modal = ensureModal();
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    modal.errorMessage.hidden = true;
    modal.image.src = url;
    modal.urlLink.href = url;
    modal.urlLink.textContent = url;
    modal.copyButton.dataset.originalUrl = url;
    modal.overlay.hidden = false;

    document.documentElement.classList.add(MODAL_OPEN_CLASS);
    document.addEventListener("keydown", handleModalKeydown, true);
    modal.closeButton.focus({ preventScroll: true });
  }

  function closeModal() {
    if (!modalElements || modalElements.overlay.hidden) {
      return;
    }

    modalElements.overlay.hidden = true;
    modalElements.image.removeAttribute("src");
    document.documentElement.classList.remove(MODAL_OPEN_CLASS);
    document.removeEventListener("keydown", handleModalKeydown, true);

    if (lastFocusedElement && lastFocusedElement.isConnected) {
      lastFocusedElement.focus({ preventScroll: true });
    }

    lastFocusedElement = null;
  }

  function handleModalKeydown(event) {
    if (event.key === "Tab") {
      trapModalFocus(event);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    }
  }

  function trapModalFocus(event) {
    if (!modalElements || modalElements.overlay.hidden) {
      return;
    }

    const focusableElements = Array.from(
      modalElements.overlay.querySelectorAll("a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])")
    ).filter((element) => element instanceof HTMLElement && isElementVisible(element));

    if (focusableElements.length === 0) {
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  async function copyOriginalUrl(url, button) {
    if (!url || !(button instanceof HTMLButtonElement)) {
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;

    try {
      await writeTextToClipboard(url);
      button.textContent = "Copied";
    } catch (error) {
      console.warn("[Braze Catalog Image Preview] Could not copy URL.", error);
      button.textContent = "Copy failed";
    } finally {
      window.setTimeout(() => {
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = originalText;
        }
      }, 1200);
    }
  }

  async function writeTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    if (!document.body) {
      throw new Error("Document body is not available for clipboard fallback.");
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();

    const copied = document.execCommand("copy");
    textarea.remove();

    if (!copied) {
      throw new Error("Clipboard fallback failed.");
    }
  }

  function isElementVisible(element) {
    if (!element.isConnected) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    return element.getClientRects().length > 0 || element === document.body;
  }
})();
