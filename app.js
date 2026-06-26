import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs";
import {
  degrees,
  PDFDocument,
  rgb,
  StandardFonts
} from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

const state = {
  fileBytes: null,
  pdf: null,
  pdfDocProxy: null,
  page: 1,
  pageCount: 0,
  scale: 1,
  rotation: 0,
  activeTool: "select",
  pageOrder: [],
  pageRotations: [],
  documents: {},
  nextDocumentId: 1,
  pendingInsertDocument: null,
  pendingImage: null,
  annotations: [],
  undoStack: [],
  redoStack: [],
  drawing: null,
  moving: null,
  selectedId: null,
  renderTask: null,
  pageViewport: null
};

const els = {
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
  fileName: document.getElementById("fileName"),
  statusText: document.getElementById("statusText"),
  emptyState: document.getElementById("emptyState"),
  pageWrap: document.getElementById("pageWrap"),
  toolbarHost: document.getElementById("toolbarHost"),
  canvas: document.getElementById("pdfCanvas"),
  textLayer: document.getElementById("textLayer"),
  annotationLayer: document.getElementById("annotationLayer"),
  pageNumber: document.getElementById("pageNumber"),
  pageCount: document.getElementById("pageCount"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  zoomLabel: document.getElementById("zoomLabel"),
  rotatePage: document.getElementById("rotatePage"),
  textValue: document.getElementById("textValue"),
  stylePanel: document.getElementById("stylePanel"),
  fontFamily: document.getElementById("fontFamily"),
  fontSize: document.getElementById("fontSize"),
  boldText: document.getElementById("boldText"),
  italicText: document.getElementById("italicText"),
  underlineText: document.getElementById("underlineText"),
  colorPicker: document.getElementById("colorPicker"),
  strokeSize: document.getElementById("strokeSize"),
  lineStyle: document.getElementById("lineStyle"),
  itemWidth: document.getElementById("itemWidth"),
  itemHeight: document.getElementById("itemHeight"),
  itemRotation: document.getElementById("itemRotation"),
  imageInput: document.getElementById("imageInput"),
  chooseImage: document.getElementById("chooseImage"),
  coverText: document.getElementById("coverText"),
  undo: document.getElementById("undo"),
  redo: document.getElementById("redo"),
  closePdf: document.getElementById("closePdf"),
  unlockPdf: document.getElementById("unlockPdf"),
  downloadPdf: document.getElementById("downloadPdf"),
  managePageNumber: document.getElementById("managePageNumber"),
  movePageFrom: document.getElementById("movePageFrom"),
  movePageTo: document.getElementById("movePageTo"),
  removePage: document.getElementById("removePage"),
  rotateManagedPageLeft: document.getElementById("rotateManagedPageLeft"),
  rotateManagedPageRight: document.getElementById("rotateManagedPageRight"),
  movePage: document.getElementById("movePage"),
  insertPages: document.getElementById("insertPages"),
  extractPages: document.getElementById("extractPages"),
  movePageDialog: document.getElementById("movePageDialog"),
  movePageForm: document.getElementById("movePageForm"),
  insertPagesDialog: document.getElementById("insertPagesDialog"),
  insertPagesForm: document.getElementById("insertPagesForm"),
  insertPdfInput: document.getElementById("insertPdfInput"),
  chooseInsertPdf: document.getElementById("chooseInsertPdf"),
  insertPdfName: document.getElementById("insertPdfName"),
  insertRangeStart: document.getElementById("insertRangeStart"),
  insertRangeEnd: document.getElementById("insertRangeEnd"),
  insertAtPage: document.getElementById("insertAtPage"),
  extractPagesDialog: document.getElementById("extractPagesDialog"),
  extractPagesForm: document.getElementById("extractPagesForm"),
  extractPagesSpec: document.getElementById("extractPagesSpec"),
  editorTemplate: document.getElementById("textEditorTemplate")
};

if (window.lucide) {
  window.lucide.createIcons();
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function snapshot() {
  state.undoStack.push(JSON.stringify(state.annotations));
  state.redoStack = [];
}

function restore(serialized) {
  state.annotations = JSON.parse(serialized);
  state.selectedId = null;
  drawAnnotations();
}

function pageAnnotations() {
  return state.annotations.filter((item) => item.page === state.page);
}

function normalizePageRef(ref) {
  if (typeof ref === "number") return { documentId: "main", page: ref };
  return ref || { documentId: "main", page: 1 };
}

function loadPdfBytes(bytes) {
  return PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
}

function pageRefFor(logicalPage = state.page) {
  return normalizePageRef(state.pageOrder[logicalPage - 1] || logicalPage);
}

function pageKey(ref) {
  const pageRef = normalizePageRef(ref);
  return `${pageRef.documentId}:${pageRef.page}`;
}

function normalizeRotation(value) {
  return ((value % 360) + 360) % 360;
}

function clampManagedPage(value) {
  return Math.max(1, Math.min(state.pageCount || 1, Number(value) || 1));
}

function selectedPageForManagement() {
  const mode = document.querySelector('input[name="pageTargetMode"]:checked')?.value || "current";
  return mode === "current" ? state.page : clampManagedPage(els.managePageNumber.value);
}

function syncPageControls() {
  els.pageCount.textContent = `/ ${state.pageCount}`;
  els.pageNumber.max = Math.max(1, state.pageCount);
  els.managePageNumber.max = Math.max(1, state.pageCount);
  els.movePageFrom.max = Math.max(1, state.pageCount);
  els.movePageTo.max = Math.max(1, state.pageCount);
  els.insertAtPage.max = Math.max(1, state.pageCount);
  const mode = document.querySelector('input[name="pageTargetMode"]:checked')?.value || "current";
  els.managePageNumber.value = mode === "current"
    ? state.page
    : Math.min(Number(els.managePageNumber.value) || state.page, Math.max(1, state.pageCount));
  els.movePageFrom.value = Math.min(Number(els.movePageFrom.value) || state.page, Math.max(1, state.pageCount));
  els.movePageTo.value = Math.min(Number(els.movePageTo.value) || state.page, Math.max(1, state.pageCount));
  els.insertAtPage.value = Math.min(Number(els.insertAtPage.value) || state.page, Math.max(1, state.pageCount));
}

function currentStyle() {
  return {
    fontFamily: els.fontFamily.value,
    fontSize: Number(els.fontSize.value) || 18,
    bold: els.boldText.classList.contains("active"),
    italic: els.italicText.classList.contains("active"),
    underline: els.underlineText.classList.contains("active"),
    color: els.colorPicker.value,
    stroke: Number(els.strokeSize.value) || 3,
    lineStyle: els.lineStyle.value
  };
}

function standardFontName(style) {
  const family = style.fontFamily || "Helvetica";
  if (family === "TimesRoman") {
    if (style.bold && style.italic) return StandardFonts.TimesRomanBoldItalic;
    if (style.bold) return StandardFonts.TimesRomanBold;
    if (style.italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (family === "Courier") {
    if (style.bold && style.italic) return StandardFonts.CourierBoldOblique;
    if (style.bold) return StandardFonts.CourierBold;
    if (style.italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (style.bold && style.italic) return StandardFonts.HelveticaBoldOblique;
  if (style.bold) return StandardFonts.HelveticaBold;
  if (style.italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

function setToggle(button, active) {
  button.classList.toggle("active", Boolean(active));
}

function selectedAnnotation() {
  return state.annotations.find((item) => item.id === state.selectedId);
}

function styleModeFor(annotation) {
  if (!annotation) return "shape";
  if (annotation.type === "text") return "text";
  if (annotation.type === "image") return "image";
  if (annotation.type === "path") return "draw";
  return "shape";
}

function activeToolMode(tool) {
  if (tool === "text" || tool === "edit") return "text";
  if (["pen", "pencil", "signature", "highlight"].includes(tool)) return "draw";
  if (["line", "arrow", "rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon"].includes(tool)) return "shape";
  if (tool === "image") return "image";
  return null;
}

function showStylePanel(x, y, mode = "shape") {
  if (!state.pdfDocProxy) return;
  els.toolbarHost.hidden = true;
  els.stylePanel.hidden = false;
  els.stylePanel.dataset.mode = mode;
  els.stylePanel.classList.add("contextual");
  els.stylePanel.classList.remove("tool-toolbar");
  if (els.stylePanel.parentElement !== els.pageWrap) {
    els.pageWrap.appendChild(els.stylePanel);
  }
  const panelWidth = 270;
  const panelHeight = Math.min(360, els.stylePanel.offsetHeight || 300);
  const maxX = Math.max(8, (state.pageViewport?.width || panelWidth) - panelWidth - 8);
  const maxY = Math.max(8, (state.pageViewport?.height || panelHeight) - panelHeight - 8);
  els.stylePanel.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
  els.stylePanel.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
}

function showToolToolbar(tool = state.activeTool) {
  const mode = activeToolMode(tool);
  if (!mode || !state.pdfDocProxy) {
    hideStylePanel();
    return;
  }
  if (els.stylePanel.parentElement !== els.toolbarHost) {
    els.toolbarHost.appendChild(els.stylePanel);
  }
  els.toolbarHost.hidden = false;
  els.stylePanel.hidden = false;
  els.stylePanel.dataset.mode = mode;
  els.stylePanel.classList.remove("contextual");
  els.stylePanel.classList.add("tool-toolbar");
  els.stylePanel.style.left = "";
  els.stylePanel.style.top = "";
}

function showStylePanelForAnnotation(annotation) {
  loadStyleFromAnnotation(annotation);
  if (els.stylePanel.parentElement !== els.toolbarHost) {
    els.toolbarHost.appendChild(els.stylePanel);
  }
  els.toolbarHost.hidden = false;
  els.stylePanel.hidden = false;
  els.stylePanel.dataset.mode = styleModeFor(annotation);
  els.stylePanel.classList.remove("contextual");
  els.stylePanel.classList.add("tool-toolbar");
}

function hideStylePanel() {
  els.stylePanel.hidden = true;
  els.stylePanel.classList.remove("contextual");
  els.stylePanel.classList.remove("tool-toolbar");
  els.toolbarHost.hidden = true;
}

function restoreActiveToolbar() {
  if (activeToolMode(state.activeTool)) {
    showToolToolbar(state.activeTool);
  } else {
    hideStylePanel();
  }
}

function loadStyleFromAnnotation(annotation) {
  if (!annotation) return;
  if (annotation.type === "text") {
    els.fontFamily.value = annotation.fontFamily || "Helvetica";
    els.fontSize.value = Math.round(annotation.fontSize || 18);
    setToggle(els.boldText, annotation.bold);
    setToggle(els.italicText, annotation.italic);
    setToggle(els.underlineText, annotation.underline);
    els.coverText.checked = Boolean(annotation.cover);
  }
  if (annotation.color) {
    els.colorPicker.value = annotation.color;
  }
  if (annotation.stroke) {
    els.strokeSize.value = Math.round(annotation.stroke);
  }
  els.lineStyle.value = annotation.lineStyle || "solid";
  if (annotation.width) {
    els.itemWidth.value = Math.round(annotation.width);
  }
  if (annotation.height) {
    els.itemHeight.value = Math.round(annotation.height);
  }
  els.itemRotation.value = Math.round(annotation.rotation || 0);
}

function applyStyleToSelected({ keepSnapshot = true } = {}) {
  const annotation = selectedAnnotation();
  if (!annotation) return;
  if (keepSnapshot) snapshot();
  const style = currentStyle();

  if (annotation.type === "text") {
    annotation.fontFamily = style.fontFamily;
    annotation.fontSize = style.fontSize;
    annotation.bold = style.bold;
    annotation.italic = style.italic;
    annotation.underline = style.underline;
    annotation.color = style.color;
    annotation.cover = els.coverText.checked;
  } else if (annotation.type !== "image") {
    annotation.color = style.color;
    annotation.lineStyle = style.lineStyle;
  }

  if (annotation.type === "path") {
    annotation.stroke = style.stroke;
    annotation.lineStyle = style.lineStyle;
  }

  if (["line", "arrow", "rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon"].includes(annotation.type)) {
    annotation.stroke = style.stroke;
    annotation.lineStyle = style.lineStyle;
  }

  if ("width" in annotation) {
    annotation.width = Math.max(1, Number(els.itemWidth.value) || annotation.width || 1);
  }
  if ("height" in annotation) {
    annotation.height = Math.max(1, Number(els.itemHeight.value) || annotation.height || 1);
  }
  if ("rotation" in annotation || ["image", "rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon"].includes(annotation.type)) {
    annotation.rotation = Math.max(-180, Math.min(180, Number(els.itemRotation.value) || 0));
  }

  drawAnnotations();
}

function id() {
  return `a-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hexToRgb(hex) {
  const raw = hex.replace("#", "");
  const num = parseInt(raw, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255
  };
}

function dataUrlToBytes(dataUrl) {
  const [, base64] = dataUrl.split(",");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function svgDash(annotation) {
  const stroke = Math.max(1, (annotation.stroke || 1) * state.scale);
  if (annotation.lineStyle === "dash") return `${stroke * 4} ${stroke * 2}`;
  if (annotation.lineStyle === "dot") return `${stroke * 0.5} ${stroke * 2}`;
  return "";
}

function pdfDash(annotation) {
  const stroke = Math.max(1, annotation.stroke || 1);
  if (annotation.lineStyle === "dash") return [stroke * 4, stroke * 2];
  if (annotation.lineStyle === "dot") return [stroke * 0.5, stroke * 2];
  return null;
}

function lineOptions(annotation) {
  const dashArray = pdfDash(annotation);
  return dashArray ? { dashArray } : {};
}

function rotatePoint(point, center, angleDegrees) {
  const angle = angleDegrees * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
}

function annotationCenter(annotation) {
  if (annotation.type === "image" || ["rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon"].includes(annotation.type)) {
    return {
      x: annotation.x + annotation.width / 2,
      y: annotation.y + annotation.height / 2
    };
  }
  return { x: annotation.x || 0, y: annotation.y || 0 };
}

function svgRotation(annotation) {
  const rotation = annotation.rotation || 0;
  if (!rotation) return "";
  const center = toScreenPoint(annotationCenter(annotation));
  return `rotate(${-rotation} ${center.x} ${center.y})`;
}

function autoSizeTextEditor(textarea) {
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.width = `${Math.max(80, Math.min(520, textarea.scrollWidth + 4))}px`;
  textarea.style.height = `${Math.max(36, textarea.scrollHeight + 4)}px`;
}

function measureTextBox(textarea, style) {
  const lines = String(textarea.value || " ").split("\n");
  const fontSize = style.fontSize || 18;
  const maxLine = lines.reduce((max, line) => Math.max(max, line.length), 1);
  return {
    width: Math.max(20, maxLine * fontSize * 0.58 + 10),
    height: Math.max(fontSize * 1.25, lines.length * fontSize * 1.25)
  };
}

function loadImageInfo(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function clientPoint(event) {
  const rect = els.pageWrap.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function toPdfPoint(point) {
  return {
    x: point.x / state.scale,
    y: ((state.pageViewport?.height || 0) - point.y) / state.scale
  };
}

function toScreenPoint(point) {
  return {
    x: point.x * state.scale,
    y: (state.pageViewport?.height || 0) - point.y * state.scale
  };
}

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  };
}

function setTool(tool) {
  state.activeTool = tool;
  document.body.dataset.tool = tool;
  document.querySelectorAll(".tool").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  if (activeToolMode(tool)) {
    showToolToolbar(tool);
  } else {
    hideStylePanel();
  }
}

async function openFile(file) {
  if (!file || file.type !== "application/pdf") {
    setStatus("Choose a PDF file");
    return;
  }

  setStatus("Loading PDF...");
  state.fileBytes = await file.arrayBuffer();
  state.pdfDocProxy = await pdfjsLib.getDocument({ data: state.fileBytes.slice(0) }).promise;
  state.documents = {
    main: {
      bytes: state.fileBytes.slice(0),
      pdfjs: state.pdfDocProxy,
      name: file.name
    }
  };
  state.nextDocumentId = 1;
  state.pendingInsertDocument = null;
  state.page = 1;
  state.pageCount = state.pdfDocProxy.numPages;
  state.pageOrder = Array.from({ length: state.pageCount }, (_, index) => ({ documentId: "main", page: index + 1 }));
  state.pageRotations = {};
  state.annotations = [];
  state.undoStack = [];
  state.redoStack = [];
  hideStylePanel();
  els.fileName.textContent = file.name;
  syncPageControls();
  els.emptyState.hidden = true;
  els.pageWrap.hidden = false;
  await renderPage();
  setStatus("PDF loaded");
}

function closePdf() {
  if (state.renderTask) {
    state.renderTask.cancel();
    state.renderTask = null;
  }
  state.fileBytes = null;
  state.pdfDocProxy = null;
  state.page = 1;
  state.pageCount = 0;
  state.pageOrder = [];
  state.pageRotations = {};
  state.documents = {};
  state.nextDocumentId = 1;
  state.pendingInsertDocument = null;
  state.rotation = 0;
  state.scale = 1;
  state.pendingImage = null;
  state.annotations = [];
  state.undoStack = [];
  state.redoStack = [];
  state.drawing = null;
  state.moving = null;
  state.selectedId = null;
  state.pageViewport = null;
  document.querySelector(".floating-editor")?.remove();
  hideStylePanel();
  els.canvas.getContext("2d").clearRect(0, 0, els.canvas.width, els.canvas.height);
  els.textLayer.innerHTML = "";
  els.annotationLayer.innerHTML = "";
  els.fileInput.value = "";
  els.fileName.textContent = "No document loaded";
  els.pageNumber.value = 1;
  els.pageNumber.max = 1;
  els.pageCount.textContent = "/ 0";
  els.zoomLabel.textContent = "100%";
  els.emptyState.hidden = false;
  els.pageWrap.hidden = true;
  setTool("select");
  setStatus("Ready for a PDF");
}

async function renderPage() {
  if (!state.pdfDocProxy) return;

  if (state.renderTask) {
    state.renderTask.cancel();
  }

  const pageRef = pageRefFor(state.page);
  const sourceDocument = state.documents[pageRef.documentId];
  const page = await sourceDocument.pdfjs.getPage(pageRef.page);
  const viewport = page.getViewport({ scale: state.scale, rotation: normalizeRotation(state.rotation + (state.pageRotations[pageKey(pageRef)] || 0)) });
  state.pageViewport = viewport;

  const context = els.canvas.getContext("2d");
  const pixelRatio = window.devicePixelRatio || 1;
  const cssWidth = Math.floor(viewport.width);
  const cssHeight = Math.floor(viewport.height);
  els.canvas.width = Math.floor(cssWidth * pixelRatio);
  els.canvas.height = Math.floor(cssHeight * pixelRatio);
  els.canvas.style.width = `${cssWidth}px`;
  els.canvas.style.height = `${cssHeight}px`;
  els.pageWrap.style.width = `${cssWidth}px`;
  els.pageWrap.style.height = `${cssHeight}px`;
  els.annotationLayer.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
  els.annotationLayer.setAttribute("width", viewport.width);
  els.annotationLayer.setAttribute("height", viewport.height);

  const renderParams = {
    canvasContext: context,
    viewport
  };
  if (pixelRatio !== 1) {
    renderParams.transform = [pixelRatio, 0, 0, pixelRatio, 0, 0];
  }
  state.renderTask = page.render(renderParams);
  await state.renderTask.promise.catch((error) => {
    if (error.name !== "RenderingCancelledException") throw error;
  });
  state.renderTask = null;

  await renderTextLayer(page, viewport);
  drawAnnotations();

  els.pageNumber.value = state.page;
  els.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
  syncPageControls();
}

async function removeLogicalPage(pageNumber) {
  if (!state.pdfDocProxy || state.pageCount <= 1) {
    setStatus("Cannot remove the last page");
    return;
  }
  const page = clampManagedPage(pageNumber);
  snapshot();
  state.pageOrder.splice(page - 1, 1);
  state.annotations = state.annotations
    .filter((annotation) => annotation.page !== page)
    .map((annotation) => ({
      ...annotation,
      page: annotation.page > page ? annotation.page - 1 : annotation.page
    }));
  state.pageCount = state.pageOrder.length;
  state.page = Math.min(state.page, state.pageCount);
  syncPageControls();
  await renderPage();
  setStatus("Page removed");
}

async function rotateLogicalPage(pageNumber, delta) {
  if (!state.pdfDocProxy) return;
  const page = clampManagedPage(pageNumber);
  const pageRef = pageRefFor(page);
  const key = pageKey(pageRef);
  state.pageRotations[key] = normalizeRotation((state.pageRotations[key] || 0) + delta);
  if (page === state.page) {
    await renderPage();
  }
  setStatus(delta > 0 ? "Page rotated clockwise" : "Page rotated counter clockwise");
}

async function moveLogicalPage(fromPage, referencePage, placement = "before") {
  if (!state.pdfDocProxy) return;
  const from = clampManagedPage(fromPage);
  const reference = clampManagedPage(referencePage);
  snapshot();
  const [source] = state.pageOrder.splice(from - 1, 1);
  let targetIndex = reference - 1;
  if (from < reference) targetIndex -= 1;
  if (placement === "after") targetIndex += 1;
  targetIndex = Math.max(0, Math.min(targetIndex, state.pageOrder.length));
  state.pageOrder.splice(targetIndex, 0, source);
  const to = targetIndex + 1;
  if (from === to) {
    await renderPage();
    return;
  }
  state.annotations = state.annotations.map((annotation) => {
    if (annotation.page === from) return { ...annotation, page: to };
    if (from < to && annotation.page > from && annotation.page <= to) return { ...annotation, page: annotation.page - 1 };
    if (from > to && annotation.page >= to && annotation.page < from) return { ...annotation, page: annotation.page + 1 };
    return annotation;
  });
  state.page = to;
  syncPageControls();
  await renderPage();
  setStatus("Page moved");
}

function parsePageSpec(spec, maxPage) {
  const pages = new Set();
  String(spec || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      if (part.includes("-")) {
        const [startRaw, endRaw] = part.split("-");
        const start = Math.max(1, Number(startRaw) || 1);
        const end = Math.min(maxPage, Number(endRaw) || maxPage);
        const low = Math.min(start, end);
        const high = Math.max(start, end);
        for (let page = low; page <= high; page += 1) pages.add(page);
      } else {
        const page = Number(part);
        if (page >= 1 && page <= maxPage) pages.add(page);
      }
    });
  return [...pages].sort((a, b) => a - b);
}

function insertIndexFor(referencePage, placement) {
  const reference = clampManagedPage(referencePage);
  return placement === "after" ? reference : reference - 1;
}

async function insertPagesFromPending() {
  if (!state.pendingInsertDocument || !state.pdfDocProxy) {
    setStatus("Choose a PDF to insert");
    return;
  }
  const doc = state.pendingInsertDocument;
  const start = Math.max(1, Number(els.insertRangeStart.value) || 1);
  const end = Math.min(doc.pageCount, Number(els.insertRangeEnd.value) || doc.pageCount);
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const refs = Array.from({ length: high - low + 1 }, (_, index) => ({
    documentId: doc.id,
    page: low + index
  }));
  const index = insertIndexFor(els.insertAtPage.value, document.querySelector('input[name="insertPlacement"]:checked')?.value || "before");
  snapshot();
  state.documents[doc.id] = {
    bytes: doc.bytes.slice(0),
    pdfjs: doc.pdfjs,
    name: doc.name
  };
  state.pageOrder.splice(index, 0, ...refs);
  const insertedAt = index + 1;
  state.annotations = state.annotations.map((annotation) => ({
    ...annotation,
    page: annotation.page >= insertedAt ? annotation.page + refs.length : annotation.page
  }));
  state.pageCount = state.pageOrder.length;
  state.page = insertedAt;
  state.pendingInsertDocument = null;
  els.insertPagesDialog.close();
  syncPageControls();
  await renderPage();
  setStatus("Pages inserted");
}

async function extractPagesToPdf(spec) {
  if (!state.pdfDocProxy) return;
  const pages = parsePageSpec(spec, state.pageCount);
  if (!pages.length) {
    setStatus("No valid pages selected");
    return;
  }
  const outputDoc = await PDFDocument.create();
  const pdfLibCache = new Map();
  for (const logicalPage of pages) {
    const ref = pageRefFor(logicalPage);
    if (!pdfLibCache.has(ref.documentId)) {
      pdfLibCache.set(ref.documentId, await loadPdfBytes(state.documents[ref.documentId].bytes));
    }
    const sourceDoc = pdfLibCache.get(ref.documentId);
    const [copiedPage] = await outputDoc.copyPages(sourceDoc, [ref.page - 1]);
    copiedPage.setRotation(degrees(state.pageRotations[pageKey(ref)] || 0));
    outputDoc.addPage(copiedPage);
  }
  const output = await outputDoc.save();
  const blob = new Blob([output], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "extracted-pages.pdf";
  link.click();
  URL.revokeObjectURL(url);
  els.extractPagesDialog.close();
  setStatus("Extracted PDF downloaded");
}

async function unlockPdf() {
  if (!state.fileBytes) {
    setStatus("Open a PDF first");
    return;
  }

  setStatus("Removing edit protection...");
  try {
    const outputDoc = await PDFDocument.create();
    const pdfLibCache = new Map();
    for (const refRaw of state.pageOrder) {
      const ref = normalizePageRef(refRaw);
      if (!pdfLibCache.has(ref.documentId)) {
        pdfLibCache.set(ref.documentId, await loadPdfBytes(state.documents[ref.documentId].bytes));
      }
      const sourceDoc = pdfLibCache.get(ref.documentId);
      const [copiedPage] = await outputDoc.copyPages(sourceDoc, [ref.page - 1]);
      copiedPage.setRotation(degrees(state.pageRotations[pageKey(ref)] || 0));
      outputDoc.addPage(copiedPage);
    }

    const output = await outputDoc.save({ useObjectStreams: false });
    const blob = new Blob([output], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "unlocked.pdf";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Unlocked PDF downloaded");
  } catch (error) {
    console.error(error);
    setStatus("Cannot unlock this PDF without its password");
  }
}

async function renderTextLayer(page, viewport) {
  els.textLayer.innerHTML = "";
  els.textLayer.style.width = `${viewport.width}px`;
  els.textLayer.style.height = `${viewport.height}px`;

  const textContent = await page.getTextContent();
  textContent.items.forEach((item) => {
    const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const span = document.createElement("span");
    span.textContent = item.str;
    span.style.left = `${transform[4]}px`;
    span.style.top = `${transform[5] - Math.abs(transform[3])}px`;
    span.style.fontSize = `${Math.abs(transform[3])}px`;
    span.style.transform = `scaleX(${Math.max(0.2, item.width ? item.width / Math.max(1, item.str.length * Math.abs(transform[3]) * 0.52) : 1)})`;
    span.dataset.text = item.str;
    span.addEventListener("click", (event) => handleTextClick(event, span));
    els.textLayer.appendChild(span);
  });
}

function handleTextClick(event, span) {
  if (state.activeTool !== "edit") return;
  event.stopPropagation();
  const rect = span.getBoundingClientRect();
  const wrap = els.pageWrap.getBoundingClientRect();
  showTextEditor({
    x: rect.left - wrap.left,
    y: rect.top - wrap.top,
    width: Math.max(40, rect.width),
    height: Math.max(18, rect.height),
    value: span.dataset.text || span.textContent || ""
  });
}

function showTextEditor(box, annotation = null) {
  document.querySelector(".floating-editor")?.remove();
  const editor = els.editorTemplate.content.firstElementChild.cloneNode(true);
  const textarea = editor.querySelector("textarea");
  textarea.value = box.value === "New text" ? "" : box.value;
  textarea.placeholder = "Write text";
  textarea.style.fontSize = `${Number(els.fontSize.value) || 18}px`;
  textarea.style.fontFamily = els.fontFamily.options[els.fontFamily.selectedIndex]?.text || "Helvetica";
  editor.style.left = `${Math.max(8, Math.min(box.x, (state.pageViewport?.width || 0) - 330))}px`;
  editor.style.top = `${Math.max(8, box.y + box.height + 8)}px`;
  if (annotation) {
    loadStyleFromAnnotation(annotation);
  }
  showToolToolbar("text");

  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    const style = currentStyle();
    snapshot();
    const target = annotation || {
      id: id(),
      page: state.page,
      type: "text"
    };
    const textBox = measureTextBox(textarea, style);
    if (!annotation) {
      const pdfBox = {
        start: toPdfPoint({ x: box.x, y: box.y + textBox.height }),
        end: toPdfPoint({ x: box.x + textBox.width, y: box.y })
      };
      target.x = pdfBox.start.x;
      target.y = pdfBox.start.y;
    }
    target.width = textBox.width / state.scale;
    target.height = textBox.height / state.scale;
    Object.assign(target, {
      text: textarea.value,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      color: style.color,
      cover: els.coverText.checked
    });
    if (!annotation) {
      state.annotations.push(target);
    }
    state.selectedId = target.id;
    loadStyleFromAnnotation(target);
    editor.remove();
    restoreActiveToolbar();
    drawAnnotations();
  });
  editor.querySelector("[data-cancel]").addEventListener("click", () => {
    editor.remove();
    restoreActiveToolbar();
  });
  els.pageWrap.appendChild(editor);
  autoSizeTextEditor(textarea);
  textarea.addEventListener("input", () => autoSizeTextEditor(textarea));
  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.select();
  });
}

function drawAnnotations() {
  els.annotationLayer.innerHTML = "";
  pageAnnotations().forEach((annotation) => {
    if (annotation.type === "text") drawText(annotation);
    if (annotation.type === "path") drawPath(annotation);
    if (annotation.type === "image") drawImage(annotation);
    if (annotation.type === "line" || annotation.type === "arrow") drawLineShape(annotation);
    if (annotation.type === "rect") drawRect(annotation);
    if (annotation.type === "ellipse") drawEllipse(annotation);
    if (["triangle", "diamond", "pentagon", "hexagon"].includes(annotation.type)) drawPolygon(annotation);
  });
}

function decorate(node, annotation) {
  node.dataset.id = annotation.id;
  node.classList.add("annotation-item");
  if (state.selectedId === annotation.id) node.classList.add("selected");
  node.addEventListener("pointerdown", (event) => selectOrErase(event, annotation));
  node.addEventListener("click", (event) => event.stopPropagation());
  node.addEventListener("dblclick", (event) => editAnnotation(event, annotation));
  els.annotationLayer.appendChild(node);
}

function editAnnotation(event, annotation) {
  event.stopPropagation();
  state.selectedId = annotation.id;
  drawAnnotations();
  if (annotation.type === "text") {
    const point = toScreenPoint(annotation);
    showTextEditor({
      x: point.x,
      y: point.y - annotation.height * state.scale,
      width: Math.max(180, annotation.width * state.scale),
      height: Math.max(24, annotation.height * state.scale),
      value: annotation.text || ""
    }, annotation);
  } else {
    showStylePanelForAnnotation(annotation);
    setStatus("Selected item ready to edit in Style");
  }
}

function drawText(annotation) {
  const point = toScreenPoint(annotation);
  if (annotation.cover) {
    const cover = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    cover.setAttribute("x", point.x);
    cover.setAttribute("y", point.y - annotation.height * state.scale);
    cover.setAttribute("width", annotation.width * state.scale);
    cover.setAttribute("height", annotation.height * state.scale + 5);
    cover.setAttribute("fill", "#ffffff");
    cover.setAttribute("pointer-events", "all");
    decorate(cover, annotation);
  }

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.textContent = annotation.text;
  text.setAttribute("x", point.x);
  text.setAttribute("y", point.y);
  text.setAttribute("font-size", annotation.fontSize * state.scale);
  text.setAttribute("font-family", annotation.fontFamily || "Helvetica");
  text.setAttribute("font-weight", annotation.bold ? "700" : "400");
  text.setAttribute("font-style", annotation.italic ? "italic" : "normal");
  text.setAttribute("fill", annotation.color);
  text.setAttribute("pointer-events", "all");
  text.classList.add("annotation-text");
  decorate(text, annotation);

  if (annotation.underline) {
    const width = Math.max(annotation.width, annotation.text.length * annotation.fontSize * 0.5);
    const underline = document.createElementNS("http://www.w3.org/2000/svg", "line");
    underline.setAttribute("x1", point.x);
    underline.setAttribute("y1", point.y + 3 * state.scale);
    underline.setAttribute("x2", point.x + width * state.scale);
    underline.setAttribute("y2", point.y + 3 * state.scale);
    underline.setAttribute("stroke", annotation.color);
    underline.setAttribute("stroke-width", Math.max(1, state.scale));
    underline.setAttribute("pointer-events", "stroke");
    decorate(underline, annotation);
  }
}

function drawPath(annotation) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  const points = annotation.points.map(toScreenPoint).map((point) => `${point.x},${point.y}`).join(" ");
  hitPath.setAttribute("points", points);
  hitPath.setAttribute("fill", "none");
  hitPath.setAttribute("stroke", "transparent");
  hitPath.setAttribute("stroke-width", Math.max(annotation.stroke * state.scale, 14));
  hitPath.setAttribute("stroke-linecap", "round");
  hitPath.setAttribute("stroke-linejoin", "round");
  hitPath.setAttribute("pointer-events", "stroke");
  path.setAttribute("points", points);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", annotation.color);
  path.setAttribute("stroke-width", annotation.stroke * state.scale);
  path.setAttribute("stroke-dasharray", svgDash(annotation));
  path.setAttribute("opacity", annotation.opacity || 1);
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  group.appendChild(hitPath);
  group.appendChild(path);
  decorate(group, annotation);
}

function drawImage(annotation) {
  const point = toScreenPoint({ x: annotation.x, y: annotation.y });
  const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
  image.setAttribute("href", annotation.dataUrl);
  image.setAttribute("x", point.x);
  image.setAttribute("y", point.y - annotation.height * state.scale);
  image.setAttribute("width", annotation.width * state.scale);
  image.setAttribute("height", annotation.height * state.scale);
  image.setAttribute("transform", svgRotation(annotation));
  image.setAttribute("pointer-events", "all");
  image.classList.add("annotation-image");
  decorate(image, annotation);
}

function drawLineShape(annotation) {
  if (!annotation.end) return;
  const start = toScreenPoint(annotation.start);
  const end = toScreenPoint(annotation.end);
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const hitLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  hitLine.setAttribute("x1", start.x);
  hitLine.setAttribute("y1", start.y);
  hitLine.setAttribute("x2", end.x);
  hitLine.setAttribute("y2", end.y);
  hitLine.setAttribute("stroke", "transparent");
  hitLine.setAttribute("stroke-width", Math.max(annotation.stroke * state.scale, 14));
  hitLine.setAttribute("stroke-linecap", "round");
  hitLine.setAttribute("pointer-events", "stroke");
  line.setAttribute("x1", start.x);
  line.setAttribute("y1", start.y);
  line.setAttribute("x2", end.x);
  line.setAttribute("y2", end.y);
  line.setAttribute("stroke", annotation.color);
  line.setAttribute("stroke-width", annotation.stroke * state.scale);
  line.setAttribute("stroke-dasharray", svgDash(annotation));
  line.setAttribute("stroke-linecap", "round");
  group.appendChild(hitLine);
  group.appendChild(line);

  if (annotation.type === "arrow") {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = Math.max(9, annotation.stroke * state.scale * 4);
    const points = [
      [end.x, end.y],
      [end.x - size * Math.cos(angle - Math.PI / 6), end.y - size * Math.sin(angle - Math.PI / 6)],
      [end.x - size * Math.cos(angle + Math.PI / 6), end.y - size * Math.sin(angle + Math.PI / 6)]
    ].map((point) => point.join(",")).join(" ");
    const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    head.setAttribute("points", points);
    head.setAttribute("fill", annotation.color);
    group.appendChild(head);
  }

  decorate(group, annotation);
}

function drawRect(annotation) {
  const start = toScreenPoint({ x: annotation.x, y: annotation.y });
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", start.x);
  rect.setAttribute("y", start.y - annotation.height * state.scale);
  rect.setAttribute("width", annotation.width * state.scale);
  rect.setAttribute("height", annotation.height * state.scale);
  rect.setAttribute("fill", "transparent");
  rect.setAttribute("stroke", annotation.color);
  rect.setAttribute("stroke-width", annotation.stroke * state.scale);
  rect.setAttribute("stroke-dasharray", svgDash(annotation));
  rect.setAttribute("transform", svgRotation(annotation));
  rect.setAttribute("pointer-events", "all");
  decorate(rect, annotation);
}

function drawEllipse(annotation) {
  const start = toScreenPoint({ x: annotation.x + annotation.width / 2, y: annotation.y + annotation.height / 2 });
  const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
  ellipse.setAttribute("cx", start.x);
  ellipse.setAttribute("cy", start.y);
  ellipse.setAttribute("rx", Math.abs(annotation.width * state.scale / 2));
  ellipse.setAttribute("ry", Math.abs(annotation.height * state.scale / 2));
  ellipse.setAttribute("fill", "transparent");
  ellipse.setAttribute("stroke", annotation.color);
  ellipse.setAttribute("stroke-width", annotation.stroke * state.scale);
  ellipse.setAttribute("stroke-dasharray", svgDash(annotation));
  ellipse.setAttribute("transform", svgRotation(annotation));
  ellipse.setAttribute("pointer-events", "all");
  decorate(ellipse, annotation);
}

function polygonPoints(annotation) {
  const sides = { triangle: 3, diamond: 4, pentagon: 5, hexagon: 6 }[annotation.type] || 3;
  const center = {
    x: annotation.x + annotation.width / 2,
    y: annotation.y + annotation.height / 2
  };
  const rx = Math.abs(annotation.width / 2);
  const ry = Math.abs(annotation.height / 2);
  const startAngle = annotation.type === "diamond" ? -Math.PI / 2 : -Math.PI / 2;
  return Array.from({ length: sides }, (_, index) => ({
    x: center.x + rx * Math.cos(startAngle + index * 2 * Math.PI / sides),
    y: center.y + ry * Math.sin(startAngle + index * 2 * Math.PI / sides)
  }));
}

function drawPolygon(annotation) {
  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  const points = polygonPoints(annotation).map(toScreenPoint).map((point) => `${point.x},${point.y}`).join(" ");
  polygon.setAttribute("points", points);
  polygon.setAttribute("fill", "transparent");
  polygon.setAttribute("stroke", annotation.color);
  polygon.setAttribute("stroke-width", annotation.stroke * state.scale);
  polygon.setAttribute("stroke-dasharray", svgDash(annotation));
  polygon.setAttribute("transform", svgRotation(annotation));
  polygon.setAttribute("pointer-events", "all");
  decorate(polygon, annotation);
}

function drawPdfArrowHead(page, annotation, color) {
  const angle = Math.atan2(annotation.end.y - annotation.start.y, annotation.end.x - annotation.start.x);
  const size = Math.max(8, annotation.stroke * 4);
  const left = {
    x: annotation.end.x - size * Math.cos(angle - Math.PI / 6),
    y: annotation.end.y - size * Math.sin(angle - Math.PI / 6)
  };
  const right = {
    x: annotation.end.x - size * Math.cos(angle + Math.PI / 6),
    y: annotation.end.y - size * Math.sin(angle + Math.PI / 6)
  };
      page.drawLine({
        start: annotation.end,
        end: left,
        thickness: annotation.stroke,
        color: rgb(color.r, color.g, color.b),
        ...lineOptions(annotation)
      });
  page.drawLine({
    start: annotation.end,
    end: right,
    thickness: annotation.stroke,
    color: rgb(color.r, color.g, color.b),
    ...lineOptions(annotation)
  });
}

function selectOrErase(event, annotation) {
  if (state.activeTool === "erase") {
    event.stopPropagation();
    snapshot();
    state.annotations = state.annotations.filter((item) => item.id !== annotation.id);
    drawAnnotations();
    return;
  }

  if (state.activeTool !== "select") return;
  event.stopPropagation();
  state.selectedId = annotation.id;
  showStylePanelForAnnotation(annotation);
  snapshot();
  state.moving = {
    id: annotation.id,
    startX: event.clientX,
    startY: event.clientY,
    original: JSON.parse(JSON.stringify(annotation))
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add("selected");
}

function applyMove(event) {
  if (!state.moving) return;
  const annotation = state.annotations.find((item) => item.id === state.moving.id);
  if (!annotation) return;

  const dx = (event.clientX - state.moving.startX) / state.scale;
  const dy = -(event.clientY - state.moving.startY) / state.scale;
  const original = state.moving.original;

  if (annotation.type === "path") {
    annotation.points = original.points.map((point) => ({
      x: point.x + dx,
      y: point.y + dy
    }));
  } else if (annotation.type === "line" || annotation.type === "arrow") {
    annotation.start = { x: original.start.x + dx, y: original.start.y + dy };
    annotation.end = { x: original.end.x + dx, y: original.end.y + dy };
  } else {
    annotation.x = original.x + dx;
    annotation.y = original.y + dy;
  }

  drawAnnotations();
}

function endMove() {
  state.moving = null;
  drawAnnotations();
}

function beginPointer(event) {
  if (!state.pdfDocProxy) return;
  const point = clientPoint(event);
  const style = currentStyle();

  if (state.activeTool === "text") {
    showTextEditor({ x: point.x, y: point.y, width: 190, height: style.fontSize + 6, value: "" });
    return;
  }

  if (state.activeTool === "image") {
    if (!state.pendingImage) {
      els.imageInput.click();
      setStatus("Choose a picture, then click the PDF to place it");
      return;
    }
    snapshot();
    const defaultWidth = Math.min(220, state.pendingImage.width);
    const defaultHeight = defaultWidth * state.pendingImage.height / state.pendingImage.width;
    const width = Math.max(1, Number(els.itemWidth.value) || defaultWidth);
    const height = Math.max(1, Number(els.itemHeight.value) || defaultHeight);
    const pdfPoint = toPdfPoint({ x: point.x, y: point.y + height * state.scale });
    state.annotations.push({
      id: id(),
      page: state.page,
      type: "image",
      x: pdfPoint.x,
      y: pdfPoint.y,
      width,
      height,
      rotation: Math.max(-180, Math.min(180, Number(els.itemRotation.value) || 0)),
      dataUrl: state.pendingImage.dataUrl,
      mime: state.pendingImage.mime
    });
    els.itemWidth.value = Math.round(width);
    els.itemHeight.value = Math.round(height);
    els.itemRotation.value = 0;
    state.pendingImage = null;
    els.imageInput.value = "";
    setTool("select");
    drawAnnotations();
    setStatus("Picture added");
    return;
  }

  if (["pen", "pencil", "signature", "highlight"].includes(state.activeTool)) {
    snapshot();
    const isHighlight = state.activeTool === "highlight";
    const isPencil = state.activeTool === "pencil";
    state.drawing = {
      id: id(),
      page: state.page,
      type: "path",
      points: [toPdfPoint(point)],
      color: style.color,
      stroke: isHighlight ? Math.max(10, style.stroke * 4) : isPencil ? Math.max(1, style.stroke - 1) : style.stroke,
      lineStyle: style.lineStyle,
      opacity: isHighlight ? 0.45 : isPencil ? 0.72 : 1
    };
    state.annotations.push(state.drawing);
    els.annotationLayer.setPointerCapture(event.pointerId);
    return;
  }

  if (["line", "arrow", "rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon"].includes(state.activeTool)) {
    snapshot();
    state.drawing = {
      id: id(),
      page: state.page,
      type: state.activeTool,
      start: state.activeTool === "line" || state.activeTool === "arrow" ? toPdfPoint(point) : point,
      color: style.color,
      stroke: style.stroke,
      lineStyle: style.lineStyle,
      rotation: Number(els.itemRotation.value) || 0
    };
    els.annotationLayer.setPointerCapture(event.pointerId);
  }
}

function movePointer(event) {
  if (state.moving) {
    applyMove(event);
    return;
  }

  if (!state.drawing) return;
  const point = clientPoint(event);

  if (state.drawing.type === "path") {
    state.drawing.points.push(toPdfPoint(point));
  } else if (state.drawing.type === "line" || state.drawing.type === "arrow") {
    state.drawing.end = toPdfPoint(point);
    if (!state.annotations.find((item) => item.id === state.drawing.id)) {
      state.annotations.push(state.drawing);
    }
  } else {
    const rect = normalizeRect(state.drawing.start, point);
    const pdfTopLeft = toPdfPoint({ x: rect.x, y: rect.y + rect.height });
    state.drawing.x = pdfTopLeft.x;
    state.drawing.y = pdfTopLeft.y;
    state.drawing.width = rect.width / state.scale;
    state.drawing.height = rect.height / state.scale;
    if (!state.annotations.find((item) => item.id === state.drawing.id)) {
      state.annotations.push(state.drawing);
    }
  }

  drawAnnotations();
}

function endPointer(event) {
  if (state.moving) {
    endMove();
    return;
  }

  if (!state.drawing) return;
  if ((state.drawing.type === "line" || state.drawing.type === "arrow") && !state.drawing.end) {
    state.annotations = state.annotations.filter((item) => item.id !== state.drawing.id);
  } else if (state.drawing.type !== "path" && state.drawing.type !== "line" && state.drawing.type !== "arrow" && (!state.drawing.width || !state.drawing.height)) {
    state.annotations = state.annotations.filter((item) => item.id !== state.drawing.id);
  } else if ("width" in state.drawing && "height" in state.drawing) {
    els.itemWidth.value = Math.round(state.drawing.width);
    els.itemHeight.value = Math.round(state.drawing.height);
    els.itemRotation.value = Math.round(state.drawing.rotation || 0);
  }
  state.drawing = null;
  try {
    els.annotationLayer.releasePointerCapture(event.pointerId);
  } catch {
    return;
  }
}

async function downloadPdf() {
  if (!state.fileBytes) return;

  setStatus("Preparing PDF...");
  const pdfDoc = await PDFDocument.create();
  const pdfLibCache = new Map();
  for (const refRaw of state.pageOrder) {
    const ref = normalizePageRef(refRaw);
    if (!pdfLibCache.has(ref.documentId)) {
      pdfLibCache.set(ref.documentId, await loadPdfBytes(state.documents[ref.documentId].bytes));
    }
    const sourceDoc = pdfLibCache.get(ref.documentId);
    const [page] = await pdfDoc.copyPages(sourceDoc, [ref.page - 1]);
    page.setRotation(degrees(state.pageRotations[pageKey(ref)] || 0));
    pdfDoc.addPage(page);
  }
  const fontCache = new Map();
  const imageCache = new Map();

  async function fontFor(annotation) {
    const name = standardFontName(annotation);
    if (!fontCache.has(name)) {
      fontCache.set(name, await pdfDoc.embedFont(name));
    }
    return fontCache.get(name);
  }

  async function imageFor(annotation) {
    if (!imageCache.has(annotation.dataUrl)) {
      const bytes = dataUrlToBytes(annotation.dataUrl);
      const image = annotation.mime === "image/png" ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      imageCache.set(annotation.dataUrl, image);
    }
    return imageCache.get(annotation.dataUrl);
  }

  for (const annotation of state.annotations) {
    const page = pdfDoc.getPage(annotation.page - 1);
    const color = hexToRgb(annotation.color || "#111827");

    if (annotation.type === "text") {
      const font = await fontFor(annotation);
      const lines = String(annotation.text || "").split("\n");
      if (annotation.cover) {
        page.drawRectangle({
          x: annotation.x,
          y: annotation.y - annotation.height - annotation.fontSize * Math.max(0, lines.length - 1) * 1.25,
          width: annotation.width,
          height: annotation.height + annotation.fontSize * Math.max(0, lines.length - 1) * 1.25 + 4,
          color: rgb(1, 1, 1)
        });
      }
      lines.forEach((line, index) => {
        const y = annotation.y - index * annotation.fontSize * 1.25;
        page.drawText(line, {
          x: annotation.x,
          y,
          size: annotation.fontSize,
          font,
          color: rgb(color.r, color.g, color.b)
        });
        if (annotation.underline) {
          page.drawLine({
            start: { x: annotation.x, y: y - 2 },
            end: { x: annotation.x + font.widthOfTextAtSize(line, annotation.fontSize), y: y - 2 },
            thickness: Math.max(0.7, annotation.fontSize / 18),
            color: rgb(color.r, color.g, color.b)
          });
        }
      });
    }

    if (annotation.type === "image") {
      const image = await imageFor(annotation);
      page.drawImage(image, {
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
        rotate: degrees(annotation.rotation || 0)
      });
    }

    if ((annotation.type === "line" || annotation.type === "arrow") && annotation.end) {
      page.drawLine({
        start: annotation.start,
        end: annotation.end,
        thickness: annotation.stroke,
        color: rgb(color.r, color.g, color.b),
        ...lineOptions(annotation)
      });
      if (annotation.type === "arrow") {
        drawPdfArrowHead(page, annotation, color);
      }
    }

    if (annotation.type === "rect" && (annotation.lineStyle || "solid") === "solid") {
      page.drawRectangle({
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
        borderColor: rgb(color.r, color.g, color.b),
        borderWidth: annotation.stroke,
        rotate: degrees(annotation.rotation || 0)
      });
    }

    if (annotation.type === "rect" && (annotation.lineStyle || "solid") !== "solid") {
      const center = annotationCenter(annotation);
      const points = [
        { x: annotation.x, y: annotation.y },
        { x: annotation.x + annotation.width, y: annotation.y },
        { x: annotation.x + annotation.width, y: annotation.y + annotation.height },
        { x: annotation.x, y: annotation.y + annotation.height }
      ].map((point) => rotatePoint(point, center, annotation.rotation || 0));
      points.forEach((point, index) => {
        page.drawLine({
          start: point,
          end: points[(index + 1) % points.length],
          thickness: annotation.stroke,
          color: rgb(color.r, color.g, color.b),
          ...lineOptions(annotation)
        });
      });
    }

    if (annotation.type === "ellipse") {
      page.drawEllipse({
        x: annotation.x + annotation.width / 2,
        y: annotation.y + annotation.height / 2,
        xScale: Math.abs(annotation.width / 2),
        yScale: Math.abs(annotation.height / 2),
        borderColor: rgb(color.r, color.g, color.b),
        borderWidth: annotation.stroke,
        rotate: degrees(annotation.rotation || 0)
      });
    }

    if (annotation.type === "path" && annotation.points.length > 1) {
      for (let index = 1; index < annotation.points.length; index += 1) {
        page.drawLine({
          start: annotation.points[index - 1],
          end: annotation.points[index],
          thickness: annotation.stroke,
          color: rgb(color.r, color.g, color.b),
          opacity: annotation.opacity || 1,
          ...lineOptions(annotation)
        });
      }
    }

    if (["triangle", "diamond", "pentagon", "hexagon"].includes(annotation.type)) {
      const center = annotationCenter(annotation);
      const points = polygonPoints(annotation).map((point) => rotatePoint(point, center, annotation.rotation || 0));
      points.forEach((point, index) => {
        const next = points[(index + 1) % points.length];
        page.drawLine({
          start: point,
          end: next,
          thickness: annotation.stroke,
          color: rgb(color.r, color.g, color.b),
          ...lineOptions(annotation)
        });
      });
    }
  }

  const output = await pdfDoc.save();
  const blob = new Blob([output], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "edited.pdf";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Edited PDF downloaded");
}

document.querySelectorAll(".tool").forEach((button) => {
  button.addEventListener("click", () => {
    const tool = button.dataset.tool;
    if (tool === "image") {
      hideStylePanel();
      state.pendingImage = null;
      els.imageInput.value = "";
      setTool("image");
      els.imageInput.click();
      setStatus("Choose a picture to place");
      return;
    }
    hideStylePanel();
    setTool(tool);
  });
});

els.chooseImage.addEventListener("click", () => els.imageInput.click());
els.imageInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!["image/png", "image/jpeg"].includes(file.type)) {
    setStatus("Choose a PNG or JPEG picture");
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const dimensions = await loadImageInfo(dataUrl);
  state.pendingImage = {
    dataUrl,
    mime: file.type,
    width: dimensions.width,
    height: dimensions.height
  };
  const defaultWidth = Math.min(220, dimensions.width);
  els.itemWidth.value = Math.round(defaultWidth);
  els.itemHeight.value = Math.round(defaultWidth * dimensions.height / dimensions.width);
  els.itemRotation.value = 0;
  setTool("image");
  setStatus("Picture ready. Click the PDF to place it");
});

[els.boldText, els.italicText, els.underlineText].forEach((button) => {
  button.addEventListener("click", () => {
    button.classList.toggle("active");
    applyStyleToSelected({ keepSnapshot: false });
  });
});

[
  els.fontFamily,
  els.fontSize,
  els.colorPicker,
  els.strokeSize,
  els.lineStyle,
  els.itemWidth,
  els.itemHeight,
  els.itemRotation,
  els.coverText
].forEach((control) => {
  control.addEventListener("input", () => applyStyleToSelected({ keepSnapshot: false }));
  control.addEventListener("change", () => applyStyleToSelected({ keepSnapshot: false }));
});

els.fileInput.addEventListener("change", (event) => openFile(event.target.files[0]));
["dragenter", "dragover"].forEach((name) => {
  document.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("dragging");
  });
});
["dragleave", "drop"].forEach((name) => {
  document.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("dragging");
  });
});
document.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file?.type === "application/pdf") openFile(file);
});

els.prevPage.addEventListener("click", async () => {
  if (state.page > 1) {
    state.page -= 1;
    await renderPage();
  }
});
els.nextPage.addEventListener("click", async () => {
  if (state.page < state.pageCount) {
    state.page += 1;
    await renderPage();
  }
});
els.pageNumber.addEventListener("change", async () => {
  const page = Math.max(1, Math.min(state.pageCount, Number(els.pageNumber.value) || 1));
  state.page = page;
  await renderPage();
});
els.zoomIn.addEventListener("click", async () => {
  state.scale = Math.min(2.5, state.scale + 0.15);
  await renderPage();
});
els.zoomOut.addEventListener("click", async () => {
  state.scale = Math.max(0.55, state.scale - 0.15);
  await renderPage();
});
els.rotatePage.addEventListener("click", async () => {
  await rotateLogicalPage(state.page, 90);
});
els.removePage.addEventListener("click", () => removeLogicalPage(selectedPageForManagement()));
els.rotateManagedPageLeft.addEventListener("click", () => rotateLogicalPage(selectedPageForManagement(), -90));
els.rotateManagedPageRight.addEventListener("click", () => rotateLogicalPage(selectedPageForManagement(), 90));
els.movePage.addEventListener("click", () => {
  syncPageControls();
  els.movePageDialog.showModal();
});
els.insertPages.addEventListener("click", () => {
  if (!state.pdfDocProxy) return;
  state.pendingInsertDocument = null;
  els.insertPdfInput.value = "";
  els.insertPdfName.textContent = "No PDF selected";
  els.insertRangeStart.value = 1;
  els.insertRangeEnd.value = 1;
  syncPageControls();
  els.insertPagesDialog.showModal();
});
els.extractPages.addEventListener("click", () => {
  if (!state.pdfDocProxy) return;
  els.extractPagesSpec.value = String(state.page);
  els.extractPagesDialog.showModal();
});
els.movePageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const placement = document.querySelector('input[name="movePlacement"]:checked')?.value || "before";
  els.movePageDialog.close();
  moveLogicalPage(els.movePageFrom.value, els.movePageTo.value, placement);
});
els.chooseInsertPdf.addEventListener("click", () => els.insertPdfInput.click());
els.insertPdfInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.type !== "application/pdf") {
    setStatus("Choose a PDF file");
    return;
  }
  const bytes = await file.arrayBuffer();
  const pdfjs = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const id = `insert-${state.nextDocumentId}`;
  state.nextDocumentId += 1;
  state.pendingInsertDocument = {
    id,
    bytes,
    pdfjs,
    name: file.name,
    pageCount: pdfjs.numPages
  };
  els.insertPdfName.textContent = `${file.name} (${pdfjs.numPages} pages)`;
  els.insertRangeStart.max = pdfjs.numPages;
  els.insertRangeEnd.max = pdfjs.numPages;
  els.insertRangeStart.value = 1;
  els.insertRangeEnd.value = pdfjs.numPages;
});
els.insertPagesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  insertPagesFromPending();
});
els.extractPagesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  extractPagesToPdf(els.extractPagesSpec.value);
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog")?.close());
});
document.querySelectorAll('input[name="pageTargetMode"]').forEach((input) => {
  input.addEventListener("change", syncPageControls);
});
els.undo.addEventListener("click", () => {
  if (!state.undoStack.length) return;
  state.redoStack.push(JSON.stringify(state.annotations));
  restore(state.undoStack.pop());
});
els.redo.addEventListener("click", () => {
  if (!state.redoStack.length) return;
  state.undoStack.push(JSON.stringify(state.annotations));
  restore(state.redoStack.pop());
});
els.downloadPdf.addEventListener("click", downloadPdf);
els.unlockPdf.addEventListener("click", unlockPdf);
els.closePdf.addEventListener("click", closePdf);

els.annotationLayer.addEventListener("pointerdown", beginPointer);
els.annotationLayer.addEventListener("pointermove", movePointer);
els.annotationLayer.addEventListener("pointerup", endPointer);
els.annotationLayer.addEventListener("pointercancel", endPointer);
els.annotationLayer.addEventListener("click", () => {
  if (state.activeTool === "select") {
    state.selectedId = null;
    drawAnnotations();
  }
});

els.pageWrap.addEventListener("click", (event) => {
  if (
    event.target.closest(".annotation-item") ||
    event.target.closest(".style-panel") ||
    event.target.closest(".floating-editor")
  ) {
    return;
  }
  if (state.activeTool === "select") {
    state.selectedId = null;
    hideStylePanel();
    drawAnnotations();
  }
});

setTool("select");
