package com.yourname.crate;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.widget.RemoteViews;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Home-screen "now playing" widget. PlaybackService pushes state through
 * {@link #publish}; the buttons send broadcasts back to this provider, which
 * forwards them to the service's media session player. Only the last title,
 * artist, artwork file and play state are stored, so the widget still renders
 * sensibly after a reboot or when the service has been stopped.
 */
public class NowPlayingWidget extends AppWidgetProvider {
    static final String ACTION_TOGGLE = "com.yourname.crate.widget.TOGGLE";
    static final String ACTION_NEXT = "com.yourname.crate.widget.NEXT";
    static final String ACTION_PREVIOUS = "com.yourname.crate.widget.PREVIOUS";

    private static final String PREFS = "crate_widget";
    private static final int ART_SIZE_PX = 256;
    private static final ExecutorService renderer = Executors.newSingleThreadExecutor();

    /** Called from PlaybackService on the main thread whenever playback state or metadata changes. */
    static void publish(Context context, String title, String artist, String artUri, boolean playing) {
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String t = title == null ? "" : title;
        String a = artist == null ? "" : artist;
        String art = artUri == null ? "" : artUri;
        // Media3 reports many redundant events; only re-render when something visible changed.
        if (t.equals(prefs.getString("title", null)) && a.equals(prefs.getString("artist", null))
                && art.equals(prefs.getString("art", null)) && playing == prefs.getBoolean("playing", false)) return;
        prefs.edit().putString("title", t).putString("artist", a).putString("art", art)
            .putBoolean("playing", playing).apply();
        updateAll(app);
    }

    /** The service is going away, so the widget must not keep offering a Pause button. */
    static void markStopped(Context context) {
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("playing", false)) return;
        prefs.edit().putBoolean("playing", false).apply();
        updateAll(app);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        updateAll(context.getApplicationContext());
    }

    private static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, NowPlayingWidget.class));
        if (ids == null || ids.length == 0) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        final String title = prefs.getString("title", "");
        final String artist = prefs.getString("artist", "");
        final String art = prefs.getString("art", "");
        final boolean playing = prefs.getBoolean("playing", false);
        // Decoding artwork must not block the main thread.
        renderer.execute(() -> {
            try {
                Bitmap bitmap = loadArtwork(art);
                for (int id : ids) manager.updateAppWidget(id, build(context, title, artist, bitmap, playing));
            } catch (Exception ignored) {
                android.util.Log.w("CrateWidget", "Widget update unavailable");
            }
        });
    }

    private static RemoteViews build(Context context, String title, String artist, Bitmap art, boolean playing) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_now_playing);
        boolean hasTrack = title != null && !title.isEmpty();
        views.setTextViewText(R.id.widget_title, hasTrack ? title : "Nothing playing");
        views.setTextViewText(R.id.widget_artist, hasTrack ? artist : "Tap to open C.R.A.T.E.");
        if (art != null) views.setImageViewBitmap(R.id.widget_art, art);
        else views.setImageViewResource(R.id.widget_art, R.drawable.widget_art_placeholder);
        views.setImageViewResource(R.id.widget_play, playing ? R.drawable.ic_widget_pause : R.drawable.ic_widget_play);
        views.setContentDescription(R.id.widget_play, playing ? "Pause" : "Play");
        views.setOnClickPendingIntent(R.id.widget_play, command(context, ACTION_TOGGLE, 1));
        views.setOnClickPendingIntent(R.id.widget_next, command(context, ACTION_NEXT, 2));
        views.setOnClickPendingIntent(R.id.widget_prev, command(context, ACTION_PREVIOUS, 3));
        Intent launch = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(
            context, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return views;
    }

    private static PendingIntent command(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, NowPlayingWidgetCommands.class).setAction(action);
        return PendingIntent.getBroadcast(context, requestCode, intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Artwork is always a file:// URI inside the app's own art cache; anything else is ignored. */
    private static Bitmap loadArtwork(String artUri) {
        if (artUri == null || artUri.isEmpty()) return null;
        try {
            Uri uri = Uri.parse(artUri);
            if (!"file".equals(uri.getScheme()) || uri.getPath() == null) return null;
            File file = new File(uri.getPath());
            if (!file.isFile()) return null;
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getPath(), bounds);
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= ART_SIZE_PX && bounds.outHeight / (sample * 2) >= ART_SIZE_PX) sample *= 2;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            return BitmapFactory.decodeFile(file.getPath(), options);
        } catch (Exception | OutOfMemoryError ignored) {
            return null;
        }
    }
}
