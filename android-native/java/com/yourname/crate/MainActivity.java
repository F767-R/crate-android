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

        // Start the playback service so it's alive and ready to take
        // over the media session as soon as the JS side starts playing.
        Intent serviceIntent = new Intent(this, PlaybackService.class);
        startService(serviceIntent);
    }

    /**
     * Android 13+ (API 33) requires POST_NOTIFICATIONS to be granted at
     * runtime, or the system silently drops every notification the app
     * tries to show -- including the media notification that the
     * lock-screen and Quick Settings media controls are built from.
     * Below API 33 this permission doesn't exist and notifications just
     * work, so this is a no-op there.
     */
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                    NOTIFICATION_PERMISSION_REQUEST_CODE
                );
            }
        }
    }
}