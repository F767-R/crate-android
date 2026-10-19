package com.yourname.crate;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Main-thread protocol v2 state owner. Neither progression nor timers require a WebView. */
final class NativePlaybackCoordinator {
    interface Backend {
        void nativeLoad(PlaybackQueueState.Track track, String quality, long positionMs, boolean playing, boolean bypassCache);
        void nativePause();
        void nativeResume();
        void nativeSeekInPlace(long positionMs);
        void nativeStop();
        boolean nativeHasMedia();
        boolean nativeIsPlaying();
        boolean nativeWantsPlaying();
        boolean nativeIsBuffering();
        boolean nativeIsLocal();
        boolean nativeIsCached();
        long nativePositionMs();
        long nativeDurationMs();
        long nativeRequestId();
    }

    private final Backend backend;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AtomicFile savedFile;
    private final ThreadPoolExecutor writer = new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(1), new ThreadPoolExecutor.DiscardOldestPolicy());
    private PlaybackQueueState state = new PlaybackQueueState();
    private final String sessionId = UUID.randomUUID().toString();
    private String scope = "";
    private long revision;
    private long savedPositionMs;
    private long lastPersistElapsed;
    private long sleepDeadlineElapsed;
    private long handledEndRequest = -1L;
    private boolean active;
    private boolean initialized;
    private boolean restoredState;
    private boolean publishPending;
    private boolean closed;
    private boolean endedCurrent;
    private String playbackError;

    NativePlaybackCoordinator(Context context, Backend backend) {
        this.backend = backend;
        // Stream credentials must not enter Android's cloud/device-transfer backup.
        savedFile = new AtomicFile(new File(context.getNoBackupFilesDir(), "crate-playback-v2.json"));
        try {
            if (savedFile.getBaseFile().length() > PlaybackSessionCodec.MAX_STATE_BYTES) return;
            JSONObject saved = new JSONObject(new String(savedFile.readFully(), StandardCharsets.UTF_8));
            state = PlaybackSessionCodec.decode(saved);
            scope = saved.optString("scope", "");
            savedPositionMs = Math.max(0L, saved.optLong("positionMs", 0L));
            initialized = saved.optBoolean("initialized", false);
            endedCurrent = saved.optBoolean("ended", false);
            restoredState = true;
            active = true;
            // Do not prepare/play any restored URL until an explicit user action.
            scheduleSleep();
        } catch (Exception ignored) {
            // Missing/corrupt state is recoverable. Never log persisted URL-bearing data.
        }
    }

    boolean isActive() { return active; }
    boolean hasCurrent() { return state.current != null; }
    boolean hasNext() { return state.hasNext(); }
    long positionMs() { return backend.nativeHasMedia() ? backend.nativePositionMs() : savedPositionMs; }
    long durationMs() {
        long actual = backend.nativeHasMedia() ? backend.nativeDurationMs() : 0L;
        return actual > 0 ? actual : state.current == null ? 0L : state.current.durationMs;
    }

    JSObject configure(String nextScope) {
        if (nextScope == null || nextScope.isEmpty() || nextScope.length() > 8192) {
            throw new IllegalArgumentException("A nonempty playback server scope is required");
        }
        active = true;
        if (!scope.equals(nextScope)) {
            state = new PlaybackQueueState();
            scope = nextScope;
            savedPositionMs = 0L;
            initialized = false;
            restoredState = false;
            playbackError = null;
            endedCurrent = false;
            backend.nativeStop();
            scheduleSleep();
            changed();
        }
        return snapshot();
    }

    JSObject playSelection(JSONObject input) {
        List<PlaybackQueueState.Track> tracks = PlaybackSessionCodec.parseTracks(input.optJSONArray("tracks"));
        String mode = input.optString("queueMode", "preserve");
        if (!mode.equals("preserve") && !mode.equals("replace-tail")) throw new IllegalArgumentException("Invalid queue mode");
        int index = input.optInt("index", 0);
        if (index < 0 || index >= tracks.size()) throw new IllegalArgumentException("Choose a valid track selection");
        PlaybackSessionCodec.checkPersistable(tracks,
            mode.equals("replace-tail") ? tracks.subList(index + 1, tracks.size()) : state.queue, tracks.get(index));
        state.playSelection(tracks, index, mode.equals("replace-tail"));
        active = true;
        initialized = true;
        loadCurrent(input.optLong("positionMs", 0L), input.optBoolean("playWhenReady", true), false);
        return snapshot();
    }

    JSObject replaceQueue(JSONObject input) {
        checkRevision(input);
        List<PlaybackQueueState.Track> next = PlaybackSessionCodec.parseTracks(input.optJSONArray("queue"));
        PlaybackSessionCodec.checkPersistable(state.sourceTracks, next, state.current);
        state.replaceQueue(next);
        initialized = true;
        changed();
        return snapshot();
    }

    JSObject mutateQueue(JSONObject input) {
        checkRevision(input);
        String action = input.optString("action", "");
        int index = input.optInt("index", -1);
        List<PlaybackQueueState.Track> next = new ArrayList<>(state.queue);
        switch (action) {
            case "add": {
                if (state.queue.size() >= PlaybackQueueState.MAX_TRACKS) throw new IllegalArgumentException("Queue is too large");
                PlaybackQueueState.Track track = PlaybackSessionCodec.parseTrack(input.optJSONObject("track"));
                next.add(input.optString("position", "last").equals("next") ? 0 : next.size(), track);
                break;
            }
            case "remove":
                requireQueueIndex(index);
                next.remove(index);
                break;
            case "move": {
                requireQueueIndex(index);
                int destination = input.optInt("toIndex", -1);
                requireQueueIndex(destination);
                next.add(destination, next.remove(index));
                break;
            }
            case "clear": next.clear(); break;
            default: throw new IllegalArgumentException("Invalid queue action");
        }
        PlaybackSessionCodec.checkPersistable(state.sourceTracks, next, state.current);
        state.replaceQueue(next);
        initialized = true;
        changed();
        return snapshot();
    }

    JSObject playQueueItem(JSONObject input) {
        checkRevision(input);
        int index = input.optInt("index", 0);
        requireQueueIndex(index);
        state.playQueueItem(index);
        initialized = true;
        loadCurrent(0L, true, false);
        return snapshot();
    }

    private void requireQueueIndex(int index) {
        if (index < 0 || index >= state.queue.size()) throw new IllegalArgumentException("Queue item is no longer available");
    }

    private void checkRevision(JSONObject input) {
        if (input.has("expectedRevision") && !input.isNull("expectedRevision")
                && input.optLong("expectedRevision", -1L) != revision) {
            throw new IllegalStateException("stale_revision");
        }
    }

    JSObject setOptions(JSONObject input) {
        String repeat = PlaybackSessionCodec.nullable(input, "repeatMode");
        String quality = PlaybackSessionCodec.nullable(input, "quality");
        Boolean shuffle = input.has("shuffleOn") ? input.optBoolean("shuffleOn") : null;
        String previousQuality = state.quality;
        long position = positionMs();
        boolean playing = backend.nativeWantsPlaying();
        state.setOptions(repeat, shuffle, quality);
        if (!previousQuality.equals(state.quality) && state.current != null) loadCurrent(position, playing, false);
        else changed();
        return snapshot();
    }

    JSObject setSleep(JSONObject input) {
        String mode = PlaybackSessionCodec.nullable(input, "mode");
        long endTimeMs = input.optLong("endTimeMs", 0L);
        if ("duration".equals(mode) && endTimeMs <= 0) throw new IllegalArgumentException("A sleep deadline is required");
        state.setSleep(mode, endTimeMs);
        scheduleSleep();
        if ("duration".equals(mode) && endTimeMs <= System.currentTimeMillis()) expireSleep();
        else changed();
        return snapshot();
    }

    JSObject nextTrack() {
        PlaybackQueueState.Advance next = state.next(false);
        if (next == PlaybackQueueState.Advance.PLAY) loadCurrent(0L, true, false);
        return snapshot();
    }

    JSObject previousTrack() {
        PlaybackQueueState.Advance previous = state.previous(positionMs());
        if (previous == PlaybackQueueState.Advance.PLAY) loadCurrent(0L, true, false);
        else if (previous == PlaybackQueueState.Advance.RESTART) seekAbsolute(0L, null);
        return snapshot();
    }

    JSObject seekAbsolute(long requestedMs, Boolean playWhenReady) {
        if (state.current == null) return snapshot();
        endedCurrent = false;
        long duration = durationMs();
        long target = Math.max(0L, requestedMs);
        if (duration > 0) target = Math.min(target, Math.max(0L, duration - 1500L));
        boolean playing = playWhenReady == null ? backend.nativeWantsPlaying() : playWhenReady;
        if (backend.nativeHasMedia() && (backend.nativeIsLocal() || state.quality.equals("high"))) {
            backend.nativeSeekInPlace(target);
            if (playing) backend.nativeResume(); else backend.nativePause();
            savedPositionMs = target;
            changed();
        } else {
            loadCurrent(target, playing, false);
        }
        return snapshot();
    }

    JSObject retry() {
        if (state.current != null) loadCurrent(positionMs(), true, backend.nativeIsLocal());
        return snapshot();
    }

    void pause() {
        savedPositionMs = positionMs();
        backend.nativePause();
        changed();
    }

    void resume() {
        if (state.current == null) return;
        if (sleepExpired()) { expireSleep(); return; }
        if (endedCurrent) loadCurrent(0L, true, false);
        else if (!backend.nativeHasMedia() || playbackError != null) loadCurrent(savedPositionMs, true, false);
        else { backend.nativeResume(); changed(); }
    }

    void stop() {
        savedPositionMs = 0L;
        endedCurrent = false;
        backend.nativeStop();
        changed();
    }

    private void loadCurrent(long positionMs, boolean playing, boolean bypassCache) {
        if (state.current == null) return;
        if (sleepExpired()) { state.clearSleep(); scheduleSleep(); playing = false; }
        savedPositionMs = Math.max(0L, positionMs);
        playbackError = null;
        endedCurrent = false;
        backend.nativeLoad(state.current, state.quality, savedPositionMs, playing, bypassCache);
        changed();
    }

    void ended() {
        long requestId = backend.nativeRequestId();
        if (requestId == handledEndRequest) return;
        handledEndRequest = requestId;
        endedCurrent = true;
        savedPositionMs = durationMs();
        PlaybackQueueState.Advance next = state.next(true);
        if (next == PlaybackQueueState.Advance.PLAY) loadCurrent(0L, true, false);
        else {
            backend.nativePause();
            scheduleSleep();
            changed();
        }
    }

    void failed(String message) {
        savedPositionMs = positionMs();
        playbackError = message;
        backend.nativePause();
        changed();
    }

    void stateChanged() {
        if (active && !closed) changed();
    }

    void positionTick() {
        if (!active || closed) return;
        if (sleepExpired()) expireSleep();
        savedPositionMs = positionMs();
        MediaBridgePlugin.emitPlaybackPosition(compact());
        if (SystemClock.elapsedRealtime() - lastPersistElapsed > 10000L) persist();
    }

    void updateMetadata(String id, String title, String artist, String artUrl, long durationMs) {
        if (state.current == null || !state.current.id.equals(id)) return;
        state.current = metadata(state.current, title, artist, artUrl, durationMs);
        for (int i = 0; i < state.sourceTracks.size(); i++) {
            PlaybackQueueState.Track track = state.sourceTracks.get(i);
            if (track.id.equals(id)) state.sourceTracks.set(i, metadata(track, title, artist, artUrl, durationMs));
        }
        for (int i = 0; i < state.queue.size(); i++) {
            PlaybackQueueState.Track track = state.queue.get(i);
            if (track.id.equals(id)) state.queue.set(i, metadata(track, title, artist, artUrl, durationMs));
        }
        changed();
    }

    private PlaybackQueueState.Track metadata(PlaybackQueueState.Track track, String title,
            String artist, String artUrl, long durationMs) {
        return new PlaybackQueueState.Track(track.id, title == null ? track.title : title,
            artist == null ? track.artist : artist, track.albumId,
            durationMs > 0 ? durationMs : track.durationMs, track.lowUrl, track.highUrl,
            artUrl == null ? track.artUrl : artUrl, track.originalTitle, track.originalArtist,
            track.albumTitle, track.originalAlbumTitle, track.trackNumber, track.discNumber);
    }

    private final Runnable sleepTimer = this::expireSleep;
    private void scheduleSleep() {
        handler.removeCallbacks(sleepTimer);
        sleepDeadlineElapsed = 0L;
        if ("duration".equals(state.sleepMode)) {
            long remaining = Math.max(0L, state.sleepEndTimeMs - System.currentTimeMillis());
            sleepDeadlineElapsed = SystemClock.elapsedRealtime() + remaining;
            handler.postDelayed(sleepTimer, remaining);
        }
    }
    private boolean sleepExpired() {
        return "duration".equals(state.sleepMode) && sleepDeadlineElapsed > 0L
            && SystemClock.elapsedRealtime() >= sleepDeadlineElapsed;
    }
    private void expireSleep() {
        if (closed || !"duration".equals(state.sleepMode)) return;
        savedPositionMs = positionMs();
        state.clearSleep();
        sleepDeadlineElapsed = 0L;
        backend.nativePause();
        changed();
    }

    private JSObject compact() {
        JSObject value = new JSObject();
        value.put("supported", true);
        value.put("protocolVersion", 2);
        value.put("sessionId", sessionId);
        value.put("revision", revision);
        value.put("eventRequestId", backend.nativeRequestId());
        value.put("currentTrackId", state.current == null ? JSONObject.NULL : state.current.id);
        value.put("positionMs", positionMs());
        value.put("durationMs", durationMs());
        value.put("isPlaying", backend.nativeIsPlaying());
        value.put("desiredPlaying", backend.nativeWantsPlaying());
        value.put("buffering", backend.nativeIsBuffering());
        value.put("isLocal", backend.nativeIsLocal());
        value.put("cached", backend.nativeIsCached());
        value.put("quality", state.quality);
        if (playbackError == null) value.put("error", JSONObject.NULL);
        else {
            JSObject error = new JSObject();
            error.put("message", playbackError);
            error.put("code", "native_playback");
            error.put("retryable", true);
            value.put("error", error);
        }
        return value;
    }

    JSObject snapshot() {
        JSObject value = compact();
        value.put("currentTrack", state.current == null ? JSONObject.NULL : PlaybackSessionCodec.track(state.current, false));
        value.put("sourceTracks", PlaybackSessionCodec.tracks(state.sourceTracks, false));
        value.put("index", state.index);
        value.put("queue", PlaybackSessionCodec.tracks(state.queue, false));
        value.put("repeatMode", state.repeatMode);
        value.put("shuffleOn", state.shuffleOn);
        value.put("sleep", PlaybackSessionCodec.sleep(state));
        value.put("initialized", initialized);
        value.put("restoredState", restoredState);
        return value;
    }

    /** Small UI projection: no URLs or full queue/source copies on position updates. */
    JSObject screenSnapshot() {
        JSObject value = compact();
        value.put("currentTrack", state.current == null ? JSONObject.NULL : PlaybackSessionCodec.track(state.current, false));
        return value;
    }

    private void changed() {
        if (closed) return;
        revision++;
        if (publishPending) return;
        publishPending = true;
        handler.post(() -> {
            publishPending = false;
            if (closed) return;
            MediaBridgePlugin.emitPlaybackSnapshot(snapshot());
            persist();
        });
    }

    private void persist() {
        if (!active || writer.isShutdown()) return;
        lastPersistElapsed = SystemClock.elapsedRealtime();
        JSObject saved = PlaybackSessionCodec.encode(state, scope, positionMs());
        saved.put("initialized", initialized);
        saved.put("ended", endedCurrent);
        byte[] bytes = saved.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > PlaybackSessionCodec.MAX_STATE_BYTES) return;
        writer.execute(() -> {
            FileOutputStream output = null;
            try {
                output = savedFile.startWrite();
                output.write(bytes);
                savedFile.finishWrite(output);
            } catch (Exception ignored) {
                if (output != null) savedFile.failWrite(output);
            }
        });
    }

    void close() {
        persist();
        closed = true;
        handler.removeCallbacksAndMessages(null);
        writer.shutdown();
    }
}
