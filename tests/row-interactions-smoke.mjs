import assert from 'node:assert/strict';
import { createRowInteractions } from '../src/utils/rowInteractions.js';

let scheduled = null;
let menus = [];
let activations = [];
const gestures = createRowInteractions(target => menus.push(target), {
  schedule(callback, delay) { assert.equal(delay, 500); scheduled = callback; return 1; },
  clear() { scheduled = null; },
});
const event = (extra = {}) => ({
  button: 0, isPrimary: true, clientX: 40, clientY: 60, detail: 1,
  preventDefault() { this.defaultPrevented = true; },
  currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }) },
  ...extra,
});
const a = gestures.bind({ track: { Id: 'A' } }, () => activations.push('A'));
const b = gestures.bind({ track: { Id: 'B' } }, () => activations.push('B'));
const hold = () => { assert(scheduled); const callback = scheduled; scheduled = null; callback(); };
const tap = handlers => { handlers.onPointerDown(event()); handlers.onPointerUp(); handlers.onClick(event()); };

tap(a);
assert.deepEqual(activations, ['A']);
assert.equal(scheduled, null, 'short taps do not leave a menu timer');
assert.equal(menus.length, 0);
a.onPointerDown(event());
hold();
a.onContextMenu(event());
a.onPointerUp();
a.onClick(event());
assert.equal(menus.length, 1, 'native contextmenu after a hold does not open twice');
assert.deepEqual(menus[0], { x: 40, y: 60, track: { Id: 'A' } });
assert.deepEqual(activations, ['A'], 'releasing a long press must not play the track');
tap(b);
assert.deepEqual(activations, ['A', 'B'], 'next tap remains usable');

for (const cancel of [() => a.onPointerMove(event({ clientX: 70 })), a.onPointerCancel, a.onPointerLeave, gestures.cancel]) {
  a.onPointerDown(event());
  cancel();
  assert.equal(scheduled, null, 'scroll, movement, cancellation and cleanup stop the pending hold');
  a.onPointerUp();
  a.onClick(event());
}
assert.equal(menus.length, 1);
assert.deepEqual(activations, ['A', 'B'], 'cancelled gestures cannot play a track');
a.onPointerDown(event());
b.onPointerDown(event());
hold();
assert.equal(menus.at(-1).track.Id, 'B', 'only the newest row can own the timer');

// Right-click and keyboard context menus can be reopened after a touch menu.
a.onPointerDown(event({ button: 2 }));
assert.equal(scheduled, null);
a.onContextMenu(event());
assert.equal(menus.at(-1).track.Id, 'A');
b.onContextMenu(event({ clientX: 0, clientY: 0 }));
assert.deepEqual(menus.at(-1), { x: 60, y: 40, track: { Id: 'B' } });
a.onKeyDown(event({ key: 'Enter' }));
a.onKeyDown(event({ key: ' ', repeat: true }));
a.onKeyDown(event({ key: 'ArrowDown' }));
assert.deepEqual(activations, ['A', 'B', 'A']);
a.onPointerDown(event());
a.onPointerDown(event({ isPrimary: false }));
assert.equal(scheduled, null, 'multitouch cancels the pending hold');
console.log('Row gestures passed: tap, hold, click suppression, movement/scroll/cancel/cleanup, right-click, keyboard and multitouch.');
