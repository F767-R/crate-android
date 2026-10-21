package com.yourname.crate;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Receives the widget's button presses. Kept separate from the (necessarily exported)
 * widget provider and not exported itself, so only the widget's own PendingIntents can
 * control playback.
 */
public class NowPlayingWidgetCommands extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!NowPlayingWidget.ACTION_TOGGLE.equals(action) && !NowPlayingWidget.ACTION_NEXT.equals(action)
                && !NowPlayingWidget.ACTION_PREVIOUS.equals(action)) return;
        // The process can be cached or killed once onReceive returns, so hold the
        // broadcast open until the service has accepted the command.
        final PendingResult pending = goAsync();
        PlaybackService.whenReady(context.getApplicationContext(), service -> {
            service.widgetCommand(action);
            pending.finish();
        }, pending::finish);
    }
}
