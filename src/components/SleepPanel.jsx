import { h } from 'preact';
import { useEffect, useState, useRef } from 'preact/hooks';
import {
  sleepMode,
  sleepDurationMinutes,
  sleepEndTime,
  sleepTimerId,
  sleepRefreshIntervalId,
  sleepOriginalQueueLength,
  sleepQueueDrained,
  sleepPanelVisible,
  queue,
  playbackPlaying
} from '../stores/state.js';
import { audioShim } from '../utils/playerShim.js';

export default function SleepPanel() {
  const [toast, setToast] = useState({ show: false, message: '' });
  const [refreshTick, setRefreshTick] = useState(0);
  const visible = sleepPanelVisible.value;

  // Load sleep state on mount
  useEffect(() => {
    loadSleepState();
  }, []);

  function loadSleepState() {
    try {
      const saved = localStorage.getItem('crateSleepTimer');
      if (!saved) return;
      const data = JSON.parse(saved);
      if (!data || !data.mode) {
        localStorage.removeItem('crateSleepTimer');
        return;
      }
      if (data.mode === 'duration' && data.endTime && Date.now() < data.endTime) {
        sleepEndTime.value = data.endTime;
        sleepMode.value = data.mode;
        sleepDurationMinutes.value = data.durationMinutes || 0;
        sleepOriginalQueueLength.value = data.originalQueueLength || 0;
        startSleepCountdown();
      } else if (data.mode === 'track' || data.mode === 'queue') {
        sleepMode.value = data.mode;
        sleepDurationMinutes.value = 0;
        sleepOriginalQueueLength.value = data.originalQueueLength || queue.value.length;
        sleepQueueDrained.value = false;
        startSleepCountdown();
      } else {
        localStorage.removeItem('crateSleepTimer');
      }
    } catch (_) {}
  }

  function saveSleepState() {
    try {
      localStorage.setItem('crateSleepTimer', JSON.stringify({
        endTime: sleepEndTime.value,
        mode: sleepMode.value,
        durationMinutes: sleepDurationMinutes.value,
        originalQueueLength: sleepOriginalQueueLength.value
      }));
    } catch (_) {}
  }

  function clearSleepState() {
    localStorage.removeItem('crateSleepTimer');
  }

  function startSleepCountdown() {
    if (sleepTimerId.value) {
      clearTimeout(sleepTimerId.value);
      sleepTimerId.value = null;
    }
    if (sleepRefreshIntervalId.value) {
      clearInterval(sleepRefreshIntervalId.value);
      sleepRefreshIntervalId.value = null;
    }
    if (sleepMode.value === 'duration' && sleepEndTime.value) {
      const remaining = sleepEndTime.value - Date.now();
      if (remaining <= 0) {
        triggerSleepStop();
        return;
      }
      sleepTimerId.value = setTimeout(() => {
        sleepTimerId.value = null;
        triggerSleepStop();
      }, remaining);
    }
  }

  // Tick once per second while the panel is open so the remaining-time
  // text updates in real time.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setRefreshTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [visible]);

  function triggerSleepStop() {
    if (sleepTimerId.value) {
      clearTimeout(sleepTimerId.value);
      sleepTimerId.value = null;
    }
    if (sleepRefreshIntervalId.value) {
      clearInterval(sleepRefreshIntervalId.value);
      sleepRefreshIntervalId.value = null;
    }
    sleepEndTime.value = null;
    sleepMode.value = null;
    sleepDurationMinutes.value = 0;
    sleepOriginalQueueLength.value = 0;
    sleepQueueDrained.value = false;
    clearSleepState();
    if (playbackPlaying.value) {
      audioShim.pause();
    }
    showToast('Sleep timer ended — playback paused');
  }

  function showToast(message, durationMs = 4000) {
    setToast({ show: true, message });
    setTimeout(() => setToast({ show: false, message: '' }), durationMs);
  }

  function cancelSleepTimer() {
    if (sleepTimerId.value) {
      clearTimeout(sleepTimerId.value);
      sleepTimerId.value = null;
    }
    if (sleepRefreshIntervalId.value) {
      clearInterval(sleepRefreshIntervalId.value);
      sleepRefreshIntervalId.value = null;
    }
    sleepEndTime.value = null;
    sleepMode.value = null;
    sleepDurationMinutes.value = 0;
    sleepOriginalQueueLength.value = 0;
    sleepQueueDrained.value = false;
    clearSleepState();
    showToast('Sleep timer cancelled');
  }

  function setSleepTimer(minutes, mode) {
    if (minutes === 0 && !mode) {
      cancelSleepTimer();
      sleepPanelVisible.value = false;
      return;
    }
    if (minutes === 0 && mode) {
      sleepMode.value = mode;
      sleepDurationMinutes.value = 0;
      sleepOriginalQueueLength.value = queue.value.length;
      sleepQueueDrained.value = false;
      sleepEndTime.value = null;
      saveSleepState();
      startSleepCountdown();
      sleepPanelVisible.value = false;
      showToast(mode === 'track' ? 'Sleep at end of track' : 'Sleep at end of queue', 2500);
      return;
    }
    sleepDurationMinutes.value = minutes;
    sleepMode.value = mode || 'duration';
    sleepOriginalQueueLength.value = queue.value.length;
    sleepQueueDrained.value = false;
    sleepEndTime.value = Date.now() + minutes * 60 * 1000;
    saveSleepState();
    startSleepCountdown();
    sleepPanelVisible.value = false;
    showToast(`Sleep timer set for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`, 2500);
  }

  function getSleepRemainingText() {
    if (!sleepEndTime.value && !sleepMode.value) return null;
    if (sleepMode.value === 'track') return 'Sleep: End of track';
    if (sleepMode.value === 'queue') return 'Sleep: End of queue';
    if (!sleepEndTime.value) return null;
    const remaining = Math.max(0, Math.ceil((sleepEndTime.value - Date.now()) / 1000));
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    if (h > 0) return `Sleep: ${h}h ${m}m ${s}s`;
    if (m > 0) return `Sleep: ${m}m ${s}s`;
    return `Sleep: ${s}s`;
  }

  function closePanel() {
    sleepPanelVisible.value = false;
  }

  if (!visible) {
    return toast.show ? (
      <div class="sleep-toast visible" onClick={() => setToast({ show: false, message: '' })}>
        {toast.message}
      </div>
    ) : null;
  }

  const remainingText = getSleepRemainingText();

  return (
    <div id="sleepPanel" class="sleep-panel open">
      <div class="sleep-container">
        <div class="sleep-panel-header">
          <h4>Sleep Timer {remainingText ? <small style="margin-left:8px;color:var(--muted);">{remainingText}</small> : null}</h4>
          <button id="closeSleepBtn" title="Close" aria-label="Close" onClick={closePanel}>✕</button>
        </div>
        <div class="sleep-panel-body">
          <div class="sleep-options-group">
            <div class="sleep-option-section-label">Timer</div>
            <button class={`sleep-option ${sleepMode.value === 'duration' && sleepDurationMinutes.value === 0 ? 'active' : (!sleepMode.value ? 'active' : '')}`} onClick={() => setSleepTimer(0)}>Off</button>
            <button class={`sleep-option ${sleepMode.value === 'duration' && sleepDurationMinutes.value === 15 ? 'active' : ''}`} onClick={() => setSleepTimer(15, 'duration')}>15 min</button>
            <button class={`sleep-option ${sleepMode.value === 'duration' && sleepDurationMinutes.value === 30 ? 'active' : ''}`} onClick={() => setSleepTimer(30, 'duration')}>30 min</button>
            <button class={`sleep-option ${sleepMode.value === 'duration' && sleepDurationMinutes.value === 45 ? 'active' : ''}`} onClick={() => setSleepTimer(45, 'duration')}>45 min</button>
            <button class={`sleep-option ${sleepMode.value === 'duration' && sleepDurationMinutes.value === 60 ? 'active' : ''}`} onClick={() => setSleepTimer(60, 'duration')}>60 min</button>
          </div>
          <div class="sleep-divider"></div>
          <div class="sleep-options-group">
            <div class="sleep-option-section-label">End condition</div>
            <button class={`sleep-option ${sleepMode.value === 'track' ? 'active' : ''}`} onClick={() => setSleepTimer(0, 'track')}>End of track</button>
            <button class={`sleep-option ${sleepMode.value === 'queue' ? 'active' : ''}`} onClick={() => setSleepTimer(0, 'queue')}>End of queue</button>
          </div>
        </div>
      </div>
      {toast.show && (
        <div class="sleep-toast visible" onClick={() => setToast({ show: false, message: '' })}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
