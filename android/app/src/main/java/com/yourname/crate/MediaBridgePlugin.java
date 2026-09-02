package com.yourname.crate;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS <-> native bridge for audio playback.
 *
 * JS calls (commands):  playStream, pause, resume, seek, stop, setVolume
 * Native events:        stateChanged, trackEnded, error
 *
 * The native side now OWNS playback (ExoPlayer inside PlaybackService).
 * The JS side is the UI; the native side is the source of truth.
 *
 * Every @PluginMethod here runs on Capacitor's background "CapacitorPlugins"
 * thread, never the main thread. PlaybackService's methods post the actual
 * ExoPlayer touches onto the main thread internally, so this class doesn't
 * need to worry about that -- except for getState(), which used to read
 * player state synchronously and had to be made properly async instead.
 */
@CapacitorPlugin(name = "MediaBridge")
public class MediaBridgePlugin extends Plugin {

    private static MediaBridgePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Reads a numeric plugin argument without Capacitor's Long-only trap. */
    private static long numberArg(PluginCall call, String name, long defaultValue) {
        Object value = call.getData().opt(name);
        return value instanceof Number ? ((Number) value).longValue() : defaultValue;
    }

    // ===== JS -> Native commands =====

    @PluginMethod
    public void playStream(PluginCall call) {
        String url = call.getString("url");
        // NOTE: call.getLong() is unusable here — Capacitor's getLong only
        // accepts values already boxed as Long, but org.json parses JSON
        // integers as Integer, so EVERY numeric argument silently fell
        // back to the default (0). That zeroed every seek offset at the
        // bridge. Read Numbers generically instead.
        long startPositionMs = numberArg(call, "startPositionMs", 0L);
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String artUrl = call.getString("artUrl", null);
        long durationMs = numberArg(call, "durationMs", 0L);
        // Opt-in file caching: the web layer enables it only for the LQ
        // preset (small Opus files). Lossless FLAC streams are too large
        // to mirror on disk and are never downloaded.
        boolean allowCache = call.getBoolean("cache", Boolean.TRUE);

        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        PlaybackService service = PlaybackService.getInstance();
        if (service == null) {
            // Cold-start race: the WebView can be interactive before
            // MainActivity's startForegroundService() has finished creating
            // the service. Boot it now and defer the play command onto the
            // main looper — that runnable is enqueued AFTER the pending
            // service-create transaction, so onCreate() has run by then.
            PlaybackService.ensureStarted(getContext());
            final String fUrl = url;
            final long fStart = startPositionMs;
            final String fTitle = title;
            final String fArtist = artist;
            final String fArt = artUrl;
            final long fDur = durationMs;
            final boolean fCache = allowCache;
            android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
            main.post(() -> {
                PlaybackService s1 = PlaybackService.getInstance();
                if (s1 != null) {
                    s1.playStream(fUrl, fStart, fTitle, fArtist, fArt, fDur, fCache);
                    call.resolve();
                    return;
                }
                main.postDelayed(() -> {
                    PlaybackService s2 = PlaybackService.getInstance();
                    if (s2 != null) {
                        s2.playStream(fUrl, fStart, fTitle, fArtist, fArt, fDur, fCache);
                        call.resolve();
                    } else {
                        call.reject("PlaybackService failed to start");
                    }
                }, 300);
            });
            return;
        }
        service.playStream(url, startPositionMs, title, artist, artUrl, durationMs, allowCache);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        PlaybackService service = PlaybackService.getInstance();
        if (service != null) service.pause();
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        PlaybackService service = PlaybackService.getInstance();
        if (service != null) service.resume();
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        long positionMs = numberArg(call, "positionMs", 0L);
        PlaybackService service = PlaybackService.getInstance();
        if (service != null) service.seek(positionMs);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        PlaybackService service = PlaybackService.getInstance();
        if (service != null) service.stop();
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        double level = call.getDouble("level", 1.0);
        PlaybackService service = PlaybackService.getInstance();
        if (service != null) service.setVolume((float) level);
        call.resolve();
    }

    /**
     * Downloads the full audio file to the local file cache so it can
     * be played locally (instant seeking, no re-buffering). The call
     * returns immediately; the download happens on a background thread.
     * Pass the stream URL and the Jellyfin item ID.
     */
    @PluginMethod
    public void downloadToCache(PluginCall call) {
        String url = call.getString("url");
        String itemId = call.getString("itemId");
        if (url == null || url.isEmpty() || itemId == null || itemId.isEmpty()) {
            call.reject("url and itemId are required");
            return;
        }
        PlaybackService service = PlaybackService.getInstance();
        if (service == null) {
            call.reject("PlaybackService not running");
            return;
        }
        service.downloadFileToCache(url, itemId);
        call.resolve();
    }

    /**
     * Returns true if the full audio file for this item has already
     * been downloaded and is available in the local cache. The JS can
     * use this to show a "cached" indicator or skip the streaming URL
     * and play the local file directly.
     */
    @PluginMethod
    public void isCached(PluginCall call) {
        String itemId = call.getString("itemId");
        if (itemId == null || itemId.isEmpty()) {
            call.reject("itemId is required");
            return;
        }
        PlaybackService service = PlaybackService.getInstance();
        boolean cached = service != null && service.isCached(itemId);
        JSObject ret = new JSObject();
        ret.put("cached", cached);
        call.resolve(ret);
    }

    /**
     * Returns whether POST_NOTIFICATIONS is granted. On Android 13+ with
     * targetSdk 33+, SystemUI builds the quick-settings media carousel
     * and lockscreen widget FROM the app's posted media-style
     * notification — if posting is suppressed by a missing grant, the
     * widget never appears even though the MediaSession itself is fully
     * active and healthy.
     */
    @PluginMethod
    public void notificationsEnabled(PluginCall call) {
        boolean enabled = androidx.core.app.NotificationManagerCompat
            .from(getContext()).areNotificationsEnabled();
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    /**
     * Updates the now-playing metadata displayed on the lockscreen /
     * notification / quick-settings tile. The actual metadata is set
     * directly by PlaybackService when it sets up the MediaSession, so
     * this is just a no-op ack from the JS side — we resolve immediately
     * so the JS promise doesn't hang.
     */
    @PluginMethod
    public void updateNowPlaying(PluginCall call) {
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String artUrl = call.getString("artUrl", null);
        long durationMs = numberArg(call, "duration", 0L);
        PlaybackService service = PlaybackService.getInstance();
        if (service == null) {
            call.resolve();
            return;
        }
        service.updateNowPlaying(title, artist, artUrl, durationMs);
        call.resolve();
    }

    /**
     * Mirrors playback state (isPlaying + position) to the native
     * MediaSession for lockscreen / headset controls. PlaybackService
     * already owns the MediaSession and updates it directly from
     * ExoPlayer's listener callbacks, so this is a no-op ack.
     */
    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        PlaybackService service = PlaybackService.getInstance();
        if (service == null) {
            JSObject ret = new JSObject();
            ret.put("isPlaying", false);
            ret.put("position", 0L);
            ret.put("duration", 0L);
            call.resolve(ret);
            return;
        }
        // Async now: the read has to happen on the main thread (see
        // PlaybackService.getStateAsync), so we resolve the call from
        // inside the callback rather than returning immediately.
        service.getStateAsync((isPlaying, position, duration, isLocal, isBuffering) -> {
            JSObject ret = new JSObject();
            ret.put("isPlaying", isPlaying);
            ret.put("position", position);
            ret.put("duration", duration);
            ret.put("isLocal", isLocal);
            ret.put("buffering", isBuffering);
            call.resolve(ret);
        });
    }

    // ===== Native -> JS events =====

    public static void emitState(boolean isPlaying, long positionMs, long durationMs,
                                 boolean isLocal, boolean isBuffering) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("isPlaying", isPlaying);
        data.put("position", positionMs);
        data.put("duration", durationMs);
        data.put("isLocal", isLocal);
        data.put("buffering", isBuffering);
        instance.notifyListeners("stateChanged", data);
    }

    /**
     * A seek arrived from OUTSIDE the app UI — lockscreen/quick-settings
     * media card, headset, Bluetooth AVRCP. Those go through the
     * MediaSession straight into the player, which silently clamps to 0
     * on unseekable (chunked transcode) streams. The service forwards
     * them here so the web layer can apply its full seek strategy
     * (cache-file absolute seek, or StartTimeTicks restart).
     */
    public static void emitSessionSeek(long positionMs) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("positionMs", positionMs);
        instance.notifyListeners("sessionSeek", data);
    }

    /** The background download for itemId finished; the item is now on disk. */
    public static void emitCacheReady(String itemId) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("itemId", itemId);
        instance.notifyListeners("cacheReady", data);
    }

    public static void emitTrackEnded() {
        if (instance == null) return;
        instance.notifyListeners("trackEnded", new JSObject());
    }

    public static void emitError(String message) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("message", message);
        instance.notifyListeners("error", data);
    }

    public static void emitNext() {
        if (instance == null) return;
        instance.notifyListeners("next", new JSObject());
    }

    public static void emitPrev() {
        if (instance == null) return;
        instance.notifyListeners("prev", new JSObject());
    }
}