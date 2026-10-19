# Jellyfin 12 authentication compatibility

The live server reports version 12.1.0. The saved key returned 401 through legacy X-Emby-Token and api_key authentication, but 200 through Authorization: MediaBrowser Token and the ApiKey query parameter. The original diagnosis of an invalid key was incorrect.

Updated web library, artwork, lyrics/audio URLs and legacy reporting to supported authentication spellings. Updated native library/artwork requests and native audio URLs. Native session reporting now uses Authorization and reads both current and persisted legacy URL parameter names.

Live checks passed for users, music library discovery, albums, album tracks, and the WebView CORS preflight. The 15 existing JavaScript suites plus the new authentication regression suite passed; type checking and production web build passed. Physical-device playback has not been rerun for this fix.
