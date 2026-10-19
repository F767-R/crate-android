export function buildRowOffsets(count, measurements = new Map(), estimatedHeight = 64) {
  const offsets = [0];
  for (let index = 0; index < count; index++) {
    offsets.push(offsets[index] + Math.max(1, measurements.get(index) || estimatedHeight));
  }
  return offsets;
}

function rowAt(offsets, position) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function visibleWindow(offsets, scrollTop, viewportHeight, overscan = 5) {
  const count = Math.max(0, offsets.length - 1);
  if (!count) return { start: 0, end: 0, top: 0, bottom: 0 };
  const first = Math.min(count - 1, rowAt(offsets, Math.max(0, scrollTop)));
  const last = Math.min(count, rowAt(offsets, Math.max(0, scrollTop + viewportHeight)) + 1);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, Math.max(first + 1, last) + overscan);
  return { start, end, top: offsets[start], bottom: offsets[count] - offsets[end] };
}

export function virtualKeyboardTarget({ key, shiftKey, rowIndex, column, columnCount, itemCount, start, end }) {
  let index;
  if (key === 'ArrowDown') index = rowIndex + 1;
  else if (key === 'ArrowUp') index = rowIndex - 1;
  else if (key === 'Home') index = 0;
  else if (key === 'End') index = itemCount - 1;
  else if (key === 'Tab') {
    if (shiftKey ? column > 0 : column < columnCount - 1) return null;
    index = rowIndex + (shiftKey ? -1 : 1);
    if (index < 0 || index >= itemCount || (index >= start && index < end)) return null;
  } else return null;
  return {
    index: Math.max(0, Math.min(itemCount - 1, index)),
    column: key === 'Tab' ? (shiftKey ? Number.MAX_SAFE_INTEGER : 0) : column,
  };
}
