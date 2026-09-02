package com.yourname.crate;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.session.MediaButtonReceiver;

/**
 * Foreground service that owns the MediaSessionCompat. This is what
 * keeps the process alive during playback and what puts controls on
 * the lockscreen / notification shade / Bluetooth headset.
 *
 * It never touches audio directly -- the actual <audio>/MSE playback
 * stays in the WebView. This service only mirrors state to the OS and
 * forwards hardware/notification button presses back into JS via
 * MediaBridgePlugin.
 */
public class PlaybackService extends Service {

    public static final String CHANNEL_ID = "crate_playback_channel";
    public static final int NOTIFICATION_ID = 1;

    private MediaSessionCompat mediaSession;
    private PlaybackStateCompat.Builder stateBuilder;
    private PowerManager.WakeLock wakeLock;

    // Cached so we can rebuild the notification on a pure play/pause
    // toggle without JS having to resend title/artist/art every time.
    private String currentTitle;
    private String currentArtist;
    private Bitmap currentArt;
    private boolean currentlyPlaying = false;
    private long currentPositionMs = 0L;
    private long currentDurationMs = 0L;

    // Simple static reference so MediaBridgePlugin can reach the live
    // session without a full bindService dance. Fine for a single-activity
    // app like this.
    private static PlaybackService instance;

    public static PlaybackService getInstance() {
        return instance;
    }

    public boolean isCurrentlyPlaying() {
        return currentlyPlaying;
    }

    public long getCurrentPositionMs() {
        return currentPositionMs;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "crate:PlaybackWakeLock");
        wakeLock.setReferenceCounted(false);

        mediaSession = new MediaSessionCompat(this, "CrateMediaSession");
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );

        stateBuilder = new PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY |
                PlaybackStateCompat.ACTION_PAUSE |
                PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                PlaybackStateCompat.ACTION_SEEK_TO
            );
        mediaSession.setPlaybackState(stateBuilder.build());

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                MediaBridgePlugin.notifyJs("nativePlay", null);
            }

            @Override
            public void onPause() {
                MediaBridgePlugin.notifyJs("nativePause", null);
            }

            @Override
            public void onSkipToNext() {
                MediaBridgePlugin.notifyJs("nativeNext", null);
            }

            @Override
            public void onSkipToPrevious() {
                MediaBridgePlugin.notifyJs("nativePrev", null);
            }

            @Override
            public void onSeekTo(long pos) {
                MediaBridgePlugin.notifySeek(pos);
            }
        });

        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        MediaButtonReceiver.handleIntent(mediaSession, intent);
        // Post a minimal notification immediately; updateNowPlaying()
        // from JS will replace it with real metadata once playback starts.
        startForeground(NOTIFICATION_ID, buildNotification(null, null, false));
        return START_STICKY;
    }

    /** Called from MediaBridgePlugin.updateNowPlaying(). */
    public void updateMetadata(String title, String artist, Bitmap art, long durationMs) {
        currentTitle = title;
        currentArtist = artist;
        currentArt = art;
        currentDurationMs = Math.max(0L, durationMs);

        MediaMetadataCompat.Builder builder = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs);
        if (art != null) {
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
        }
        mediaSession.setMetadata(builder.build());
        refreshNotification(title, artist, art, currentlyPlaying);
        MediaBridgePlugin.notifyStateChanged(currentlyPlaying, currentPositionMs, currentDurationMs);
    }

    /** Called from MediaBridgePlugin.updatePlaybackState(). */
    public void updatePlaybackState(boolean isPlaying, long positionMs) {
        currentlyPlaying = isPlaying;
        currentPositionMs = Math.max(0L, positionMs);
        int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        // Speed must be 0 for any non-playing state, or some OEM lock-screen
        // / quick-settings media widgets keep extrapolating the seekbar
        // forward after pause and desync on the next resume.
        float speed = isPlaying ? 1.0f : 0.0f;
        stateBuilder.setState(state, currentPositionMs, speed);
        mediaSession.setPlaybackState(stateBuilder.build());

        if (isPlaying) {
            // acquire() with a timeout is a safety net: if for any reason
            // release() is missed (crash, service killed mid-call), the
            // lock still self-releases instead of silently draining battery
            // forever.
            if (!wakeLock.isHeld()) {
                wakeLock.acquire(10 * 60 * 60 * 1000L /* 10 hours max */);
            }
        } else {
            if (wakeLock.isHeld()) {
                wakeLock.release();
            }
        }

        // Keep the notification's play/pause icon and ongoing flag in
        // sync too -- this used to only happen on track change.
        refreshNotification(currentTitle, currentArtist, currentArt, isPlaying);
        MediaBridgePlugin.notifyStateChanged(isPlaying, currentPositionMs, currentDurationMs);
    }

    private void refreshNotification(String title, String artist, Bitmap art, boolean isPlaying) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, buildNotification(title, artist, isPlaying));
    }

    private Notification buildNotification(String title, String artist, boolean isPlaying) {
        PendingIntent playPause = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_PLAY_PAUSE);

        int actionIcon = isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title != null ? title : "C.R.A.T.E.")
            .setContentText(artist != null ? artist : "")
            .setSmallIcon(android.R.drawable.ic_media_play) // swap for your app icon
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0))
            .addAction(actionIcon, "Play/Pause", playPause)
            .setOngoing(isPlaying)
            .setPriority(NotificationCompat.PRIORITY_LOW);

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    public MediaSessionCompat getMediaSession() {
        return mediaSession;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        mediaSession.release();
        instance = null;
        super.onDestroy();
    }
}