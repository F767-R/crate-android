import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  isTranslated,
  playbackCurrentTrack,
  queue,
  queueVisible,
  saveQueue,
  trackTranslationCache,
} from '../stores/state.js';
import { armClickSuppression } from '../utils/clickSuppression.js';
import { playNextFromQueue } from '../utils/playbackControls.js';
import { translatedTrackText } from '../utils/metadata.js';

export default function QueuePanel() {
  const visible = queueVisible.value;
  const queueItems = queue.value;
  const itemRefs = useRef([]);
  const dragRef = useRef({
    active: false,
    dragging: false,
    sourceIndex: -1,
    targetIndex: -1,
    startY: 0,
    suppressClick: false,
  });

  const removeFromQueue = index => {
    queue.value = queue.value.filter((_, itemIndex) => itemIndex !== index);
    saveQueue();
  };

  const clearQueue = () => {
    queue.value = [];
    saveQueue();
  };

  const startDrag = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      active: true,
      dragging: false,
      sourceIndex: index,
      targetIndex: index,
      startY: event.clientY,
      suppressClick: false,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
  };

  useEffect(() => {
    const move = event => {
      const drag = dragRef.current;
      if (!drag.active) return;
      const distance = event.clientY - drag.startY;
      if (!drag.dragging && Math.abs(distance) < 8) return;

      drag.dragging = true;
      drag.suppressClick = true;
      const source = itemRefs.current[drag.sourceIndex];
      if (!source) return;
      source.classList.add('dragging');
      source.style.transform = `translateY(${distance}px)`;

      let targetIndex = drag.sourceIndex;
      if (distance > 0) {
        for (let index = drag.sourceIndex + 1; index < itemRefs.current.length; index++) {
          const element = itemRefs.current[index];
          if (!element) continue;
          const rect = element.getBoundingClientRect();
          if (event.clientY > rect.top + rect.height / 2) targetIndex = index;
        }
      } else {
        for (let index = drag.sourceIndex - 1; index >= 0; index--) {
          const element = itemRefs.current[index];
          if (!element) continue;
          const rect = element.getBoundingClientRect();
          if (event.clientY < rect.top + rect.height / 2) targetIndex = index;
        }
      }
      drag.targetIndex = targetIndex;
    };

    const end = () => {
      const drag = dragRef.current;
      if (!drag.active) return;
      const source = itemRefs.current[drag.sourceIndex];
      if (source) {
        source.classList.remove('dragging');
        source.style.transform = '';
      }

      if (drag.dragging && drag.sourceIndex !== drag.targetIndex) {
        const reordered = [...queue.value];
        const [item] = reordered.splice(drag.sourceIndex, 1);
        if (item) {
          reordered.splice(drag.targetIndex, 0, item);
          queue.value = reordered;
          saveQueue();
        }
      }

      const suppressClick = drag.dragging;
      dragRef.current = {
        active: false,
        dragging: false,
        sourceIndex: -1,
        targetIndex: -1,
        startY: 0,
        suppressClick,
      };
      if (suppressClick) {
        setTimeout(() => { dragRef.current.suppressClick = false; }, 0);
      }
    };

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
    };
  }, []);

  if (!visible) return null;

  return (
    <div id="queuePanel" class="queue-panel open">
      <div class="queue-container">
        <div class="queue-header">
          <h4>Up Next</h4>
          <button id="clearQueueBtn" title="Clear queue" onClick={clearQueue}>Clear</button>
          <button
            id="closeQueueBtn"
            title="Close queue"
            onClick={() => {
              queueVisible.value = false;
              armClickSuppression();
            }}
          >
            ✕
          </button>
        </div>
        <div class="queue-body" id="queueBody">
          {!queueItems.length ? (
            <div class="queue-empty">Queue is empty. Long-press a track to add it.</div>
          ) : queueItems.map((item, index) => {
            const display = translatedTrackText(item.track, isTranslated.value, trackTranslationCache.value);
            return (
              <div
                class={`queue-item ${item.track.Id === playbackCurrentTrack.value?.Id ? 'playing' : ''}`}
                key={`${item.track.Id}-${index}`}
                ref={element => { itemRefs.current[index] = element; }}
                onClick={event => {
                  if (dragRef.current.suppressClick || event.target.closest('button, .q-drag')) return;
                  playNextFromQueue(index);
                }}
              >
                <div
                  class="q-drag"
                  onPointerDown={event => startDrag(event, index)}
                  onClick={event => event.stopPropagation()}
                  title="Drag to reorder"
                >
                  ⋮⋮
                </div>
                <span class="q-idx">{index + 1}</span>
                <div class="q-info">
                  <div class="q-name">{display.title}</div>
                  <div class="q-artist">{display.artist}</div>
                </div>
                <button
                  class="q-remove"
                  onClick={event => {
                    event.stopPropagation();
                    removeFromQueue(index);
                  }}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
