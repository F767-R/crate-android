package com.yourname.crate;

import android.graphics.Bitmap;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS <-> native bridge.
 *
 * JS calls: updateNowPlaying(...), updatePlaybackState(...), and the
 * native shim helpers used by the web player (`playStream`, `pause`,
 * `seek`, `prefetch`, etc.). Native fires events back such as
 * `nativePlay`, `nativePause`, `nativeNext`, `nativePrev`, `nativeSeek`,
 * and `stateChanged`.
 */
@CapacitorPlugin(name = "MediaBridge")
public class MediaBridgePlugin extends Plugin {

    // Static so PlaybackService (which has no direct handle to the
    // active plugin instance) can push events into JS.
    private static MediaBridgePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    public static void notifyJs(String eventName, JSObject data) {
        if (instance != null) {
            instance.notifyListeners(eventName, data != null ? data : new JSObject());
        }
    }

    public static void notifySeek(long positionMs) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("position", positionMs);
            instance.notifyListeners("nativeSeek", data);
        }
    }

    public static void notifyStateChanged(boolean isPlaying, long positionMs, long durationMs) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("isPlaying", isPlaying);
            data.put("position", positionMs);
            data.put("duration", durationMs);
            instance.notifyListeners("stateChanged", data);
        }
    }

    @PluginMethod
    public void updateNowPlaying(PluginCall call) {
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String artUrl = call.getString("artUrl", null);
        long duration = call.getLong("duration", 0L);

        PlaybackService service = PlaybackService.getInstance();
        if (service == null) {
            call.reject("Playback service not running");
            return;
        }

        if (artUrl != null && !artUrl.isEmpty()) {
            new Thread(() -> {
                Bitmap art = fetchBitmap(artUrl);
                service.updateMetadata(title, artist, art, duration);
                call.resolve();
            }).start();
        } else {
            service.updateMetadata(title, artist, null, duration);
            call.resolve();
        }
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        boolean isPlaying = call.getBoolean("isPlaying", false);
        long position = call.getLong("position", 0L);

        PlaybackService service = PlaybackService.getInstance();
        if (service == null) {
            call.reject("Playback service not running");
            return;
        }
        service.updatePlaybackState(isPlaying, position);
        call.resolve();
    }

    @PluginMethod
    public void prefetch(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void playStream(PluginCall call) {
        PlaybackService service = PlaybackService.getInstance();
        if (service == null) {
            call.resolve();
            return;
        }

        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String artUrl = call.getString("artUrl", null);
        long durationMs = call.getLong("durationMs", 0L);

        if (artUrl != null && !artUrl.isEmpty()) {
            new Thread(() -> {
                Bitmap art = fetchBitmap(artUrl);
                service.updateMetadata(title, artist, art, durationMs);
                service.updatePlaybackState(true, 0L);
                call.resolve();
            }).start();
        } else {
            service.updateMetadata(title, artist, null, durationMs);
            service.updatePlaybackState(true, 0L);
            call.resolve();
        }
    }

    @PluginMethod
    public void pause(PluginCall call) {
        PlaybackService service = PlaybackService.getInstance();
        if (service == null) {
            call.resolve();
            return;
        }
        service.updatePlaybackState(false, service.getCurrentPositionMs());
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        PlaybackService service = PlaybackService.getInstance();
        if (service == null) {
            call.resolve();
            return;
        }
        service.updatePlaybackState(true, service.getCurrentPositionMs());
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        long positionMs = call.getLong("positionMs", 0L);
        PlaybackService service = PlaybackService.getInstance();
        if (service == null) {
            call.resolve();
            return;
        }
        service.updatePlaybackState(service.isCurrentlyPlaying(), positionMs);
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        // The web app handles actual volume changes in the JS layer; the
        // native shell just needs to accept the method so the UI bridge is
        // compatible when running in Android.
        call.resolve();
    }

    private Bitmap fetchBitmap(String urlString) {
        try {
            java.net.URL url = new java.net.URL(urlString);
            java.io.InputStream in = url.openStream();
            return android.graphics.BitmapFactory.decodeStream(in);
        } catch (Exception e) {
            return null;
        }
    }
}
