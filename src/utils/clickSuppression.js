// Click suppression utility to prevent bleed-through clicks
// when overlays are dismissed on touch devices

let suppressNextClick = false;
let suppressNextClickTimer = null;

export function armClickSuppression() {
  suppressNextClick = true;
  clearTimeout(suppressNextClickTimer);
  suppressNextClickTimer = setTimeout(() => { suppressNextClick = false; }, 500);
}

export function isClickSuppressed() {
  return suppressNextClick;
}

export function clearClickSuppression() {
  suppressNextClick = false;
  clearTimeout(suppressNextClickTimer);
}

// Global click handler to suppress the next click
document.addEventListener('click', (e) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
}, true); // Capture phase to catch before other handlers