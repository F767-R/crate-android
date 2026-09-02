package com.yourname.crate;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Real audio playback service. ExoPlayer does the actual decoding and
 * playback; MediaSessionService owns the MediaSession and the foreground
 * notification, so the lockscreen, quick-settings tile, and Bluetooth
 * headset buttons are driven by the actual player state.
 *
 * Threading: ExoPlayer must only be touched from the thread that created
 * it (main, here). Capacitor invokes every @PluginMethod on a background
 * thread, so every entry point below posts the actual player work onto
 * mainHandler.
 *
 * Caching model (single source of truth): audio files are downloaded into
 * files/file_cache/{itemId}.audio ONLY when the caller opts in — the web
 * layer enables this for the low-quality (Opus) preset, whose files are
 * small. Lossless FLAC streams are far too large to mirror on disk, so
 * they always play over HTTP. While an item is NOT yet cached, ExoPlayer
 * streams it over HTTP; the download runs concurrently. Once cached,
 * playStream() switches to the app-owned local file:// URI,
 * giving instant seeking and zero network usage.
 *
 * Foreground service contract: callers use plain startService() while the
 * app is foregrounded; Media3 promotes the service to foreground itself
 * with its media notification the moment playback starts (see the
 * onStartCommand NOTE below for why no placeholder notification is posted
 * here).
 */
public class PlaybackService extends MediaSessionService {

    private static final String CHANNEL_ID = "crate_playback_channel";
    private static final int MEDIA_NOTIFICATION_ID = 1000;
    private static final String FILE_CACHE_DIR_NAME = "file_cache";

    private static PlaybackService instance;

    private ExoPlayer player;
    private MediaSession mediaSession;
    private ExecutorService downloadExecutor;
    private ExecutorService artworkExecutor;
    private File fileCacheDir;
    private final ConcurrentHashMap<String, Boolean> downloading = new ConcurrentHashMap<>();

    // Every player interaction from outside (i.e. from MediaBridgePlugin,
    // which calls in on Capacitor's background plugin thread) must be
    // posted through here.
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Periodic position emitter. ExoPlayer's listener callbacks only fire
    // on state CHANGES, so once playback is steady the JS UI would stop
    // receiving stateChanged events and the progress bar would freeze.
    // This runnable re-emits the current state every 500ms while playing.
    private static final long POSITION_EMIT_INTERVAL_MS = 500L;
    private final Runnable positionEmitter = new Runnable() {
        @Override
        public void run() {
            if (player == null) return;
            if (player.isPlaying()) {
                emitState();
                mainHandler.postDelayed(this, POSITION_EMIT_INTERVAL_MS);
            }
        }
    };

    // Track-level duration (NOT the URL stream duration). ExoPlayer's
    // getDuration() returns the length of the URL it was asked to play,
    // which is the segment from startPositionMs to track end. The UI
    // needs the full track duration, so we stash what playStream() was
    // called with and report that instead.
    private long trackDurationMs = 0L;
    private String currentItemId = null;

    // True while ExoPlayer's current item is a cached local file
    // (content:// or file://). Local files are randomly seekable;
    // Jellyfin's chunked transcode streams are NOT — seeks into those
    // clamp back to 0, so JS must reload-at-offset instead of seeking.
    private volatile boolean currentItemIsLocal = false;

    public static PlaybackService getInstance() {
        return instance;
    }

    /**
     * Boots the service if it isn't running yet. Called from
     * MediaBridgePlugin.playStream() to close the cold-start race where
     * the WebView is interactive before MainActivity has started the
     * service. The app is always in the foreground at this point (the tap
     * just happened), so a plain startService() is legal and — unlike
     * startForegroundService() — imposes no 5-second startForeground()
     * contract. Media3 promotes the service to foreground itself the
     * moment playback begins.
     */
    public static void ensureStarted(android.content.Context context) {
        if (instance == null) {
            android.content.Intent i = new android.content.Intent(context, PlaybackService.class);
            try {
                context.startService(i);
            } catch (IllegalStateException appNotForeground) {
                androidx.core.content.ContextCompat.startForegroundService(context, i);
            }
        }
    }

    /** Callback used by getStateAsync() to hand player state back across threads. */
    public interface StateCallback {
        void onResult(boolean isPlaying, long positionMs, long durationMs, boolean isLocal,
                      boolean isBuffering);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();

        fileCacheDir = new File(getFilesDir(), FILE_CACHE_DIR_NAME);
        if (!fileCacheDir.exists()) fileCacheDir.mkdirs();

        // Range: bytes=0- forces direct-play responses down the 206 path
        // so the INITIAL open (which sends no Range header) still carries
        // an explicit Content-Length. Without a known length Media3 treats
        // a progressive stream as unseekable and every seek clamps back to
        // the stream's default position (0). Transcode endpoints ignore
        // the header and remain chunked, as before.
        DataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setUserAgent("C.R.A.T.E./1.0 (ExoPlayer)")
            .setAllowCrossProtocolRedirects(true)
            .setDefaultRequestProperties(Collections.singletonMap("Range", "bytes=0-"));

        // DefaultDataSource routes by URI scheme: content:// and file://
        // are opened natively; http(s) is delegated to the factory above.
        // Wrapping ONLY an HTTP factory here was the bug that made cached
        // (content://) playback fail — CacheDataSource cannot open
        // content:// URIs and neither can DefaultHttpDataSource.
        DataSource.Factory dataSourceFactory =
            new DefaultDataSource.Factory(this, httpFactory);

        // Background playback hardening:
        //  - WAKE_MODE_NETWORK holds a WifiLock (+WakeLock) while playing,
        //    so with the screen off the radio doesn't doze between buffer
        //    reads — without it, streamed audio micro-stutters within a
        //    minute of locking the screen.
        //  - A generous audio buffer (60s min, 3min max, 8s rebuffer
        //    threshold) rides out transient tailnet/server hiccups. Initial
        //    playback only waits for 500ms so cached-file and quality
        //    switches do not inherit an unnecessary multi-second pause; the
        //    whole LQ track fits in it, so most of a track plays entirely
        //    from memory once buffered.
        //  - MUSIC audio attributes + focus handling route playback
        //    through the proper stream and pause/resume on focus loss.
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                /* minBufferMs= */ 60_000,
                /* maxBufferMs= */ 180_000,
                /* bufferForPlaybackMs= */ 500,
                /* bufferForPlaybackRebufferMs= */ 8_000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();

        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory))
            .setLoadControl(loadControl)
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(), /* handleAudioFocus= */ true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setHandleAudioBecomingNoisy(true)
            .build();

        // Explicitly route Media3's media notification through our own
        // (already-created) channel instead of its "default" channel.
        // NOTE (media3-session 1.4.1 API): the provider is registered via
        // the PROTECTED MediaSessionService.setMediaNotificationProvider(),
        // NOT MediaSession.Builder, and the channel id is passed through
        // the 4-arg constructor (there is no setChannelId() here).
        // This notification is what Android 13+ SystemUI renders as the
        // quick-settings media carousel and lockscreen widget.
        DefaultMediaNotificationProvider notificationProvider =
            new DefaultMediaNotificationProvider(
                this,
                /* notificationIdProvider= */ session -> MEDIA_NOTIFICATION_ID,
                CHANNEL_ID,
                R.mipmap.ic_launcher
            );
        setMediaNotificationProvider(notificationProvider);

        // The session must see a player that ADVERTISES next/previous
        // navigation, otherwise DefaultMediaNotificationProvider omits
        // the skip buttons, Samsung's pill mini-player never engages,
        // and headset/lockscreen media keys map onto no-op commands.
        // The queue lives in the web layer, so instead of playlist
        // navigation these commands are forwarded to JS via
        // MediaBridgePlugin.emitNext()/emitPrev().
        Player sessionPlayer = new ForwardingPlayer(player) {
            @Override
            public Player.Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                    .add(Player.COMMAND_SEEK_TO_NEXT)
                    .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    // Maps to PlaybackState.ACTION_SEEK_TO, which is what
                    // makes the quick-settings / lockscreen progress bar
                    // interactive (draggable) instead of display-only.
                    .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                    .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                switch (command) {
                    case Player.COMMAND_SEEK_TO_NEXT:
                    case Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM:
                    case Player.COMMAND_SEEK_TO_PREVIOUS:
                    case Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM:
                    case Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM:
                        return true;
                    default:
                        return super.isCommandAvailable(command);
                }
            }

            @Override
            public boolean hasNextMediaItem() { return true; }

            @Override
            public boolean hasPreviousMediaItem() { return true; }

            // Seeks arriving from the MediaSession (lockscreen /
            // quick-settings card drag, Bluetooth AVRCP SEEK_TO) must NOT
            // hit the raw player directly: on a streaming (uncached,
            // chunked) item the seek silently clamps back to 0. Cached
            // items are seekable, so those stay instant; everything else
            // is handed to the web layer, whose seek strategy restarts
            // the URL at the offset via StartTimeTicks.
            @Override
            public void seekTo(long positionMs) {
                if (currentItemIsLocal) {
                    player.seekTo(positionMs);
                } else {
                    MediaBridgePlugin.emitSessionSeek(positionMs);
                }
            }

            @Override
            public void seekBack() {
                long target = player.getCurrentPosition() - 5000;
                seekTo(Math.max(0, target));
            }

            @Override
            public void seekForward() {
                long target = player.getCurrentPosition() + 5000;
                long dur = player.getDuration();
                if (dur > 0 && target > dur - 1500) target = Math.max(0, dur - 1500);
                seekTo(target);
            }

            @Override
            public void seekToNext() { MediaBridgePlugin.emitNext(); }

            @Override
            public void seekToNextMediaItem() { MediaBridgePlugin.emitNext(); }

            @Override
            public void seekToPrevious() { MediaBridgePlugin.emitPrev(); }

            @Override
            public void seekToPreviousMediaItem() { MediaBridgePlugin.emitPrev(); }
        };

        // Session activity: the PendingIntent the OS fires when the user
        // taps the lockscreen/QS/pill media card. Diffed against Poweramp
        // (whose pill works) — Poweramp's session has launchIntent set, ours
        // was null because MediaSession.Builder.setSessionActivity() was
        // never called. Samsung's pill subsystem in particular uses this
        // to gate which sessions it advertises; missing it = the pill
        // silently skips the package even though the session is otherwise
        // valid. Also drives the mediaButtonReceiver's PendingIntent, which
        // was therefore null in dumpsys for the same root cause.
        Intent launch = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent sessionActivity = PendingIntent.getActivity(
            this, /* requestCode= */ 0, launch,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        mediaSession = new MediaSession.Builder(this, sessionPlayer)
            .setSessionActivity(sessionActivity)
            .setCallback(new MediaSession.Callback() {
                @Override
                public MediaSession.ConnectionResult onConnect(
                    MediaSession session,
                    MediaSession.ControllerInfo controller
                ) {
                    return new MediaSession.ConnectionResult.AcceptedResultBuilder(session).build();
                }
            })
            .build();

        // REQUIRED: sessions created directly with MediaSession.Builder are
        // NOT managed by the service until explicitly added (or until some
        // external controller binds and goes through onGetSession). Without
        // addSession(), MediaNotificationManager never attaches its player
        // listener, so the media notification is never posted — the
        // lockscreen / quick-settings widget silently never appears.
        addSession(mediaSession);

        // Player event listeners drive Media3's foreground/notification lifecycle:
        // when playback starts, Media3 promotes its media notification into the
        // foreground slot itself (no placeholder needed — and none wanted, since
        // its internal startSelfIntent would otherwise re-post a duplicate).
        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) {
                    startPositionEmitter();
                } else {
                    stopPositionEmitter();
                }
                emitState();
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_ENDED) {
                    stopPositionEmitter();
                    MediaBridgePlugin.emitTrackEnded();
                }
                emitState();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                stopPositionEmitter();
                MediaBridgePlugin.emitError(error.getMessage() != null
                    ? error.getMessage() : "ExoPlayer error " + error.errorCode);
                emitState();
            }
        });

        downloadExecutor = Executors.newSingleThreadExecutor();
        artworkExecutor = Executors.newSingleThreadExecutor();
    }

    private void startPositionEmitter() {
        mainHandler.removeCallbacks(positionEmitter);
        mainHandler.post(positionEmitter);
    }

    private void stopPositionEmitter() {
        mainHandler.removeCallbacks(positionEmitter);
    }

    // NOTE: onStartCommand is intentionally NOT overridden. The default
    // MediaSessionService implementation handles media-button intents, and
    // Media3 itself promotes the service to foreground with its media
    // notification when playback starts. Posting our own placeholder here
    // would (a) duplicate the media card and (b) get re-posted on every
    // internal Media3 startForegroundService(self) call.

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;
            // IMPORTANCE_DEFAULT (not LOW): Samsung's persistent "media
            // pill" only engages for media notifications at DEFAULT or
            // above. LOW is enough for lockscreen/QS render but the pill
            // subsystem filters on importance and silently skips LOW
            // channels. The user sees nothing in the persistent mini-
            // player when the app is backgrounded otherwise.
            NotificationChannel ours = new NotificationChannel(
                CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(ours);
            // Media3's DefaultMediaNotificationProvider posts into a
            // channel with the literal id "default". If it doesn't exist,
            // the media notification is silently dropped on Android 8+
            // and the lockscreen / quick-settings widget never appears.
            NotificationChannel media3 = new NotificationChannel(
                "default", "Media playback", NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(media3);
        }
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (player == null || !player.isPlaying()) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        stopPositionEmitter();
        if (downloadExecutor != null) {
            downloadExecutor.shutdownNow();
            downloadExecutor = null;
        }
        if (artworkExecutor != null) {
            artworkExecutor.shutdownNow();
            artworkExecutor = null;
        }
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        instance = null;
        super.onDestroy();
    }

    // ===== JS -> Native commands (driven by MediaBridgePlugin) =====

    /**
     * Extracts the Jellyfin item ID from an audio stream URL.
     * Handles /Audio/{id}/universal and /Audio/{id}/stream paths.
     */
    private static String extractItemId(String url) {
        if (url == null) return null;
        int idx = url.indexOf("/Audio/");
        if (idx < 0) return null;
        int start = idx + "/Audio/".length();
        int end = url.indexOf('/', start);
        if (end < 0) end = url.indexOf('?', start);
        if (end < 0) end = url.length();
        String id = url.substring(start, end);
        return id.isEmpty() ? null : id;
    }

    /**
     * Strips StartTimeTicks from a stream URL before it's used for a
     * full-file cache download. Whatever triggered this download (initial
     * play, or a mid-track seek) may have baked a nonzero StartTimeTicks
     * into `url` — but the cache file must always be the FULL track from
     * position 0, since playStream() later treats a cached file's
     * startPositionMs as an ABSOLUTE position within it. Downloading a
     * partial file (starting wherever a seek happened to land) and then
     * treating it as if it started at 0 was the actual cause of "seeking
     * resets to the beginning": any seek after that mis-cached download
     * completed would look up a position the file doesn't contain at all.
     */
    private static String stripStartTimeTicks(String url) {
        if (url == null) return null;
        return url.replaceAll("([?&])StartTimeTicks=[^&]*&?", "$1")
                   .replaceAll("[?&]$", "");
    }

    public void playStream(String url, long startPositionMs,
                           String title, String artist,
                           String artUrl, long durationMs, boolean allowCache) {
        if (url == null || url.isEmpty()) {
            MediaBridgePlugin.emitError("playStream called with empty url");
            return;
        }
        // Resolve what to play. Cache/FileProvider problems must never
        // kill the play call — worst case we stream the original URL.
        final String itemId = extractItemId(url);
        String uriToPlay = url;
        boolean usingCache = false;
        try {
            File cachedFile = itemId != null ? getCachedFile(itemId) : null;
            // Gate cache USE on allowCache, not just cache DOWNLOAD. The
            // shim passes cache: qualityPreset === 'low', so when the user
            // toggles to HD the native side must NOT silently serve the LQ
            // cache file for the same itemId — otherwise the UI flips to HD
            // but the audio stays LQ. (The "regardless of the flag" comment
            // below is now stale; the gate below is the single source of
            // truth for both use and download.)
            if (cachedFile != null && allowCache) {
                // Direct file:// URI, NOT FileProvider content://. The app
                // process owns these cache files, so no provider grant is
                // needed — and ContentDataSource (content://) exposes no
                // content length to Media3, which marks the whole period
                // UNSEEABLE: every seek (and the setMediaItem start
                // position) silently clamps back to 0. A file:// URI goes
                // through FileDataSource with a definite length, making
                // the local Ogg fully seekable.
                uriToPlay = Uri.fromFile(cachedFile).toString();
                usingCache = true;
            } else if (itemId != null && allowCache) {
                // Opt-in only: the web layer enables this for the small
                // LQ/Opus files. Lossless FLAC is streamed, never mirrored
                // to disk. The cache USE above is also gated on allowCache,
                // so the same flag controls both serving from disk and
                // scheduling the initial mirror — no surprise HD-then-LQ
                // swap when the user toggles quality.
                //
                // Delay the mirror by 8s: while the item streams, starting
                // the download immediately makes the server transcode the
                // SAME track twice concurrently (once for the player, once
                // for the download), which on a slow link or weak server
                // CPU starves the playback buffer and causes background
                // micro-stutters. Let the live stream fill its buffer
                // first. The download is idempotent (cache-exists check +
                // per-item in-flight guard), so duplicate schedules and
                // seek-restarts are harmless.
                mainHandler.postDelayed(() -> downloadFileToCache(url, itemId), 8_000);
            }
        } catch (Exception e) {
            uriToPlay = url;
            MediaBridgePlugin.emitError("cache lookup failed, streaming instead: " + e.getMessage());
        }
        final String playUri = uriToPlay;
        final boolean fromCache = usingCache;
        this.currentItemIsLocal = playUri.startsWith("content:") || playUri.startsWith("file:");
        // Never put artwork network I/O in front of playback. Use an already
        // cached local image immediately; a missing image is downloaded on a
        // dedicated worker and patched into the MediaItem afterward.
        final String resolvedArtUri = cachedArtworkUri(artUrl);
        mainHandler.post(() -> {
            try {
                if (player == null) return;
                MediaItem previousItem = player.getCurrentMediaItem();
                boolean sameTrack = itemId != null && itemId.equals(currentItemId);
                this.trackDurationMs = durationMs;
                this.currentItemId = itemId;
                MediaItem.Builder itemBuilder = new MediaItem.Builder()
                    .setMediaId(playUri)
                    .setUri(playUri);

                MediaMetadata.Builder meta = new MediaMetadata.Builder()
                    .setTitle(title != null ? title : "")
                    .setArtist(artist != null ? artist : "");
                if (durationMs > 0) {
                    meta.setDurationMs(durationMs);
                }
                if (resolvedArtUri != null) {
                    meta.setArtworkUri(Uri.parse(resolvedArtUri));
                } else if (sameTrack && previousItem != null
                           && previousItem.mediaMetadata.artworkUri != null) {
                    // Quality changes replace the MediaItem but not the track;
                    // retain its already-resolved artwork without waiting.
                    meta.setArtworkUri(previousItem.mediaMetadata.artworkUri);
                }
                itemBuilder.setMediaMetadata(meta.build());

                // startPositionMs is the ABSOLUTE track position.
                //  - Cached local file: the file starts at track 0:00, so
                //    seek into it directly.
                //  - LQ network transcode: the URL's StartTimeTicks tells
                //    Jellyfin to start transcoding at that offset, so
                //    ExoPlayer must begin at the segment start (0) —
                //    applying both would skip double the distance.
                //  - HD network direct-play: StartTimeTicks in the URL is
                //    IGNORED for direct-play (Jellyfin returns the full file
                //    with Range: bytes=0-, regardless of StartTimeTicks), so
                //    ExoPlayer's position is absolute track time and we
                //    MUST pre-seek to startPositionMs — otherwise the player
                //    lands at 0:00 and the user hears a skip back to the
                //    start of the track (with the verifySeekLanded fallback
                //    then jumping it forward 2s later).
                // !allowCache is the JS side's signal for "this is a
                // direct-play request" — the web layer sets cache=false
                // exactly because the HD FLAC is too large to cache, which
                // coincides with Jellyfin serving it via direct play. The
                // same flag now controls both USE (cache lookup above) and
                // DOWNLOAD (the postDelayed branch below), and now also
                // the pre-seek decision here.
                long effectiveStart = (fromCache || !allowCache)
                    ? Math.max(0, startPositionMs)
                    : 0L;

                // The constructor start position is NOT reliable: Ogg (and
                // some other) extractors can't apply it until their seek map
                // is built, and until then the request is silently clamped
                // back to 0 — which made every cached-file seek restart the
                // track from the beginning. Re-assert the position once the
                // player reaches STATE_READY; if the constructor position
                // landed correctly this seek is a harmless no-op.
                final long targetStartMs = effectiveStart;
                android.util.Log.d("CratePlayback", "playStream: uri=" + playUri
                    + " fromCache=" + fromCache
                    + " targetStart=" + targetStartMs);
                final Player.Listener startEnforcer = new Player.Listener() {
                    @Override
                    public void onPlaybackStateChanged(int playbackState) {
                        if (playbackState != Player.STATE_READY) return;
                        player.removeListener(this);
                        if (player == null || targetStartMs <= 0) return;
                        long pos = player.getCurrentPosition();
                        long dur = player.getDuration();
                        // The cached/transcoded file can be SHORTER than
                        // the library metadata (ffmpeg trims what
                        // RunTimeTicks claims). A target in the phantom
                        // tail clamps to the exact end and throws the
                        // player straight into ENDED — land just before
                        // the end instead so playback stays alive.
                        long safeTarget = targetStartMs;
                        if (dur > 0 && safeTarget > dur - 1500) {
                            safeTarget = Math.max(0, dur - 1500);
                        }
                        android.util.Log.d("CratePlayback", "READY: pos=" + pos
                            + " target=" + targetStartMs + " dur=" + dur);
                        if (Math.abs(pos - safeTarget) > 1500) {
                            android.util.Log.d("CratePlayback", "enforcer seekTo " + safeTarget
                                + " (fileDur=" + dur + ")");
                            player.seekTo(safeTarget);
                        }
                    }
                };
                player.addListener(startEnforcer);

                player.setMediaItem(itemBuilder.build(), effectiveStart);
                player.prepare();
                player.play();
            } catch (Exception e) {
                MediaBridgePlugin.emitError("playStream failed: " + e.getMessage());
            }
        });

        if (resolvedArtUri == null && artUrl != null && !artUrl.isEmpty()
            && artworkExecutor != null) {
            artworkExecutor.submit(() -> {
                final String downloadedArtUri = resolveArtworkUri(artUrl);
                if (downloadedArtUri == null || downloadedArtUri.isEmpty()) return;
                mainHandler.post(() -> {
                    try {
                        if (player == null) return;
                        MediaItem current = player.getCurrentMediaItem();
                        if (current == null || !playUri.equals(current.mediaId)) return;
                        Uri artworkUri = Uri.parse(downloadedArtUri);
                        if (artworkUri.equals(current.mediaMetadata.artworkUri)) return;
                        MediaMetadata metadata = current.mediaMetadata.buildUpon()
                            .setArtworkUri(artworkUri)
                            .build();
                        player.replaceMediaItem(player.getCurrentMediaItemIndex(),
                            current.buildUpon().setMediaMetadata(metadata).build());
                    } catch (Exception e) {
                        android.util.Log.w("CratePlayback",
                            "deferred artwork update failed: " + e.getMessage());
                    }
                });
            });
        }
    }

    public void pause() {
        mainHandler.post(() -> {
            if (player != null) player.pause();
        });
    }

    public void resume() {
        mainHandler.post(() -> {
            if (player != null) player.play();
        });
    }

    public void seek(long positionMs) {
        mainHandler.post(() -> {
            if (player != null) {
                long target = Math.max(0, positionMs);
                long dur = player.getDuration();
                // A target at/after the real end throws the player into
                // ENDED immediately; land just before the end instead.
                if (dur > 0 && target >= dur) {
                    target = Math.max(0, dur - 1500);
                }
                android.util.Log.d("CratePlayback", "seek(): target=" + target
                    + " curPos=" + player.getCurrentPosition()
                    + " dur=" + dur);
                player.seekTo(target);
            }
        });
    }

    public void stop() {
        stopPositionEmitter();
        mainHandler.post(() -> {
            if (player != null) {
                player.stop();
                player.clearMediaItems();
            }
        });
    }

    public void setVolume(float level) {
        float clamped = Math.max(0f, Math.min(1f, level));
        mainHandler.post(() -> {
            if (player != null) player.setVolume(clamped);
        });
    }

    /** Returns the fully-downloaded local file for an item, or null. */
    public File getCachedFile(String itemId) {
        if (itemId == null || fileCacheDir == null) return null;
        File f = new File(fileCacheDir, itemId + ".audio");
        return f.exists() && f.length() > 0 ? f : null;
    }

    public boolean isCached(String itemId) {
        return getCachedFile(itemId) != null;
    }

    /**
     * Live now-playing metadata update from the web layer (translation
     * toggle). Replaces only the METADATA of the current MediaItem —
     * Media3 detects a metadata-only replacement and applies it without
     * interrupting playback. This is what makes the lockscreen /
     * quick-settings widget switch to translated text mid-track.
     * Blocking artwork resolution; must NOT run on the main thread.
     */
    public void updateNowPlaying(String title, String artist, String artUrl, long durationMs) {
        final String resolvedArt = (artUrl != null && !artUrl.isEmpty()) ? resolveArtworkUri(artUrl) : null;
        mainHandler.post(() -> {
            try {
                if (player == null) return;
                MediaItem current = player.getCurrentMediaItem();
                if (current == null) return;
                MediaMetadata.Builder meta = current.mediaMetadata.buildUpon();
                if (title != null && !title.isEmpty()) meta.setTitle(title);
                if (artist != null && !artist.isEmpty()) meta.setArtist(artist);
                if (resolvedArt != null && !resolvedArt.isEmpty()) {
                    meta.setArtworkUri(Uri.parse(resolvedArt));
                }
                if (durationMs > 0) {
                    meta.setDurationMs(durationMs);
                    trackDurationMs = durationMs;
                }
                player.replaceMediaItem(player.getCurrentMediaItemIndex(),
                    current.buildUpon().setMediaMetadata(meta.build()).build());
            } catch (Exception e) {
                android.util.Log.w("CratePlayback", "updateNowPlaying failed: " + e.getMessage());
            }
        });
    }

    /**
     * Downloads artwork into files/art_cache/ (keyed by URL hash) and
     * returns a local file:// URI so in-process and system renderers can
     * always load it. Falls back to the original URL on any failure.
     * Blocking; must NOT be called on the main thread.
     */
    private File artworkCacheFile(String artUrl) throws Exception {
        File dir = new File(getFilesDir(), "art_cache");
        if (!dir.exists()) dir.mkdirs();
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] digest = md.digest(artUrl.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) sb.append(String.format("%02x", b));
        return new File(dir, sb + ".img");
    }

    /** Non-blocking lookup used on the playback-critical path. */
    private String cachedArtworkUri(String artUrl) {
        if (artUrl == null || artUrl.isEmpty()) return null;
        try {
            File file = artworkCacheFile(artUrl);
            return file.exists() && file.length() > 0 ? Uri.fromFile(file).toString() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String resolveArtworkUri(String artUrl) {
        if (artUrl == null || artUrl.isEmpty()) return null;
        try {
            File f = artworkCacheFile(artUrl);
            if (!f.exists() || f.length() == 0) {
                File dir = f.getParentFile();
                HttpURLConnection conn = (HttpURLConnection) new URL(artUrl).openConnection();
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(6000);
                conn.setInstanceFollowRedirects(true);
                int code = conn.getResponseCode();
                if (code != HttpURLConnection.HTTP_OK) {
                    conn.disconnect();
                    return artUrl;
                }
                InputStream in = conn.getInputStream();
                File tmp = new File(dir, f.getName() + ".tmp");
                FileOutputStream out = new FileOutputStream(tmp);
                byte[] buf = new byte[8192];
                int n;
                long total = 0;
                while ((n = in.read(buf)) != -1 && total < 5_000_000L) {
                    out.write(buf, 0, n);
                    total += n;
                }
                out.close();
                in.close();
                conn.disconnect();
                if (total <= 0 || !tmp.renameTo(f)) return artUrl;
            }
            return Uri.fromFile(f).toString();
        } catch (Exception e) {
            android.util.Log.w("CratePlayback", "artwork cache failed: " + e.getMessage());
            return artUrl;
        }
    }

    /**
     * Downloads the full file at the given URL to the file cache, keyed
     * by itemId. Idempotent; runs on a background thread. Once complete,
     * playStream() automatically serves this item from disk.
     */
    public void downloadFileToCache(final String rawUrl, final String itemId) {
        if (rawUrl == null || rawUrl.isEmpty() || itemId == null || itemId.isEmpty()) return;
        if (getCachedFile(itemId) != null) return;
        if (downloading.putIfAbsent(itemId, Boolean.TRUE) != null) return;
        // Always fetch the FULL track from position 0, regardless of
        // whatever StartTimeTicks the caller's URL happened to carry
        // (a mid-track seek, a resume, etc). playStream() later treats a
        // cached file's startPositionMs as an ABSOLUTE position within
        // it — a partial download starting wherever a seek landed would
        // silently corrupt every future seek into this item.
        final String url = stripStartTimeTicks(rawUrl);
        downloadExecutor.submit(() -> {
            HttpURLConnection conn = null;
            InputStream in = null;
            FileOutputStream out = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestProperty("User-Agent", "C.R.A.T.E./1.0");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) return;
                in = conn.getInputStream();
                File target = new File(fileCacheDir, itemId + ".audio");
                File tmp = new File(fileCacheDir, itemId + ".audio.tmp");
                out = new FileOutputStream(tmp);
                byte[] buffer = new byte[64 * 1024];
                int bytesRead;
                long total = 0;
                while ((bytesRead = in.read(buffer)) != -1) {
                    out.write(buffer, 0, bytesRead);
                    total += bytesRead;
                }
                out.flush();
                out.close();
                out = null;
                if (total > 0) {
                    if (target.exists()) target.delete();
                    if (!tmp.renameTo(target)) {
                        java.nio.file.Files.copy(tmp.toPath(), target.toPath(),
                            java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                        tmp.delete();
                    }
                    // Tell the web layer this item is now on disk (the
                    // currently-playing item keeps streaming — this only
                    // means the NEXT load/seek of it is instant).
                    MediaBridgePlugin.emitCacheReady(itemId);
                } else {
                    tmp.delete();
                }
            } catch (Exception ignored) {
                // Best-effort: streaming still works without the cache.
            } finally {
                downloading.remove(itemId);
                try { if (in != null) in.close(); } catch (Exception ignored2) {}
                try { if (out != null) out.close(); } catch (Exception ignored2) {}
                if (conn != null) conn.disconnect();
            }
        });
    }

    public void getStateAsync(StateCallback callback) {
        mainHandler.post(() -> {
            if (player == null) {
                callback.onResult(false, 0L, 0L, false, false);
                return;
            }
            callback.onResult(player.isPlaying(), player.getCurrentPosition(), reportedDurationMs(),
                currentItemIsLocal, player.getPlaybackState() == Player.STATE_BUFFERING);
        });
    }

    /**
     * Duration to report to the web layer. For LOCAL (cached) items the
     * decoded file is the source of truth: Jellyfin's RunTimeTicks can
     * disagree with the transcoded audio by seconds, and trusting it made
     * the scrub bar show times that don't exist in the file (seeking into
     * the phantom tail clamps straight to end-of-track). For NETWORK
     * streams the player duration is only the remaining segment, so the
     * full-track metadata value is used instead.
     */
    private long reportedDurationMs() {
        if (currentItemIsLocal && player.getDuration() > 0) return player.getDuration();
        if (trackDurationMs > 0) return trackDurationMs;
        return player.getDuration() > 0 ? player.getDuration() : 0L;
    }

    /** Only called from Player.Listener callbacks (main thread). */
    private void emitState() {
        if (player == null) return;
        MediaBridgePlugin.emitState(
            player.isPlaying(),
            player.getCurrentPosition(),
            reportedDurationMs(),
            currentItemIsLocal,
            player.getPlaybackState() == Player.STATE_BUFFERING
        );
    }
}
