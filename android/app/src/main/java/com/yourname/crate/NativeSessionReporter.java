package com.yourname.crate;

import android.net.Uri;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Best-effort Jellyfin session reporting continues while the WebView is suspended. */
final class NativeSessionReporter {
    private final ThreadPoolExecutor requests = new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(32), new ThreadPoolExecutor.DiscardOldestPolicy());
    private PlaybackQueueState.Track current;
    private boolean started;
    private boolean lastPaused;
    private String playMethod = "Transcode";
    private long lastProgressElapsed;

    void prepare(PlaybackQueueState.Track track, long previousPositionMs) {
        stop(previousPositionMs);
        current = track;
        started = false;
        lastProgressElapsed = 0L;
    }

    void state(boolean playing, boolean desiredPlaying, long positionMs, boolean transcode) {
        if (current == null) return;
        playMethod = transcode ? "Transcode" : "DirectPlay";
        if (!started && playing) {
            started = true;
            lastPaused = false;
            report("Playing", current, positionMs, false);
            lastProgressElapsed = SystemClock.elapsedRealtime();
        } else if (started && lastPaused != !desiredPlaying) {
            lastPaused = !desiredPlaying;
            report("Playing/Progress", current, positionMs, lastPaused);
            lastProgressElapsed = SystemClock.elapsedRealtime();
        }
    }

    void progress(long positionMs, boolean paused, boolean force) {
        if (!started || current == null) return;
        long now = SystemClock.elapsedRealtime();
        if (!force && now - lastProgressElapsed < 10000L) return;
        lastProgressElapsed = now;
        lastPaused = paused;
        report("Playing/Progress", current, positionMs, paused);
    }

    void stop(long positionMs) {
        if (started && current != null) report("Playing/Stopped", current, positionMs, true);
        current = null;
        started = false;
    }

    private void report(String endpoint, PlaybackQueueState.Track track, long positionMs, boolean paused) {
        if (requests.isShutdown()) return;
        try {
            Uri source = Uri.parse(track.lowUrl);
            String path = source.getPath();
            int audioPath = path == null ? -1 : path.indexOf("/Audio/");
            String currentToken = source.getQueryParameter("ApiKey");
            String token = currentToken != null ? currentToken : source.getQueryParameter("api_key");
            if (audioPath < 0 || token == null || token.isEmpty()) return;
            String address = source.buildUpon().path(path.substring(0, audioPath) + "/Sessions/" + endpoint)
                .clearQuery().fragment(null).build().toString();
            String device = source.getQueryParameter("DeviceId");
            String deviceId = device == null ? "crate-android" : device.replaceAll("[^A-Za-z0-9_.-]", "");
            JSObject body = new JSObject();
            body.put("ItemId", track.id);
            body.put("PositionTicks", Math.max(0L, positionMs) * 10000L);
            body.put("IsPaused", paused);
            body.put("CanSeek", true);
            body.put("PlayMethod", playMethod);
            String userId = source.getQueryParameter("UserId");
            if (userId != null && !userId.isEmpty()) body.put("UserId", userId);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            requests.execute(() -> {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(address).openConnection();
                    connection.setRequestMethod("POST");
                    connection.setConnectTimeout(5000);
                    connection.setReadTimeout(5000);
                    connection.setInstanceFollowRedirects(false);
                    connection.setRequestProperty("Content-Type", "application/json");
                    connection.setRequestProperty("Authorization", "MediaBrowser Client=\"C.R.A.T.E.\", Device=\"Android\", DeviceId=\""
                        + deviceId + "\", Version=\"2.0\", Token=\"" + token + "\"");
                    connection.setFixedLengthStreamingMode(bytes.length);
                    connection.setDoOutput(true);
                    try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                    connection.getResponseCode();
                } catch (Exception ignored) {
                    // Reporting failure must not stop playback or expose URL/token diagnostics.
                } finally {
                    if (connection != null) connection.disconnect();
                }
            });
        } catch (Exception ignored) { }
    }

    void close(long positionMs) {
        stop(positionMs);
        requests.shutdown();
    }
}
