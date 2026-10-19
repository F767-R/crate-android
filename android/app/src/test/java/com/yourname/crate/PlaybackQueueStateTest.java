package com.yourname.crate;

import static org.junit.Assert.*;
import java.util.Arrays;
import java.util.Collections;
import java.util.Random;
import org.junit.Test;

public class PlaybackQueueStateTest {
    private PlaybackQueueState.Track track(String id) {
        return new PlaybackQueueState.Track(id, id, "Artist", "Album", 180000L,
            "https://music.example/Audio/" + id + "/universal?UserId=user&PlaySessionId=old&StartTimeTicks=0",
            "https://music.example/Audio/" + id + "/stream?UserId=user&PlaySessionId=old", null);
    }
    private PlaybackQueueState state() {
        PlaybackQueueState state = new PlaybackQueueState(new Random(7));
        state.playSelection(Arrays.asList(track("a"), track("b"), track("c")), 0, false);
        return state;
    }

    @Test public void queueHasPriorityThenResumesOriginalSourceAfterSelectedTrack() {
        PlaybackQueueState state = state();
        state.replaceQueue(Arrays.asList(track("q1"), track("q2")));
        assertEquals(PlaybackQueueState.Advance.PLAY, state.next(true));
        assertEquals("q1", state.current.id);
        assertEquals(0, state.index);
        state.next(true);
        assertEquals("q2", state.current.id);
        state.next(true);
        assertEquals("b", state.current.id);
        assertEquals(1, state.index);
        assertFalse(state.currentFromQueue);
    }

    @Test public void replaceTailDoesNotReplaySourceAfterQueueDrains() {
        PlaybackQueueState state = state();
        state.replaceQueue(Collections.singletonList(track("discarded")));
        state.playSelection(Arrays.asList(track("a"), track("b"), track("c")), 1, true);
        assertEquals("b", state.current.id);
        assertEquals(2, state.index);
        assertEquals(1, state.queue.size());
        state.next(true);
        assertEquals("c", state.current.id);
        assertEquals(PlaybackQueueState.Advance.NONE, state.next(true));
    }

    @Test public void preserveQueueWhenSelectingAnotherSource() {
        PlaybackQueueState state = state();
        state.replaceQueue(Collections.singletonList(track("queued")));
        state.playSelection(Arrays.asList(track("x"), track("y")), 0, false);
        state.next(false);
        assertEquals("queued", state.current.id);
        state.next(true);
        assertEquals("y", state.current.id);
    }

    @Test public void clickingQueueEntryKeepsOthersAndSourceContinuation() {
        PlaybackQueueState state = state();
        state.replaceQueue(Arrays.asList(track("q1"), track("q2"), track("q3")));
        assertTrue(state.playQueueItem(1));
        assertEquals("q2", state.current.id);
        assertEquals("q1", state.queue.get(0).id);
        assertEquals("q3", state.queue.get(1).id);
        assertEquals(0, state.index);
    }

    @Test public void repeatOneAffectsNaturalEndButNotManualNext() {
        PlaybackQueueState state = state();
        state.setOptions("one", null, null);
        state.replaceQueue(Collections.singletonList(track("queued")));
        assertEquals(PlaybackQueueState.Advance.PLAY, state.next(true));
        assertEquals("a", state.current.id);
        assertEquals(1, state.queue.size());
        state.next(false);
        assertEquals("queued", state.current.id);
    }

    @Test public void repeatAllWrapsAfterTheSourceEnds() {
        PlaybackQueueState state = state();
        state.setOptions("all", null, null);
        state.next(true);
        state.next(true);
        state.next(true);
        assertEquals("a", state.current.id);
        assertEquals(0, state.index);
    }

    @Test public void repeatOffEndsWithoutChangingLastTrack() {
        PlaybackQueueState state = state();
        state.next(true);
        state.next(true);
        assertFalse(state.hasNext());
        assertEquals(PlaybackQueueState.Advance.NONE, state.next(true));
        assertEquals("c", state.current.id);
    }

    @Test public void previousRestartsAfterThreeSecondsOtherwiseSelectsPrevious() {
        PlaybackQueueState state = state();
        state.next(false);
        assertEquals(PlaybackQueueState.Advance.RESTART, state.previous(4000L));
        assertEquals("b", state.current.id);
        assertEquals(PlaybackQueueState.Advance.PLAY, state.previous(2000L));
        assertEquals("a", state.current.id);
    }

    @Test public void previousFromAQueuedTrackDoesNotDestroyContinuation() {
        PlaybackQueueState state = state();
        state.replaceQueue(Collections.singletonList(track("queued")));
        state.next(false);
        assertEquals(PlaybackQueueState.Advance.RESTART, state.previous(0L));
        state.next(false);
        assertEquals("b", state.current.id);
    }

    @Test public void shuffleAvoidsCurrentAndPreviousUsesHistory() {
        PlaybackQueueState state = state();
        state.setOptions(null, true, null);
        state.next(false);
        assertNotEquals("a", state.current.id);
        assertEquals(PlaybackQueueState.Advance.PLAY, state.previous(8000L));
        assertEquals("a", state.current.id);
    }

    @Test public void shuffleRestoresSourceAfterExplicitQueue() {
        PlaybackQueueState state = state();
        state.setOptions(null, true, null);
        state.replaceQueue(Collections.singletonList(track("queued")));
        state.next(false);
        state.next(false);
        assertNotEquals("queued", state.current.id);
        assertNotEquals("a", state.current.id);
        assertFalse(state.currentFromQueue);
    }

    @Test public void shuffleHistoryIsBounded() {
        PlaybackQueueState state = state();
        state.setOptions(null, true, null);
        for (int i = 0; i < 500; i++) state.next(false);
        assertEquals(200, state.shuffleHistory.size());
    }

    @Test public void sleepTrackTakesPriorityOverRepeatOneAndQueuedItems() {
        PlaybackQueueState state = state();
        state.setOptions("one", null, null);
        state.replaceQueue(Collections.singletonList(track("queued")));
        state.setSleep("track", 0L);
        assertEquals(PlaybackQueueState.Advance.STOP, state.next(true));
        assertEquals("a", state.current.id);
        assertEquals(1, state.queue.size());
        assertNull(state.sleepMode);
    }

    @Test public void sleepQueueWaitsUntilTheFinalQueuedTrackEnds() {
        PlaybackQueueState state = state();
        state.replaceQueue(Arrays.asList(track("q1"), track("q2")));
        state.setSleep("queue", 0L);
        state.next(true);
        assertFalse(state.sleepQueueDrained);
        state.next(true);
        assertEquals("q2", state.current.id);
        assertTrue(state.sleepQueueDrained);
        assertEquals(PlaybackQueueState.Advance.STOP, state.next(true));
        assertEquals("q2", state.current.id);
        assertNull(state.sleepMode);
    }

    @Test public void sleepEmptyQueueStopsAtCurrentTrackEnd() {
        PlaybackQueueState state = state();
        state.setSleep("queue", 0L);
        assertEquals(PlaybackQueueState.Advance.STOP, state.next(true));
    }

    @Test public void addingQueueItemsRearmsQueueSleepBeforeFinalTrackEnds() {
        PlaybackQueueState state = state();
        state.setSleep("queue", 0L);
        state.replaceQueue(Collections.singletonList(track("new")));
        assertFalse(state.sleepQueueDrained);
        assertEquals(PlaybackQueueState.Advance.PLAY, state.next(true));
        assertEquals("new", state.current.id);
    }

    @Test public void invalidOptionsDoNotPartiallyApply() {
        PlaybackQueueState state = state();
        try { state.setOptions("all", true, "invalid"); fail(); }
        catch (IllegalArgumentException expected) { }
        assertEquals("off", state.repeatMode);
        assertFalse(state.shuffleOn);
        assertEquals("low", state.quality);
    }

    @Test public void transcodeSeekReplacesOffsetAndRotatesSessionWithoutDroppingOtherParameters() {
        String url = track("a").lowUrl;
        String first = PlaybackQueueState.lowUrlAtPosition(url, 123000L);
        String second = PlaybackQueueState.lowUrlAtPosition(url, 123000L);
        assertTrue(first.contains("UserId=user"));
        assertTrue(first.contains("StartTimeTicks=1230000000"));
        assertEquals(1, first.split("StartTimeTicks=", -1).length - 1);
        assertEquals(1, first.split("PlaySessionId=", -1).length - 1);
        assertFalse(first.contains("PlaySessionId=old"));
        assertNotEquals(first, second);
    }

    @Test public void emptySourceAndMissingQueueEntryAreSafe() {
        PlaybackQueueState state = new PlaybackQueueState();
        assertEquals(PlaybackQueueState.Advance.NONE, state.next(false));
        assertEquals(PlaybackQueueState.Advance.NONE, state.previous(0L));
        assertFalse(state.playQueueItem(0));
    }
}
