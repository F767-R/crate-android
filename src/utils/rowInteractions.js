// One gesture controller per list. Scrolling or leaving the list cancels a hold.
export function createRowInteractions(openMenu, {
  schedule = setTimeout, clear = clearTimeout,
} = {}) {
  let timer = null;
  let origin = null;
  let suppressClick = false;
  let menuOpened = false;

  const stop = () => {
    if (timer !== null) clear(timer);
    timer = null;
    origin = null;
  };
  const cancel = () => {
    if (origin) suppressClick = true;
    stop();
  };
  const show = (point, target) => {
    stop();
    suppressClick = true;
    if (menuOpened) return;
    menuOpened = true;
    openMenu({ x: point.clientX, y: point.clientY, ...target });
  };

  const bind = (target, activate) => ({
    onPointerDown(event) {
      cancel();
      if (event.isPrimary === false) return;
      suppressClick = false;
      menuOpened = false;
      if (event.button !== 0) return;
      origin = { clientX: event.clientX, clientY: event.clientY };
      const point = origin;
      timer = schedule(() => show(point, target), 500);
    },
    onPointerMove(event) {
      if (origin && Math.hypot(event.clientX - origin.clientX, event.clientY - origin.clientY) > 10) cancel();
    },
    onPointerUp: stop,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu(event) {
      event.preventDefault();
      // Keyboard context menus have no pointer coordinates.
      if (!event.clientX && !event.clientY) menuOpened = false;
      const rect = event.currentTarget.getBoundingClientRect();
      const point = event.clientX || event.clientY ? event
        : { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      show(point, target);
    },
    onClick(event) {
      if (suppressClick && event.detail !== 0) { event.preventDefault(); return; }
      activate();
    },
    onKeyDown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      cancel();
      if (!event.repeat) activate();
    },
  });
  return { bind, cancel };
}
