import { h } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { buildRowOffsets, virtualKeyboardTarget, visibleWindow } from '../utils/visibleWindow.js';

// Variable-height rows retain the existing mobile wrapping. Only the visible
// slice plus a small overscan is mounted; all results remain in the data model.
export default function WindowedList({ items, renderItem, itemKey, estimatedHeight = 64, className = '', threshold = 120 }) {
  const rootRef = useRef(null);
  const rowsRef = useRef(new Map());
  const measurementsRef = useRef(new Map());
  const focusRef = useRef(null);
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 700, width: 0 });
  const virtual = items.length > threshold;
  const identityRef = useRef(null);
  if (identityRef.current?.items !== items || identityRef.current?.width !== viewport.width || identityRef.current?.estimatedHeight !== estimatedHeight) {
    identityRef.current = { items, width: viewport.width, estimatedHeight };
    measurementsRef.current = new Map();
  }
  const offsets = useMemo(() => buildRowOffsets(items.length, measurementsRef.current, estimatedHeight), [items, measurementVersion, estimatedHeight, viewport.width]);
  const range = virtual ? visibleWindow(offsets, viewport.top, viewport.height) : { start: 0, end: items.length, top: 0, bottom: 0 };

  useLayoutEffect(() => {
    const list = rootRef.current;
    const scroller = list?.closest('#main');
    if (!list || !scroller || !virtual) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const start = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const top = scroller.scrollTop - start;
      const height = scroller.clientHeight;
      const width = scroller.clientWidth;
      setViewport(previous => previous.top === top && previous.height === height && previous.width === width ? previous : { top, height, width });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(scroller);
    // An album section above this list can change height after a resize.
    if (list.parentElement) resize?.observe(list.parentElement);
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [virtual, items]);

  useLayoutEffect(() => {
    if (!virtual) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      let changed = false;
      for (const [index, row] of rowsRef.current) {
        const height = Math.ceil(row.getBoundingClientRect().height);
        if (height && measurementsRef.current.get(index) !== height) {
          measurementsRef.current.set(index, height);
          changed = true;
        }
      }
      if (changed) setMeasurementVersion(value => value + 1);
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    for (const row of rowsRef.current.values()) resize?.observe(row);
    measure();
    if (focusRef.current != null) {
      const { index, column } = focusRef.current;
      const buttons = rowsRef.current.get(index)?.querySelectorAll('[role="button"],button,a');
      buttons?.[Math.min(column, buttons.length - 1)]?.focus({ preventScroll: true });
      focusRef.current = null;
    }
    return () => { if (frame) cancelAnimationFrame(frame); resize?.disconnect(); };
  }, [virtual, range.start, range.end, items, estimatedHeight, viewport.width]);

  const navigateRows = event => {
    if (!virtual) return;
    const row = event.target.closest('[data-virtual-index]');
    if (!row || !rootRef.current?.contains(row)) return;
    const index = Number(row.dataset.virtualIndex);
    const rowButtons = Array.from(row.querySelectorAll('[role="button"],button,a'));
    const column = Math.max(0, rowButtons.indexOf(event.target.closest('[role="button"],button,a')));
    const target = virtualKeyboardTarget({
      key: event.key, shiftKey: event.shiftKey, rowIndex: index, column,
      columnCount: rowButtons.length, itemCount: items.length, start: range.start, end: range.end,
    });
    if (!target) return;
    event.preventDefault();
    const next = target.index;
    const scroller = rootRef.current.closest('#main');
    const listTop = rootRef.current.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const focusColumn = target.column;
    focusRef.current = { index: next, column: focusColumn };
    scroller.scrollTop = listTop + offsets[next];
    setViewport(previous => ({ ...previous, top: offsets[next], height: scroller.clientHeight }));
    const nextButtons = rowsRef.current.get(next)?.querySelectorAll('[role="button"],button,a');
    if (nextButtons?.length) {
      nextButtons[Math.min(focusColumn, nextButtons.length - 1)].focus({ preventScroll: true });
      focusRef.current = null;
    }
  };

  return <div ref={rootRef} class={className} onKeyDownCapture={navigateRows}>
    {range.top > 0 && <div style={{ height: `${range.top}px` }} aria-hidden="true" />}
    {items.slice(range.start, range.end).map((item, offset) => {
      const index = range.start + offset;
      return <div key={itemKey(item, index)} data-virtual-index={index} ref={node => {
        if (node) rowsRef.current.set(index, node);
        else rowsRef.current.delete(index);
      }}>{renderItem(item, index)}</div>;
    })}
    {range.bottom > 0 && <div style={{ height: `${range.bottom}px` }} aria-hidden="true" />}
  </div>;
}
