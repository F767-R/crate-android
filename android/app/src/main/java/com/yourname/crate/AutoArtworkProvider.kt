package com.yourname.crate

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Serves album artwork to Android Auto. Auto fetches browse thumbnails itself and cannot load an
 * authenticated http URL, so artwork is cached locally and handed over as a content:// file.
 *
 * Uri shape: content://<package>.autoart/album/<albumId>?s=<size>&t=<imageTag>
 * Ids and tags are validated before use, only reads are supported, and the cache is size-bounded.
 */
class AutoArtworkProvider : ContentProvider() {
    private val repository by lazy { NativeLibraryRepository() }

    override fun onCreate() = true

    override fun getType(uri: Uri): String? = "image/jpeg"

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        if (mode != "r") throw SecurityException("Read only.")
        val albumId = uri.pathSegments.takeIf { it.size == 2 && it[0] == "album" }?.get(1)
            ?.takeIf { SAFE_ID.matches(it) } ?: throw java.io.FileNotFoundException()
        val size = (uri.getQueryParameter("s")?.toIntOrNull() ?: DEFAULT_SIZE).coerceIn(64, 800)
        val tag = uri.getQueryParameter("t")?.takeIf { it.isNotEmpty() }
        if (tag != null && !SAFE_ID.matches(tag)) throw java.io.FileNotFoundException()
        val directory = File(context!!.cacheDir, "auto_art").apply { mkdirs() }
        val file = File(directory, "$albumId-$size-${tag ?: "x"}.jpg")
        if (!file.isFile || file.length() == 0L) {
            download(repository.artworkUrl(albumId, size, tag), file)
            prune(directory)
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    private fun download(address: String, target: File) {
        val partial = File(target.parentFile, target.name + ".part")
        val connection = URL(address).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10000
            connection.readTimeout = 10000
            connection.instanceFollowRedirects = false
            if (connection.responseCode != 200) throw java.io.FileNotFoundException()
            connection.inputStream.use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    var total = 0
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_IMAGE_BYTES) throw java.io.FileNotFoundException()
                        output.write(buffer, 0, count)
                    }
                }
            }
            if (!partial.renameTo(target)) throw java.io.FileNotFoundException()
        } catch (error: Exception) {
            partial.delete()
            if (error is java.io.FileNotFoundException) throw error
            throw java.io.FileNotFoundException()
        } finally { connection.disconnect() }
    }

    /** Drops the oldest files once the cache grows past its budget. */
    private fun prune(directory: File) {
        val files = directory.listFiles()?.filter { it.isFile } ?: return
        var total = files.sumOf { it.length() }
        if (total <= MAX_CACHE_BYTES) return
        for (file in files.sortedBy { it.lastModified() }) {
            if (total <= MAX_CACHE_BYTES * 3 / 4) break
            total -= file.length()
            file.delete()
        }
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

    companion object {
        private val SAFE_ID = Regex("^[A-Za-z0-9_-]{1,64}$")
        private const val DEFAULT_SIZE = 400
        private const val MAX_IMAGE_BYTES = 3 * 1024 * 1024
        private const val MAX_CACHE_BYTES = 60L * 1024 * 1024

        fun authority(packageName: String) = "$packageName.autoart"
    }
}
