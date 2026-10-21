package com.yourname.crate

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
import java.security.MessageDigest
import java.util.UUID

internal data class NativeAlbum(val id: String, val title: String, val artist: String, val year: Int?, val imageTag: String?)
internal data class NativeTrack(val id: String, val title: String, val artist: String, val albumId: String,
    val albumTitle: String, val durationMs: Long, val number: Int, val disc: Int)

internal object NativeLibraryCodec {
    fun artist(item: JSONObject): String {
        val names = item.optJSONArray("Artists") ?: item.optJSONArray("ArtistNames")
        if (names != null && names.length() > 0) return (0 until names.length()).map { names.optString(it) }.filter { it.isNotBlank() }.joinToString(", ")
        val artists = item.optJSONArray("ArtistItems")
        if (artists != null && artists.length() > 0) return (0 until artists.length()).mapNotNull { artists.optJSONObject(it)?.optString("Name") }.filter { it.isNotBlank() }.joinToString(", ")
        return item.optString("AlbumArtist", "")
    }
    fun album(item: JSONObject): NativeAlbum {
        val id = item.optString("Id").also { require(it.isNotBlank()) }
        return NativeAlbum(id, item.optString("Name", "Untitled album"), artist(item),
            item.optInt("ProductionYear").takeIf { it > 0 }, item.optJSONObject("ImageTags")?.optString("Primary")?.takeIf { it.isNotBlank() })
    }
    fun tracks(items: JSONArray, album: NativeAlbum): List<NativeTrack> = (0 until items.length()).map { index ->
        val item = items.getJSONObject(index)
        NativeTrack(item.getString("Id").also { require(it.isNotBlank()) }, item.optString("Name", "Untitled track"), artist(item),
            album.id, album.title, (item.optLong("RunTimeTicks") / 10000).coerceAtLeast(0),
            item.optInt("IndexNumber", index + 1), item.optInt("ParentIndexNumber", 1).coerceAtLeast(1))
    }.sortedWith(compareBy({ it.disc }, { it.number }, { it.title }))
    fun scope(server: String, key: String): String = server.trimEnd('/') + "|" +
        MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

internal class NativeLibraryRepository(
    private val server: String = BuildConfig.JELLYFIN_SERVER,
    private val apiKey: String = BuildConfig.JELLYFIN_API_KEY,
) {
    val scope = NativeLibraryCodec.scope(server, apiKey)
    private var userId: String? = null
    private val deviceId = "crate-native-${UUID.randomUUID()}"
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    private fun url(path: String, params: Map<String, String> = emptyMap()): String = server.trimEnd('/') + path +
        if (params.isEmpty()) "" else params.entries.joinToString("&", "?") { "${encode(it.key)}=${encode(it.value)}" }

    private fun request(path: String, params: Map<String, String> = emptyMap()): String {
        val connection = URL(url(path, params)).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "MediaBrowser Token=\"$apiKey\"")
            connection.setRequestProperty("Accept", "application/json")
            when (connection.responseCode) {
                200 -> Unit
                401, 403 -> throw IllegalStateException("Server access was rejected. Check your credentials in the current interface.")
                else -> throw IllegalStateException("The library server could not complete the request. Please retry.")
            }
            val bytes = connection.inputStream.use { stream ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > 8 * 1024 * 1024) throw IllegalStateException("The server response is too large.")
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            return String(bytes, Charsets.UTF_8)
        } finally { connection.disconnect() }
    }
    private fun user(): String {
        userId?.let { return it }
        val users = JSONArray(request("/Users"))
        val id = users.optJSONObject(0)?.optString("Id")?.takeIf { it.isNotBlank() }
            ?: throw IllegalStateException("No Jellyfin user is available.")
        userId = id
        return id
    }
    private fun items(path: String, params: Map<String, String>): JSONArray {
        val result = JSONArray()
        var offset = 0
        while (true) {
            val response = JSONObject(request(path, params + mapOf("StartIndex" to "$offset", "Limit" to "500")))
            val page = response.getJSONArray("Items")
            for (index in 0 until page.length()) result.put(page.getJSONObject(index))
            offset += page.length()
            if (page.length() == 0 || offset >= response.optInt("TotalRecordCount", Int.MAX_VALUE) || page.length() < 500) return result
            if (offset >= 10000) throw IllegalStateException("This preview supports up to 10,000 items per list. Use the current interface for larger libraries.")
        }
    }
    private fun musicLibraryId(encodedUser: String): String {
        val views = JSONObject(request("/Users/$encodedUser/Views")).getJSONArray("Items")
        return (0 until views.length()).map { views.getJSONObject(it) }.firstOrNull { it.optString("CollectionType") == "music" }
            ?.getString("Id") ?: throw IllegalStateException("No music library was found.")
    }
    suspend fun albums(): List<NativeAlbum> = withContext(Dispatchers.IO) {
        val uid = encode(user())
        val items = items("/Users/$uid/Items", mapOf("ParentId" to musicLibraryId(uid), "IncludeItemTypes" to "MusicAlbum",
            "Recursive" to "true", "SortBy" to "SortName", "SortOrder" to "Ascending", "Fields" to "ProductionYear,AlbumArtist"))
        (0 until items.length()).map { NativeLibraryCodec.album(items.getJSONObject(it)) }
    }
    /** Newest albums first; a single small page, used for Android Auto's "For you" suggestions. */
    suspend fun recentAlbums(limit: Int = 12): List<NativeAlbum> = withContext(Dispatchers.IO) {
        val uid = encode(user())
        val page = JSONObject(request("/Users/$uid/Items", mapOf("ParentId" to musicLibraryId(uid), "IncludeItemTypes" to "MusicAlbum",
            "Recursive" to "true", "SortBy" to "DateCreated", "SortOrder" to "Descending", "Limit" to "$limit",
            "Fields" to "ProductionYear,AlbumArtist"))).getJSONArray("Items")
        (0 until page.length()).map { NativeLibraryCodec.album(page.getJSONObject(it)) }
    }
    suspend fun tracks(album: NativeAlbum): List<NativeTrack> = withContext(Dispatchers.IO) {
        NativeLibraryCodec.tracks(items("/Users/${encode(user())}/Items", mapOf("ParentId" to album.id,
            "IncludeItemTypes" to "Audio", "SortBy" to "ParentIndexNumber,IndexNumber", "SortOrder" to "Ascending",
            "Fields" to "RunTimeTicks,ParentIndexNumber,ArtistItems")), album)
    }
    fun artwork(album: NativeAlbum, size: Int) = url("/Items/${encode(album.id)}/Images/Primary", mapOf("maxWidth" to "$size", "quality" to "90", "tag" to (album.imageTag ?: "")))
    fun imageToken() = apiKey
    /** Album artwork URL that an out-of-process client (Android Auto) can fetch without extra headers. */
    fun artworkUrl(albumId: String, size: Int, imageTag: String? = null): String = url("/Items/${encode(albumId)}/Images/Primary",
        mapOf("maxWidth" to "$size", "quality" to "90", "ApiKey" to apiKey) + (imageTag?.let { mapOf("tag" to it) } ?: emptyMap()))
    private fun stream(id: String, high: Boolean): String = url("/Audio/${encode(id)}/universal", mapOf(
        "UserId" to (userId ?: ""), "DeviceId" to deviceId, "PlaySessionId" to UUID.randomUUID().toString(),
        "Container" to if (high) "flac" else "opus,webm,ogg", "AudioCodec" to if (high) "flac" else "opus",
        "TranscodingContainer" to if (high) "flac" else "ogg", "TranscodingProtocol" to "http",
        "MaxStreamingBitrate" to if (high) "14112000" else "128000", "ApiKey" to apiKey))
    fun selection(tracks: List<NativeTrack>, index: Int): JSONObject {
        require(index in tracks.indices)
        val values = JSONArray()
        tracks.forEach { track -> values.put(JSONObject().put("id", track.id).put("title", track.title).put("originalTitle", track.title)
            .put("artist", track.artist).put("originalArtist", track.artist).put("albumId", track.albumId)
            .put("albumTitle", track.albumTitle).put("originalAlbumTitle", track.albumTitle)
            .put("durationMs", track.durationMs).put("trackNumber", track.number).put("discNumber", track.disc)
            .put("lowUrl", stream(track.id, false)).put("highUrl", stream(track.id, true))
            .put("artUrl", url("/Items/${encode(track.albumId)}/Images/Primary", mapOf("maxWidth" to "400", "ApiKey" to apiKey)))) }
        return JSONObject().put("tracks", values).put("index", index).put("queueMode", "preserve").put("playWhenReady", true)
    }
}
