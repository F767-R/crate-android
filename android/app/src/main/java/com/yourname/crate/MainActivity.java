package com.yourname.crate;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 4201;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the custom plugin before super.onCreate() so the
        // bridge picks it up on first load.
        registerPlugin(MediaBridgePlugin.class);
        super.onCreate(savedInstanceState);

        requestNotificationPermissionIfNeeded();

        // Start the playback service. The app is in the foreground here,
        // so a plain startService() is legal and imposes no 5-second
        // startForeground() contract before any playback exists — Media3
        // promotes the service to foreground itself when playback begins.
        // (startForegroundService() here previously caused crashes whenever
        // the user browsed longer than the FGS grace period without playing.)
        Intent serviceIntent = new Intent(this, PlaybackService.class);
        try {
            startService(serviceIntent);
        } catch (IllegalStateException backgroundStartNotAllowed) {
            ContextCompat.startForegroundService(this, serviceIntent);
        }
    }

    /**
     * Android 13+ requires POST_NOTIFICATIONS at runtime or the OS silently
     * drops media notifications even though the service is running. Without
     * that permission the lockscreen/notification "Now Playing" tile never
     * appears.
     */
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        NOTIFICATION_PERMISSION_REQUEST_CODE
                );
            }
        }
    }
}
