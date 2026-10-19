# Player UI refinement

The expanded web player retains transport, seek, Lyrics, and collapse controls. Audio quality, translated labels, sleep timer, and stream details are grouped under More. The disclosure closes on outside pointer interaction, Escape, Android Back, track changes, and collapsing the player. Existing playback commands are reused.

Playing-track titles wrap to three lines in the dock and remain available in full in album track rows. Artist subtitles use two lines on non-playing rows and expand for the playing row. Album artist credits longer than 110 characters use an expandable disclosure. Large album artwork is unchanged.

All 17 JavaScript suites passed; type checking and production web build passed. The device-discovered fixes below were covered by the updated navigation and Jellyfin authentication regression suites, type checking, the production web build, and Android APK assembly.


## Physical device checks — September 28

Tested on the connected Samsung SM-S918U1, using ADB screenshots, actual Back/swipe input, and the app WebView's debug interface. The web viewport measured 384 × 790 CSS pixels.

Passed:
- Expanded player top was 604.27 px; the list ended at 604.13 px. The final album track was reachable above the player, and the collapsed mini-player also reserved enough space.
- More stayed inside screen bounds. After the fix, a physical Android Back press closed it while preserving the album identity.
- Settings contained Lyrics, Translations, Audio cache, and Native interface preview in order. The lyric-source selector showed Auto; the heading remained visible at the bottom of the dialog.
- Long album credits expanded successfully. Large artwork was preserved.
- Glorious Moment loaded 67 displayed lyric groups through the corrected endpoint. The lyric source control was absent from the reading view.
- The active line sat at approximately 38% of the main scroll viewport, using gold text, transparent background, and stable font weight.
- A physical swipe displayed Back to current line. Scroll position remained stable across an active-line change; pressing the button restored following.
- Pausing playback kept the active lyric stable.

Found and fixed:
1. More used a separate Back listener that could allow underlying navigation. Its visibility now participates in the central panel-dismissal order.
2. Lyrics requested /Items/{id}/Lyrics, which returned 404 on the live server. The app now uses /Audio/{id}/Lyrics, confirmed to return timed lyrics. A regression check covers the endpoint.

The rebuilt APK was installed on the phone and both fixes were retested. Playback was left paused during the final checks.

Still pending: confirming the Sleep timer panel opens from More (the attempted automation did not produce a valid result), exercising quality switching from More, landscape/large-text layouts, and a screen-reader pass. No translation-quota-consuming actions or cache deletion were performed.

## Continuation — September 30

ADB reports no connected devices. Remaining physical-device checks require the phone to be reconnected. No new APK installation or live-device checks were performed during this continuation.


## Reconnected device — September 30

Completed on the same Samsung phone:
- More → Sleep timer opens its panel, closes More, and dismisses with physical Android Back. The timer was left Off.
- LQ → HD while paused preserved the exact position and did not start playback.
- Brief real playback worked in HD and after switching back to LQ, without a reported playback error. Restored LQ and paused.
- Landscape initially used the desktop player row, pushing seeking controls off-screen despite the document reporting no horizontal overflow.
- Added a short-touch-screen landscape layout: compact header, 44px transport touch targets, metadata/controls row, and a full-width seek row. Previewed on the physical phone at 790 × 354 CSS pixels; no visible control exceeded viewport bounds. More also stayed within screen bounds. The main list gained 60 CSS pixels of usable height (150 → 210).

Type checking, production build, whitespace and secret checks passed for the CSS correction. Large-text and screen-reader testing remain separate, uncompleted checks.

The rebuilt APK was installed successfully. Confirmed the installed landscape layout uses the new grid and keeps seeking visible. Restored the original portrait rotation lock; playback remains paused in LQ.


## Large text and accessibility — September 30

Completed on the Samsung SM-S918U1 with system font scale 2.0 and Samsung TalkBack enabled, using screenshots, accessibility-tree inspection, WebView interactions, and a TalkBack touch activation of Close settings.

Found and corrected:
- At 200% text size the decorative tagline crowded the portrait header. Hide it at phone widths, preserving the app name and search controls.
- Visually hidden player controls remained available to accessibility navigation. Inert/aria-hidden now follow expanded/collapsed player state, exposing exactly one transport set.
- Settings now isolates background content from accessibility navigation, restores it on dismissal, and handles both player states without overriding their visibility.
- Mini-player expansion is an explicitly named button. Play/Pause, repeat state, volume, and Settings have clearer accessible names; empty search-clear controls are excluded. Seek has an elapsed/total aria-valuetext.

Device results:
- Portrait at 384 × 790 CSS pixels and 200% text: main list ended at 564.13 px, above player top 564.87 px. Header height was 145.47 px. Settings controls stayed within dialog width.
- Landscape at 790 × 354 CSS pixels and 200% text: transport and seek controls stayed within viewport width; main list ended above the player.
- With Settings open, the inspected accessibility tree contained dialog controls only. TalkBack touch activation dismissed Settings.
- Final installed build (index-3VqBha_F.js) confirmed background isolation and restoration with both expanded and collapsed players; the collapsed tree exposed Expand player and one set of transport buttons.
- All 17 JavaScript suites passed during this accessibility pass. After the final modal-state refinement, type checking, production web build, Android debug assembly, whitespace validation, and the working-tree secret scan passed. Installed the final APK successfully.

Limits: this was a focused player/Settings accessibility check, not a complete app or native-preview audit. Spoken output/pronunciation was not heard or verified. Although elapsed/total seek text is present in the DOM, the WebView accessibility-tree API returned an empty valuetext, so its spoken announcement remains unconfirmed.

Restored original device settings: font scale 1.0, portrait rotation lock (user_rotation=0, accelerometer_rotation=0), accessibility_enabled=0, and absent enabled_accessibility_services. Playback was left paused in LQ; no cache deletion or translation requests were performed.


## Player action styling — September 30

Lyrics and More now share equal-width rounded surfaces, restrained gold SVG icons, and gold active/open states. The collapse chevron is visually separate. Short landscape screens show the utility icons with accessible names and 44px targets.

Verified on the attached Samsung phone: final installed bundle index-QPQtHKs_.js renders both utility buttons at 148 × 44 CSS px in the 384px portrait viewport, including at 200% font scale. The More popover stays within the viewport and opens/closes correctly. Landscape preview at 790 × 354 keeps both utility buttons at 44 × 44px, with seeking within bounds. Type checking, web production build, Android assembly, whitespace and secret checks passed. Restored font scale 1.0 and portrait rotation 0; playback stayed paused.
