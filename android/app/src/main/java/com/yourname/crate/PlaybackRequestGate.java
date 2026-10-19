package com.yourname.crate;

/** Native arrival ordering for transport requests; no WebView-generated counters. */
final class PlaybackRequestGate {
    static final PlaybackRequestGate SHARED = new PlaybackRequestGate();

    private long selectionSequence;
    private boolean desiredPlaying;
    private Long requestedSeekPositionMs;

    synchronized long beginPlay() {
        selectionSequence++;
        desiredPlaying = true;
        requestedSeekPositionMs = null;
        return selectionSequence;
    }

    synchronized long stop() {
        selectionSequence++;
        desiredPlaying = false;
        requestedSeekPositionMs = null;
        return selectionSequence;
    }

    synchronized void setDesiredPlaying(boolean playing) {
        desiredPlaying = playing;
    }

    synchronized boolean isCurrent(long sequence) {
        return sequence == selectionSequence;
    }

    synchronized long currentSequence() {
        return selectionSequence;
    }

    /** A seek can arrive while a selected HD item is still waiting for service startup. */
    synchronized long requestSeek(long positionMs) {
        requestedSeekPositionMs = Math.max(0L, positionMs);
        return selectionSequence;
    }

    synchronized long initialPositionMs(long sequence, long fallbackPositionMs) {
        return sequence == selectionSequence && requestedSeekPositionMs != null
            ? requestedSeekPositionMs : Math.max(0L, fallbackPositionMs);
    }

    synchronized boolean shouldPlay(long sequence) {
        return sequence == selectionSequence && desiredPlaying;
    }
}
