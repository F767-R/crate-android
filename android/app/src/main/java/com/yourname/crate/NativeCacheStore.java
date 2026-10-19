package com.yourname.crate;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import java.io.File;

/** Shared by the service and bridge, including before playback has started. */
final class NativeCacheStore {
    static final long MIB = 1024L * 1024L;
    static final long DEFAULT_AUDIO_LIMIT = 512L * MIB;
    static final long ARTWORK_LIMIT = 64L * MIB;
    static final long MAX_AUDIO_FILE_BYTES = 128L * MIB;
    static final long MAX_ARTWORK_FILE_BYTES = 5L * MIB;
    private static NativeCacheStore instance;
    final BoundedFileCache audio;
    final BoundedFileCache artwork;
    private final SharedPreferences preferences;

    static synchronized NativeCacheStore get(Context context) {
        if (instance == null) instance = new NativeCacheStore(context.getApplicationContext());
        return instance;
    }

    private NativeCacheStore(Context context) {
        preferences = context.getSharedPreferences("crate_cache", Context.MODE_PRIVATE);
        long stored = preferences.getLong("audioLimitBytes", DEFAULT_AUDIO_LIMIT);
        long limit = isAllowedAudioLimit(stored) ? stored : DEFAULT_AUDIO_LIMIT;
        audio = new BoundedFileCache(new File(context.getFilesDir(), "file_cache"), ".audio",
            limit, MAX_AUDIO_FILE_BYTES);
        artwork = new BoundedFileCache(new File(context.getFilesDir(), "art_cache"), ".img",
            ARTWORK_LIMIT, MAX_ARTWORK_FILE_BYTES);
    }

    static boolean isAllowedAudioLimit(long bytes) {
        return bytes == 128L * MIB || bytes == 256L * MIB
            || bytes == 512L * MIB || bytes == 1024L * MIB;
    }

    synchronized JSObject stats() {
        JSObject result = new JSObject();
        result.put("audioBytes", audio.sizeBytes());
        result.put("artworkBytes", artwork.sizeBytes());
        result.put("audioLimitBytes", audio.limitBytes());
        result.put("artworkLimitBytes", artwork.limitBytes());
        return result;
    }

    synchronized void setAudioLimit(long bytes) {
        if (!isAllowedAudioLimit(bytes)) throw new IllegalArgumentException("Invalid audio cache limit");
        audio.setLimit(bytes);
        preferences.edit().putLong("audioLimitBytes", bytes).apply();
    }

    synchronized void clear() {
        audio.clear();
        artwork.clear();
    }

    void cancelDownloads() {
        audio.cancelDownloads();
        artwork.cancelDownloads();
    }
}
