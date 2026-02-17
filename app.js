const fileInput = document.getElementById("fileInput");
const toolSelect = document.getElementById("toolSelect");
const blurStrength = document.getElementById("blurStrength");
const blurStrengthGroup = document.getElementById("blurStrengthGroup");
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");
const copyBtn = document.getElementById("copyBtn");
const imageCanvas = document.getElementById("imageCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const canvasStage = document.getElementById("canvasStage");
const placeholder = document.getElementById("placeholder");
const statusMsg = document.getElementById("statusMsg");

const imageCtx = imageCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");

let isPointerDown = false;
let startPoint = null;
let currentRect = null;
let originalSnapshot = null;
const history = [];

fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    await loadImageOntoCanvas(file);
    setStatus("Image loaded.");
  } catch (_error) {
    setStatus("Could not load that image.", true);
  }
});

document.addEventListener("paste", async (event) => {
  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;

  event.preventDefault();
  const imageBlob = imageItem.getAsFile();
  if (!imageBlob) {
    setStatus("Clipboard image data was empty.", true);
    return;
  }

  try {
    await loadImageOntoCanvas(imageBlob);
    setStatus("Image pasted.");
  } catch (_error) {
    setStatus("Could not load pasted image.", true);
  }
});

toolSelect.addEventListener("change", () => {
  blurStrengthGroup.style.display = toolSelect.value === "blur" ? "grid" : "none";
});

overlayCanvas.addEventListener("pointerdown", (event) => {
  if (!imageCanvas.width || !imageCanvas.height) return;

  overlayCanvas.setPointerCapture(event.pointerId);
  isPointerDown = true;
  startPoint = pointFromEvent(event);
  currentRect = null;
});

overlayCanvas.addEventListener("pointermove", (event) => {
  if (!isPointerDown || !startPoint) return;
  const p = pointFromEvent(event);
  currentRect = normalizeRect(startPoint, p);
  drawSelection(currentRect);
});

const finishSelection = () => {
  if (!isPointerDown) return;
  isPointerDown = false;

  if (!currentRect || currentRect.w < 2 || currentRect.h < 2) {
    clearOverlay();
    currentRect = null;
    startPoint = null;
    return;
  }

  applyRectAction(currentRect);
  clearOverlay();
  currentRect = null;
  startPoint = null;
};

window.addEventListener("pointerup", finishSelection);
window.addEventListener("pointercancel", finishSelection);

undoBtn.addEventListener("click", () => {
  const previous = history.pop();
  if (!previous) return;
  imageCtx.putImageData(previous, 0, 0);
  updateButtons();
});

resetBtn.addEventListener("click", () => {
  if (!originalSnapshot) return;
  imageCtx.putImageData(originalSnapshot, 0, 0);
  history.length = 0;
  updateButtons();
});

copyBtn.addEventListener("click", async () => {
  if (!imageCanvas.width || !imageCanvas.height) return;
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    setStatus("Copy is not supported in this browser.", true);
    return;
  }

  try {
    const blob = await canvasToBlob(imageCanvas);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    setStatus("Image copied to clipboard.");
  } catch (_error) {
    setStatus("Could not copy image. Clipboard permission may be blocked.", true);
  }
});

function updateButtons() {
  const hasImage = Boolean(imageCanvas.width && imageCanvas.height);
  undoBtn.disabled = history.length === 0;
  resetBtn.disabled = !hasImage;
  copyBtn.disabled = !hasImage;
}

function syncVisibility(hasImage) {
  canvasStage.classList.toggle("ready", hasImage);
  placeholder.style.display = hasImage ? "none" : "block";
}

function clearOverlay() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function drawSelection(rect) {
  clearOverlay();
  overlayCtx.fillStyle = "rgba(110, 200, 255, 0.2)";
  overlayCtx.strokeStyle = "rgba(110, 200, 255, 0.95)";
  overlayCtx.lineWidth = 2;
  overlayCtx.setLineDash([6, 4]);
  overlayCtx.fillRect(rect.x, rect.y, rect.w, rect.h);
  overlayCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
}

function applyRectAction(rect) {
  history.push(imageCtx.getImageData(0, 0, imageCanvas.width, imageCanvas.height));

  if (toolSelect.value === "blackout") {
    imageCtx.save();
    imageCtx.fillStyle = "#000";
    imageCtx.fillRect(rect.x, rect.y, rect.w, rect.h);
    imageCtx.restore();
  } else {
    blurRegion(rect, Number(blurStrength.value));
  }

  updateButtons();
}

function blurRegion(rect, radius) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = rect.w;
  sourceCanvas.height = rect.h;
  const sourceCtx = sourceCanvas.getContext("2d");
  sourceCtx.drawImage(
    imageCanvas,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    0,
    0,
    rect.w,
    rect.h,
  );

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = rect.w;
  outputCanvas.height = rect.h;
  const outputCtx = outputCanvas.getContext("2d");
  outputCtx.filter = `blur(${radius}px)`;
  outputCtx.drawImage(sourceCanvas, 0, 0);

  imageCtx.drawImage(outputCanvas, rect.x, rect.y);
}

function pointFromEvent(event) {
  const bounds = overlayCanvas.getBoundingClientRect();
  const scaleX = overlayCanvas.width / bounds.width;
  const scaleY = overlayCanvas.height / bounds.height;

  return {
    x: clamp(Math.round((event.clientX - bounds.left) * scaleX), 0, overlayCanvas.width),
    y: clamp(Math.round((event.clientY - bounds.top) * scaleY), 0, overlayCanvas.height),
  };
}

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  return { x, y, w, h };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function loadImageOntoCanvas(fileOrBlob) {
  const image = await loadImage(fileOrBlob);
  imageCanvas.width = image.naturalWidth;
  imageCanvas.height = image.naturalHeight;
  overlayCanvas.width = image.naturalWidth;
  overlayCanvas.height = image.naturalHeight;

  imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
  imageCtx.drawImage(image, 0, 0);
  originalSnapshot = imageCtx.getImageData(0, 0, imageCanvas.width, imageCanvas.height);

  history.length = 0;
  updateButtons();
  syncVisibility(true);
  clearOverlay();
}

function loadImage(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = reject;
    image.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas export failed."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function setStatus(message, isError = false) {
  statusMsg.textContent = message;
  statusMsg.classList.toggle("error", isError);
}
