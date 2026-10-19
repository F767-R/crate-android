package com.yourname.crate;

import com.getcapacitor.JSObject;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Network URLs are input/persistence-only and are never included in UI snapshots. */
final class PlaybackSessionCodec {
    static final int MAX_STATE_BYTES = 16 * 1024 * 1024;

    static void checkPersistable(List<PlaybackQueueState.Track> source, List<PlaybackQueueState.Track> queue,
                                 PlaybackQueueState.Track current) {
        long bytes = 256 * 1024; // reserve for scope, history and a differently sized next/current track
        for (PlaybackQueueState.Track item : source) bytes += privateSize(item);
        for (PlaybackQueueState.Track item : queue) bytes += privateSize(item);
        if (current != null) bytes += privateSize(current);
        if (bytes > MAX_STATE_BYTES) {
            throw new IllegalArgumentException("Playback selection is too large to save safely. Choose a smaller list.");
        }
    }

    private static int privateSize(PlaybackQueueState.Track track) {
        return track(track, true).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length + 1;
    }
    static PlaybackQueueState.Track parseTrack(JSONObject value) {
        if (value == null) throw new IllegalArgumentException("Missing track descriptor");
        String id = value.optString("id", "");
        if (id.isEmpty() || id.length() > 512) throw new IllegalArgumentException("Invalid track ID");
        return new PlaybackQueueState.Track(id, value.optString("title", ""),
            value.optString("artist", ""), nullable(value, "albumId"), value.optLong("durationMs", 0L),
            checkedUrl(value.optString("lowUrl", "")), checkedUrl(value.optString("highUrl", "")),
            optionalUrl(nullable(value, "artUrl")), nullable(value, "originalTitle"),
            nullable(value, "originalArtist"), nullable(value, "albumTitle"),
            nullable(value, "originalAlbumTitle"), value.optInt("trackNumber", 0), value.optInt("discNumber", 0));
    }

    static List<PlaybackQueueState.Track> parseTracks(JSONArray values) {
        if (values == null || values.length() > PlaybackQueueState.MAX_TRACKS) {
            throw new IllegalArgumentException("Invalid or oversized track list");
        }
        List<PlaybackQueueState.Track> tracks = new ArrayList<>();
        for (int index = 0; index < values.length(); index++) tracks.add(parseTrack(values.optJSONObject(index)));
        return tracks;
    }

    static JSObject track(PlaybackQueueState.Track track, boolean privateUrls) {
        if (track == null) return null;
        JSObject value = new JSObject();
        value.put("id", track.id);
        value.put("title", track.title);
        value.put("artist", track.artist);
        value.put("albumId", track.albumId == null ? JSONObject.NULL : track.albumId);
        value.put("durationMs", track.durationMs);
        value.put("originalTitle", track.originalTitle);
        value.put("originalArtist", track.originalArtist);
        value.put("albumTitle", track.albumTitle);
        value.put("originalAlbumTitle", track.originalAlbumTitle);
        value.put("trackNumber", track.trackNumber);
        value.put("discNumber", track.discNumber);
        if (privateUrls) {
            value.put("lowUrl", track.lowUrl);
            value.put("highUrl", track.highUrl);
            value.put("artUrl", track.artUrl == null ? JSONObject.NULL : track.artUrl);
        }
        return value;
    }

    static JSONArray tracks(List<PlaybackQueueState.Track> tracks, boolean privateUrls) {
        JSONArray result = new JSONArray();
        for (PlaybackQueueState.Track track : tracks) result.put(track(track, privateUrls));
        return result;
    }

    static JSObject sleep(PlaybackQueueState state) {
        JSObject sleep = new JSObject();
        sleep.put("mode", state.sleepMode == null ? JSONObject.NULL : state.sleepMode);
        sleep.put("endTimeMs", state.sleepEndTimeMs);
        sleep.put("queueDrained", state.sleepQueueDrained);
        return sleep;
    }

    static JSObject encode(PlaybackQueueState state, String scope, long positionMs) {
        JSObject value = new JSObject();
        value.put("version", 2);
        value.put("scope", scope == null ? "" : scope);
        value.put("positionMs", positionMs);
        value.put("sourceTracks", tracks(state.sourceTracks, true));
        value.put("queue", tracks(state.queue, true));
        value.put("currentTrack", state.current == null ? JSONObject.NULL : track(state.current, true));
        value.put("index", state.index);
        value.put("currentFromQueue", state.currentFromQueue);
        value.put("repeatMode", state.repeatMode);
        value.put("shuffleOn", state.shuffleOn);
        value.put("quality", state.quality);
        value.put("sleep", sleep(state));
        JSONArray history = new JSONArray();
        for (Integer index : state.shuffleHistory) history.put(index);
        value.put("shuffleHistory", history);
        return value;
    }

    static PlaybackQueueState decode(JSONObject value) {
        if (value.optInt("version", 0) != 2) throw new IllegalArgumentException("Unsupported session version");
        PlaybackQueueState state = new PlaybackQueueState();
        state.sourceTracks.addAll(parseTracks(value.optJSONArray("sourceTracks")));
        state.queue.addAll(parseTracks(value.optJSONArray("queue")));
        JSONObject current = value.optJSONObject("currentTrack");
        state.current = current == null ? null : parseTrack(current);
        state.index = value.optInt("index", -1);
        if (state.index < -1 || state.index >= state.sourceTracks.size()) {
            throw new IllegalArgumentException("Invalid saved source position");
        }
        state.currentFromQueue = value.optBoolean("currentFromQueue", false);
        state.setOptions(value.optString("repeatMode", "off"), value.optBoolean("shuffleOn", false),
            value.optString("quality", "low"));
        JSONObject sleep = value.optJSONObject("sleep");
        if (sleep != null) {
            state.setSleep(nullable(sleep, "mode"), sleep.optLong("endTimeMs", 0L));
            state.sleepQueueDrained = sleep.optBoolean("queueDrained", state.sleepQueueDrained);
            if ("duration".equals(state.sleepMode) && state.sleepEndTimeMs <= System.currentTimeMillis()) state.clearSleep();
        }
        JSONArray history = value.optJSONArray("shuffleHistory");
        if (history != null) for (int i = Math.max(0, history.length() - 200); i < history.length(); i++) {
            int index = history.optInt(i, -1);
            if (index >= 0 && index < state.sourceTracks.size()) state.shuffleHistory.add(index);
        }
        checkPersistable(state.sourceTracks, state.queue, state.current);
        return state;
    }

    static String nullable(JSONObject value, String key) {
        return value.isNull(key) ? null : value.optString(key, null);
    }

    private static String optionalUrl(String value) {
        return value == null || value.isEmpty() ? null : checkedUrl(value);
    }

    private static String checkedUrl(String value) {
        try {
            URI uri = new URI(value);
            if (value.length() > 16384 || uri.getHost() == null
                    || !("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) {
                throw new IllegalArgumentException();
            }
            return value;
        } catch (Exception ignored) {
            throw new IllegalArgumentException("A valid HTTP or HTTPS stream address is required");
        }
    }
}
