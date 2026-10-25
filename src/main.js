import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./style.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = (id) => document.getElementById(id);
const ui = {
  open: $("openButton"), welcomeOpen: $("welcomeOpen"), welcome: $("welcome"),
  stage: $("documentStage"), viewport: $("viewerViewport"), docName: $("documentName"),
  pageInput: $("pageInput"), pageTotal: $("pageTotal"), previous: $("prevPage"), next: $("nextPage"),
  zoomIn: $("zoomIn"), zoomOut: $("zoomOut"), zoomValue: $("zoomValue"),
  findForm: $("findForm"), findInput: $("findInput"), findCount: $("findCount"),
  save: $("saveButton"), loading: $("loadingIndicator"), loadingText: $("loadingText"),
  statusLeft: $("statusLeft"), statusRight: $("statusRight"), toast: $("toast"), theme: $("themeButton"),
};

const state = {
  pdf: null, source: null, fileName: "", pages: [], currentPage: 1, zoom: 1,
  baseScale: 1, fit: true, observer: null, loading: false, renderQueue: Promise.resolve(),
  searchTimer: 0, searchId: 0, textCache: new Map(), matches: [], matchIndex: -1, lastQuery: "", toastTimer: 0, scrollFrame: 0,
};

ui.open.addEventListener("click", () => window.nour.openPdf());
ui.welcomeOpen.addEventListener("click", () => window.nour.openPdf());
window.nour.onPdfOpen((file) => openDocument(file));

function notify(message, duration = 2800) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("show"), duration);
}

function setBusy(busy, text = "جارٍ فتح المستند…") {
  state.loading = busy;
  ui.loading.hidden = !busy;
  ui.loadingText.textContent = text;
  ui.open.disabled = busy;
  ui.welcomeOpen.disabled = busy;
}

function clearDocument() {
  state.searchId++;
  state.observer?.disconnect();
  state.pdf?.destroy();
  state.pdf = null;
  state.pages = [];
  state.textCache.clear();
  state.matches = [];
  state.matchIndex = -1;
  state.lastQuery = "";
  ui.stage.replaceChildren();
  ui.stage.hidden = true;
  ui.welcome.hidden = false;
  ui.findCount.textContent = "";
  ui.pageInput.value = "—";
  ui.pageInput.disabled = true;
  ui.pageTotal.textContent = "—";
  ui.findInput.value = "";
  ui.findInput.disabled = true;
  ui.save.disabled = true;
  ui.previous.disabled = ui.next.disabled = ui.zoomIn.disabled = ui.zoomOut.disabled = true;
  ui.zoomValue.textContent = "ملاءمة";
  ui.docName.textContent = "لا يوجد مستند مفتوح";
  ui.docName.title = "لم يتم فتح ملف";
  ui.statusLeft.textContent = "جاهز لفتح ملف PDF";
}

async function openDocument(file) {
  if (!file?.bytes?.length) return;
  setBusy(true);
  clearDocument();
  ui.welcome.hidden = true;
  ui.stage.hidden = false;
  ui.statusLeft.textContent = "جارٍ قراءة المستند…";
  state.fileName = file.name || "مستند.pdf";
  state.source = new Uint8Array(file.bytes);
  try {
    const task = pdfjs.getDocument({
      data: state.source.slice(),
      isEvalSupported: false,
      enableXfa: false,
      stopAtErrors: false,
      canvasMaxAreaInBytes: 64 * 1024 * 1024,
    });
    task.onPassword = (updatePassword, reason) => {
      const hint = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? "كلمة المرور غير صحيحة. حاول مرة أخرى:" : "أدخل كلمة مرور ملف PDF:";
      const password = window.prompt(hint);
      if (password) {
        updatePassword(password);
      } else {
        task.destroy();
        clearDocument();
      }
    };
    state.pdf = await task.promise;
    state.fileName = file.name || "مستند.pdf";
    ui.docName.textContent = state.fileName;
    ui.docName.title = state.fileName;
    ui.pageTotal.textContent = String(state.pdf.numPages);
    ui.pageInput.value = "1";
    ui.pageInput.disabled = false;
    ui.findInput.disabled = false;
    ui.save.disabled = false;
    ui.previous.disabled = true;
    ui.next.disabled = state.pdf.numPages < 2;
    ui.zoomIn.disabled = ui.zoomOut.disabled = false;
    ui.statusLeft.textContent = `${state.pdf.numPages.toLocaleString("ar")} صفحة`;
    state.baseScale = Math.min(1, (ui.viewport.clientWidth - 72) / 612);
    state.pages = new Array(state.pdf.numPages).fill(null);
    state.observer = new IntersectionObserver(onPageIntersection, {
      root: ui.viewport,
      rootMargin: "900px 0px",
      threshold: 0,
    });
    for (let number = 1; number <= state.pdf.numPages; number++) {
      const holder = document.createElement("section");
      holder.className = "page-holder";
      holder.dataset.page = String(number);
      holder.setAttribute("aria-label", `الصفحة ${number}`);
      const paper = document.createElement("div");
      paper.className = "paper-placeholder";
      paper.innerHTML = '<span class="page-loading-dot"></span>';
      holder.append(paper);
      ui.stage.append(holder);
      state.pages[number - 1] = { holder, paper, proxy: null, canvas: null, rendering: null, aspect: 792 / 612 };
      state.observer.observe(holder);
    }
    await loadPage(1);
    setCurrentPage(1);
    ui.statusRight.textContent = "الملف مفتوح على جهازك فقط";
  } catch (error) {
    clearDocument();
    const message = /password/i.test(String(error))
      ? "هذا الملف محمي بكلمة مرور. افتحه بعد فك الحماية."
      : "تعذر فتح الملف. تحقق من أنه ملف PDF سليم وغير تالف.";
    notify(message, 5000);
    ui.statusLeft.textContent = "تعذر فتح المستند";
  } finally {
    setBusy(false);
  }
}

function onPageIntersection(entries) {
  for (const entry of entries) {
    const number = Number(entry.target.dataset.page);
    const page = state.pages[number - 1];
    if (!page) continue;
    if (entry.isIntersecting) {
      state.renderQueue = state.renderQueue.then(() => loadPage(number)).catch(() => {});
    } else if (page.canvas && !page.rendering) {
      page.canvas.remove();
      page.canvas = null;
    }
  }
}

async function loadPage(number) {
  const page = state.pages[number - 1];
  if (!page || !state.pdf || page.rendering) return page?.rendering;
  if (page.canvas) return;
  try {
    page.proxy ||= await state.pdf.getPage(number);
    const natural = page.proxy.getViewport({ scale: 1 });
    page.aspect = natural.height / natural.width;
    const scale = Math.max(0.35, state.baseScale * state.zoom);
    const viewport = page.proxy.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.4);
    const canvas = document.createElement("canvas");
    canvas.className = "page-canvas";
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.setAttribute("aria-label", `محتوى الصفحة ${number}`);
    page.paper.style.width = `${viewport.width}px`;
    page.paper.style.height = `${viewport.height}px`;
    page.paper.replaceChildren(canvas);
    page.canvas = canvas;
    const task = page.proxy.render({ canvas, canvasContext: canvas.getContext("2d", { alpha: false }), viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0], background: "#ffffff" });
    page.rendering = task.promise;
    await task.promise;
  } catch {
    page.paper.classList.add("page-error");
    page.paper.textContent = "تعذر عرض هذه الصفحة";
  } finally {
    page.rendering = null;
  }
}

function setCurrentPage(number) {
  if (!state.pdf) return;
  const pageNum = Math.min(state.pdf.numPages, Math.max(1, Number(number) || 1));
  state.currentPage = pageNum;
  ui.pageInput.value = String(pageNum);
  ui.previous.disabled = pageNum <= 1;
  ui.next.disabled = pageNum >= state.pdf.numPages;
  const pages = state.pages;
  const current = pages[pageNum - 1];
  for (const item of pages) item.holder.classList.remove("current-page");
  current?.holder.classList.add("current-page");
}

function goToPage(number) {
  const pageNum = Math.min(state.pages.length, Math.max(1, Number(number) || 1));
  state.pages[pageNum - 1]?.holder.scrollIntoView({ behavior: "smooth", block: "start" });
  setCurrentPage(pageNum);
  loadPage(pageNum);
}

ui.viewport.addEventListener("scroll", () => {
  if (!state.pdf || state.scrollFrame) return;
  state.scrollFrame = requestAnimationFrame(() => {
    state.scrollFrame = 0;
    const center = ui.viewport.getBoundingClientRect().top + ui.viewport.clientHeight * 0.38;
    let low = 0;
    let high = state.pages.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (state.pages[middle].holder.getBoundingClientRect().bottom < center) low = middle + 1;
      else high = middle;
    }
    const best = Math.min(state.pages.length, low + 1);
    if (best && best !== state.currentPage) setCurrentPage(best);
  });
}, { passive: true });

ui.previous.addEventListener("click", () => goToPage(state.currentPage - 1));
ui.next.addEventListener("click", () => goToPage(state.currentPage + 1));
ui.pageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { goToPage(ui.pageInput.value); ui.pageInput.blur(); }
});
ui.pageInput.addEventListener("change", () => goToPage(ui.pageInput.value));

async function setZoom(zoom, fit = false) {
  if (!state.pdf) return;
  state.fit = fit;
  state.zoom = Math.max(0.6, Math.min(2.8, zoom));
  ui.zoomValue.textContent = fit ? "ملاءمة" : `${Math.round(state.zoom * 100)}٪`;
  const current = state.currentPage;
  for (const page of state.pages) {
    if (page.canvas) { page.canvas.remove(); page.canvas = null; }
    page.paper.style.width = "";
    page.paper.style.height = "";
  }
  if (fit) {
    const proxy = await state.pdf.getPage(current);
    const vp = proxy.getViewport({ scale: 1 });
    state.baseScale = Math.max(0.35, Math.min(1.4, (ui.viewport.clientWidth - 88) / vp.width));
  }
  goToPage(current);
}

ui.zoomIn.addEventListener("click", () => setZoom(state.zoom + 0.15));
ui.zoomOut.addEventListener("click", () => setZoom(state.zoom - 0.15));
let resizeTimer;
window.addEventListener("resize", () => {
  if (!state.pdf || !state.fit) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => setZoom(state.zoom, true), 180);
});

ui.findForm.addEventListener("submit", (event) => { event.preventDefault(); search(ui.findInput.value, true); });
ui.findInput.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => search(ui.findInput.value, false), 350);
});
ui.findInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); search(ui.findInput.value, true); }
  if (event.key === "Escape") { ui.findInput.value = ""; search("", false); }
});

async function getPageText(number) {
  if (state.textCache.has(number)) return state.textCache.get(number);
  const page = await state.pdf.getPage(number);
  const content = await page.getTextContent({ includeMarkedContent: false });
  const text = content.items.filter((item) => typeof item.str === "string").map((item) => item.str).join(" ");
  state.textCache.set(number, text);
  return text;
}

async function search(query, moveToMatch) {
  const needle = query.trim().toLocaleLowerCase();
  if (moveToMatch && needle && needle === state.lastQuery && state.matches.length) {
    state.matchIndex = (state.matchIndex + 1) % state.matches.length;
    ui.findCount.textContent = `${(state.matchIndex + 1).toLocaleString("ar")}/${state.matches.length.toLocaleString("ar")}`;
    goToPage(state.matches[state.matchIndex]);
    return;
  }
  const id = ++state.searchId;
  state.matches = [];
  state.matchIndex = -1;
  if (!needle || !state.pdf) { ui.findCount.textContent = ""; return; }
  ui.findCount.textContent = "…";
  try {
    for (let page = 1; page <= state.pdf.numPages; page++) {
      if (id !== state.searchId) return;
      const text = (await getPageText(page)).toLocaleLowerCase();
      let offset = 0;
      while ((offset = text.indexOf(needle, offset)) !== -1) { state.matches.push(page); offset += needle.length; }
      if (page % 20 === 0) ui.findCount.textContent = `${state.matches.length}+`;
    }
    if (id !== state.searchId) return;
    if (state.matches.length) {
      state.matchIndex = 0;
      state.lastQuery = needle;
      ui.findCount.textContent = `١/${state.matches.length.toLocaleString("ar")}`;
      if (moveToMatch) goToPage(state.matches[0]);
    } else {
      ui.findCount.textContent = "٠ نتائج";
    }
  } catch {
    if (id === state.searchId) ui.findCount.textContent = "تعذر البحث";
  }
}

ui.save.addEventListener("click", () => {
  if (!state.source) return;
  const blob = new Blob([state.source], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = state.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
});

ui.theme.addEventListener("click", () => {
  const light = document.documentElement.classList.toggle("light-theme");
  ui.theme.setAttribute("aria-label", light ? "استخدام السمة الداكنة" : "استخدام السمة الفاتحة");
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && state.pdf) {
    event.preventDefault(); ui.findInput.focus(); ui.findInput.select();
  }
  if (!ui.findInput.matches(":focus") && state.pdf && event.key === "PageDown") goToPage(state.currentPage + 1);
  if (!ui.findInput.matches(":focus") && state.pdf && event.key === "PageUp") goToPage(state.currentPage - 1);
});

