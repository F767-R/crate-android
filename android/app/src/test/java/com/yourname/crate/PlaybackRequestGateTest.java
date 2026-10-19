package com.yourname.crate;

import static org.junit.Assert.*;
import org.junit.Test;

public class PlaybackRequestGateTest {
    @Test public void newerPlayInvalidatesEarlierDeferredStarts() {
        PlaybackRequestGate gate = new PlaybackRequestGate();
        long first = gate.beginPlay();
        long second = gate.beginPlay();
        assertFalse(gate.isCurrent(first));
        assertFalse(gate.shouldPlay(first));
        assertTrue(gate.isCurrent(second));
        assertTrue(gate.shouldPlay(second));
    }

    @Test public void delayedCallbacksCannotPromoteTheirOldToken() {
        PlaybackRequestGate gate = new PlaybackRequestGate();
        long stale = gate.beginPlay();
        long latest = gate.beginPlay();
        // Both the immediate and 300 ms callbacks only check the captured token.
        assertFalse(gate.isCurrent(stale));
        assertFalse(gate.isCurrent(stale));
        assertEquals(latest, gate.currentSequence());
    }

    @Test public void pauseDuringColdStartKeepsSelectionButDoesNotAutoPlay() {
        PlaybackRequestGate gate = new PlaybackRequestGate();
        long selected = gate.beginPlay();
        gate.setDesiredPlaying(false);
        assertTrue(gate.isCurrent(selected));
        assertFalse(gate.shouldPlay(selected));
    }

    @Test public void resumeAfterPendingPauseAppliesToSelectedTrack() {
        PlaybackRequestGate gate = new PlaybackRequestGate();
        long oldTrack = gate.beginPlay();
        long selected = gate.beginPlay();
        gate.setDesiredPlaying(false);
        gate.setDesiredPlaying(true);
        assertTrue(gate.shouldPlay(selected));
        assertFalse(gate.shouldPlay(oldTrack));
    }

    @Test public void queuedPauseUsesLatestIntentInsteadOfUndoingResume() {
        PlaybackRequestGate gate = new PlaybackRequestGate();
        long selected = gate.beginPlay();
        gate.setDesiredPlaying(false);
        gate.setDesiredPlaying(true);
        // Service callbacks query current intent when their main-thread work executes.
        assertTrue(gate.shouldPlay(selected));
        assertTrue(gate.shouldPlay(selected));
    }

    @Test public void stopInvalidatesPendingPlayEvenIfResumeFollows() {
        PlaybackRequestGate gate = new PlaybackRequestGate();
        long pending = gate.beginPlay();
        long stopped = gate.stop();
        assertFalse(gate.isCurrent(pending));
        assertFalse(gate.shouldPlay(pending));
        gate.setDesiredPlaying(true);
        assertFalse(gate.shouldPlay(pending));
        assertTrue(gate.isCurrent(stopped));
    }

    @Test public void oldStopAndSeekCannotApplyAfterAnotherSelection() {
        PlaybackRequestGate gate = new PlaybackRequestGate();
        gate.beginPlay();
        long seekSelection = gate.currentSequence();
        long stopSelection = gate.stop();
        long latest = gate.beginPlay();
        assertFalse(gate.isCurrent(seekSelection));
        assertFalse(gate.isCurrent(stopSelection));
        assertTrue(gate.shouldPlay(latest));
    }

    @Test public void pendingHdSelectionUsesLatestSeekWithoutLosingPauseIntent() {
        PlaybackRequestGate gate = new PlaybackRequestGate();
        long selected = gate.beginPlay();
        gate.setDesiredPlaying(false);
        assertEquals(selected, gate.requestSeek(30_000L));
        gate.requestSeek(90_000L);
        assertEquals(90_000L, gate.initialPositionMs(selected, 5_000L));
        assertFalse(gate.shouldPlay(selected));
        assertTrue(gate.isCurrent(selected));
    }

    @Test public void aNewSelectionDoesNotInheritPreviousSeekOverride() {
        PlaybackRequestGate gate = new PlaybackRequestGate();
        gate.beginPlay();
        gate.requestSeek(90_000L);
        long selected = gate.beginPlay();
        assertEquals(5_000L, gate.initialPositionMs(selected, 5_000L));
    }

    @Test public void stopClearsPendingSeekAndNegativePositionsAreClamped() {
        PlaybackRequestGate gate = new PlaybackRequestGate();
        long selected = gate.beginPlay();
        gate.requestSeek(-10L);
        assertEquals(0L, gate.initialPositionMs(selected, 5_000L));
        long stopped = gate.stop();
        assertEquals(7_000L, gate.initialPositionMs(stopped, 7_000L));
    }
}
