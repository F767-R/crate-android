package com.yourname.crate

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.function.Consumer

/**
 * Browse tree and "play this" handling for Android Auto and other media browsers.
 *
 * Root -> "Albums" tab (every album, as a grid like the app) -> album -> tracks.
 * Playback is not handed to the session player: [onPlay] receives the same payload the
 * native library screen uses, so the queue stays owned by the native coordinator.
 */
class AutoLibraryCallback(
    private val ownPackage: String,
    private val onPlay: Consumer<JSONObject>,
) : MediaLibraryService.MediaLibrarySession.Callback {

    private val repository by lazy { NativeLibraryRepository() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lock = Any()
    private var albums: List<NativeAlbum>? = null
    private var albumsLoadedAt = 0L
    private val trackCache = object : LinkedHashMap<String, List<NativeTrack>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<NativeTrack>>?) = size > MAX_CACHED_ALBUMS
    }

    fun release() = scope.cancel()

    // ---- Library access: the catalogue lists private titles, so only known browsers may read it ----

    private fun trusted(controller: MediaSession.ControllerInfo) =
        controller.packageName == ownPackage || controller.packageName in TRUSTED_BROWSERS

    override fun onGetLibraryRoot(
        session: MediaLibraryService.MediaLibrarySession, browser: MediaSession.ControllerInfo,
        params: MediaLibraryService.LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> {
        if (!trusted(browser)) return immediate(LibraryResult.ofError(LibraryResult.RESULT_ERROR_PERMISSION_DENIED))
        // Android Auto's "For you" card asks for a separate suggested root.
        if (params?.isSuggested == true) return immediate(LibraryResult.ofItem(folder(SUGGESTED_ID, "For you"), libraryParams(GRID, LIST)))
        return immediate(LibraryResult.ofItem(folder(ROOT_ID, "C.R.A.T.E."), libraryParams(GRID, LIST)))
    }

    override fun onGetItem(
        session: MediaLibraryService.MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
        if (!trusted(browser)) return immediate(LibraryResult.ofError(LibraryResult.RESULT_ERROR_PERMISSION_DENIED))
        return launchResult {
            val item = when {
                mediaId == ROOT_ID -> folder(ROOT_ID, "C.R.A.T.E.")
                mediaId == SUGGESTED_ID -> folder(SUGGESTED_ID, "For you")
                mediaId == ALBUMS_ID -> folder(ALBUMS_ID, "Albums")
                mediaId.startsWith(ALBUM_PREFIX) -> loadAlbums().firstOrNull { it.id == mediaId.removePrefix(ALBUM_PREFIX) }?.let(::albumFolder)
                mediaId.startsWith(TRACK_PREFIX) -> trackFromId(mediaId)
                else -> null
            }
            if (item == null) LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE) else LibraryResult.ofItem(item, null)
        }
    }

    override fun onGetChildren(
        session: MediaLibraryService.MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String,
        page: Int, pageSize: Int, params: MediaLibraryService.LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        if (!trusted(browser)) return immediate(LibraryResult.ofError(LibraryResult.RESULT_ERROR_PERMISSION_DENIED))
        return launchResult {
            val all: List<MediaItem> = when {
                // Auto shows the root's children as tabs, so the root holds one tab and every album sits under it.
                parentId == ROOT_ID -> listOf(folder(ALBUMS_ID, "Albums"))
                parentId == ALBUMS_ID -> loadAlbums().map(::albumFolder)
                parentId == SUGGESTED_ID -> repository.recentAlbums().map(::albumPlayable)
                parentId.startsWith(ALBUM_PREFIX) -> {
                    val album = loadAlbums().firstOrNull { it.id == parentId.removePrefix(ALBUM_PREFIX) }
                    if (album == null) emptyList() else tracksFor(album).map { trackItem(it) }
                }
                else -> return@launchResult LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE)
            }
            val from = (page.coerceAtLeast(0) * pageSize.coerceAtLeast(1)).coerceAtMost(all.size)
            val to = (from + pageSize.coerceAtLeast(1)).coerceAtMost(all.size)
            // Albums are a grid like the app; tracks read best as a list.
            val hints = if (parentId == ROOT_ID || parentId == ALBUMS_ID) libraryParams(GRID, LIST) else libraryParams(LIST, LIST)
            LibraryResult.ofItemList(ImmutableList.copyOf(all.subList(from, to)), hints)
        }
    }

    // ---- Playback ----

    override fun onSetMediaItems(
        mediaSession: MediaSession, controller: MediaSession.ControllerInfo,
        mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
        val result = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
        val requested = mediaItems.getOrNull(startIndex.coerceAtLeast(0))?.mediaId
        if (!trusted(controller) || requested == null) {
            result.setException(SecurityException("Playback request not allowed."))
            return result
        }
        scope.launch {
            try {
                val (tracks, index) = resolve(requested)
                onPlay.accept(repository.selection(tracks, index))
                result.set(MediaSession.MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs))
            } catch (error: Exception) {
                result.setException(IllegalStateException("Could not start this item."))
            }
        }
        return result
    }

    private suspend fun resolve(mediaId: String): Pair<List<NativeTrack>, Int> {
        when {
            mediaId.startsWith(TRACK_PREFIX) -> {
                val (albumId, trackId) = splitTrackId(mediaId) ?: throw IllegalArgumentException("Bad track id")
                val album = loadAlbums().first { it.id == albumId }
                val tracks = tracksFor(album)
                val index = tracks.indexOfFirst { it.id == trackId }
                require(index >= 0)
                return tracks to index
            }
            mediaId.startsWith(ALBUM_PREFIX) -> {
                val album = loadAlbums().first { it.id == mediaId.removePrefix(ALBUM_PREFIX) }
                val tracks = tracksFor(album)
                require(tracks.isNotEmpty())
                return tracks to 0
            }
            else -> throw IllegalArgumentException("Unsupported item")
        }
    }

    // ---- Data ----

    private suspend fun loadAlbums(): List<NativeAlbum> {
        synchronized(lock) {
            val cached = albums
            if (cached != null && System.currentTimeMillis() - albumsLoadedAt < ALBUM_TTL_MS) return cached
        }
        val fresh = repository.albums()
        synchronized(lock) { albums = fresh; albumsLoadedAt = System.currentTimeMillis() }
        return fresh
    }

    private suspend fun tracksFor(album: NativeAlbum): List<NativeTrack> {
        synchronized(lock) { trackCache[album.id]?.let { return it } }
        val fresh = repository.tracks(album)
        synchronized(lock) { trackCache[album.id] = fresh }
        return fresh
    }

    private suspend fun trackFromId(mediaId: String): MediaItem? {
        val (albumId, trackId) = splitTrackId(mediaId) ?: return null
        val album = loadAlbums().firstOrNull { it.id == albumId } ?: return null
        return tracksFor(album).firstOrNull { it.id == trackId }?.let { trackItem(it) }
    }

    private fun splitTrackId(mediaId: String): Pair<String, String>? {
        val parts = mediaId.removePrefix(TRACK_PREFIX).split(':', limit = 2)
        return if (parts.size == 2 && parts[0].isNotBlank() && parts[1].isNotBlank()) parts[0] to parts[1] else null
    }

    // ---- Items ----

    private fun folder(id: String, title: String): MediaItem = MediaItem.Builder().setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setIsBrowsable(true).setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).setExtras(hints(GRID, LIST)).build()).build()

    // Content-style hints understood by Android Auto (1 = list, 2 = grid).
    private fun hints(browsable: Int, playable: Int) = Bundle().apply {
        putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true)
        putInt("android.media.browse.CONTENT_STYLE_BROWSABLE_HINT", browsable)
        putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", playable)
    }
    private fun libraryParams(browsable: Int, playable: Int) =
        MediaLibraryService.LibraryParams.Builder().setExtras(hints(browsable, playable)).build()

    private fun artwork(albumId: String, imageTag: String? = null): Uri = Uri.Builder().scheme("content")
        .authority(AutoArtworkProvider.authority(ownPackage)).appendPath("album").appendPath(albumId)
        .appendQueryParameter("s", ART_SIZE.toString()).apply { if (imageTag != null) appendQueryParameter("t", imageTag) }.build()

    private fun albumFolder(album: NativeAlbum): MediaItem = MediaItem.Builder().setMediaId("$ALBUM_PREFIX${album.id}")
        .setMediaMetadata(MediaMetadata.Builder().setTitle(album.title).setArtist(album.artist).setSubtitle(album.artist)
            .setIsBrowsable(true).setIsPlayable(false).setMediaType(MediaMetadata.MEDIA_TYPE_ALBUM)
            .setExtras(hints(LIST, LIST)).setArtworkUri(artwork(album.id, album.imageTag)).build()).build()

    /** Tapping a suggestion plays the album, so it is playable rather than browsable. */
    private fun albumPlayable(album: NativeAlbum): MediaItem = MediaItem.Builder().setMediaId("$ALBUM_PREFIX${album.id}")
        .setMediaMetadata(MediaMetadata.Builder().setTitle(album.title).setArtist(album.artist).setSubtitle(album.artist)
            .setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_ALBUM)
            .setArtworkUri(artwork(album.id, album.imageTag)).build()).build()

    private fun trackItem(track: NativeTrack): MediaItem = MediaItem.Builder().setMediaId("$TRACK_PREFIX${track.albumId}:${track.id}")
        .setMediaMetadata(MediaMetadata.Builder().setTitle(track.title).setArtist(track.artist).setAlbumTitle(track.albumTitle)
            .setSubtitle(track.artist).setDurationMs(track.durationMs).setTrackNumber(track.number)
            .setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .setArtworkUri(artwork(track.albumId)).build()).build()

    // ---- Futures ----

    private fun <T> immediate(value: T): ListenableFuture<T> = SettableFuture.create<T>().also { it.set(value) }

    /** Runs [block] off the main thread; any failure becomes a generic error so no URL or message leaks. */
    private fun <T : Any> launchResult(block: suspend () -> LibraryResult<T>): ListenableFuture<LibraryResult<T>> {
        val future = SettableFuture.create<LibraryResult<T>>()
        scope.launch {
            try { future.set(block()) }
            catch (error: Exception) { future.set(LibraryResult.ofError<T>(LibraryResult.RESULT_ERROR_IO)) }
        }
        return future
    }

    private companion object {
        const val LIST = 1
        const val GRID = 2
        const val ROOT_ID = "root"
        const val SUGGESTED_ID = "suggested"
        const val ALBUMS_ID = "albums"
        const val ALBUM_PREFIX = "album:"
        const val TRACK_PREFIX = "track:"
        const val ART_SIZE = 400
        const val MAX_CACHED_ALBUMS = 24
        const val ALBUM_TTL_MS = 5 * 60 * 1000L
        val TRUSTED_BROWSERS = setOf(
            "com.google.android.projection.gearhead", // Android Auto (phone app; also serves the Desktop Head Unit)
            "com.google.android.googlequicksearchbox", // Google Assistant
            "com.android.bluetooth", // car stereos browsing over Bluetooth
            "com.android.systemui",
            "com.example.android.mediacontroller", // Google's Media Controller Test tool
        )
    }
}
