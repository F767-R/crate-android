package com.yourname.crate

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.*
import org.junit.Assert.*
import org.json.JSONObject
import java.net.ServerSocket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import android.graphics.Bitmap
import java.io.File

class NativeLibraryFlowTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var server: ServerSocket
    private val pool = Executors.newCachedThreadPool()
    @Volatile private var fail = false
    @Volatile private var authorized = false
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Before fun startServer() {
        Assume.assumeTrue("Run with -PnativeFixture", BuildConfig.JELLYFIN_API_KEY == "fixture-only")
        server = ServerSocket(18099, 20, java.net.InetAddress.getByName("127.0.0.1"))
        pool.execute {
            while (!server.isClosed) try {
                val socket = server.accept()
                pool.execute { socket.use {
                    val input = it.getInputStream().bufferedReader()
                    val path = input.readLine()?.split(' ')?.getOrNull(1) ?: return@use
                    var line: String?
                    do { line = input.readLine(); if (line?.equals("Authorization: MediaBrowser Token=\"fixture-only\"", true) == true) authorized = true } while (!line.isNullOrEmpty())
                    val audio = path.startsWith("/Audio/")
                    val body = if (audio) wav() else when {
                        path.startsWith("/Users/u/Views") -> """{"Items":[{"Id":"music","CollectionType":"music"}]}""".toByteArray()
                        path.startsWith("/Users/u/Items") && path.contains("IncludeItemTypes=Audio") -> """{"Items":[
                            {"Id":"one","Name":"First song","Artists":["Singer"],"ParentIndexNumber":1,"IndexNumber":1,"RunTimeTicks":1200000000},
                            {"Id":"two","Name":"Second song","Artists":["Singer"],"ParentIndexNumber":2,"IndexNumber":1,"RunTimeTicks":1200000000}]}""".toByteArray()
                        path.startsWith("/Users/u/Items") -> """{"Items":[{"Id":"album","Name":"Native test album","AlbumArtist":"Fixture artist","ProductionYear":2022}]}""".toByteArray()
                        path == "/Users" -> """[{"Id":"u"}]""".toByteArray()
                        else -> "{}".toByteArray()
                    }
                    val status = if (fail && path.startsWith("/Users")) "503 Service Unavailable" else "200 OK"
                    val header = "HTTP/1.1 $status\r\nContent-Type: ${if (audio) "audio/wav" else "application/json"}\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                    try { it.getOutputStream().write(header.toByteArray()); it.getOutputStream().write(body) } catch (_: Exception) {}
                } }
            } catch (_: Exception) { }
        }
    }
    private fun wav(): ByteArray {
        val size = 8000 * 2 * 120
        return ByteBuffer.allocate(44 + size).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + size); put("WAVEfmt ".toByteArray()); putInt(16)
            putShort(1); putShort(1); putInt(8000); putInt(16000); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(size)
        }.array()
    }
    private fun snapshot(): JSONObject {
        val value = AtomicReference<JSONObject>(JSONObject())
        instrumentation.runOnMainSync { PlaybackService.getInstance()?.let { value.set(it.coordinator().snapshot()) } }
        return value.get()
    }
    private fun waitFor(predicate: () -> Boolean) {
        val end = System.currentTimeMillis() + 15000
        while (System.currentTimeMillis() < end) { if (predicate()) return; Thread.sleep(100) }
        assertTrue("Condition timed out", predicate())
    }
    @Test fun albumPlaybackRetryAndActivityRecreation() {
        ActivityScenario.launch(NativeLibraryActivity::class.java).use { scenario ->
            compose.waitUntil(15000) { compose.onAllNodesWithText("Native test album").fetchSemanticsNodes().isNotEmpty() }
            assertTrue("Native library sends the configured token", authorized)
            compose.onNodeWithText("Native test album").performClick()
            compose.onNodeWithText("2022").assertExists()
            compose.waitUntil(15000) { compose.onAllNodes(hasText("Refresh") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("album-tracks").performScrollToNode(hasText("First song"))
            compose.onNodeWithText("First song").performScrollTo().performClick()
            waitFor { snapshot().optJSONObject("currentTrack")?.optString("id") == "one" && snapshot().optBoolean("isPlaying") }
            instrumentation.runOnMainSync {
                PlaybackService.getInstance().coordinator().mutateQueue(JSONObject().put("action", "add")
                    .put("track", NativeLibraryRepository().selection(listOf(NativeTrack("queued", "Queued", "Singer", "album", "Album", 120000, 3, 2)), 0).getJSONArray("tracks").getJSONObject(0)))
            }
            compose.onNodeWithTag("album-tracks").performScrollToNode(hasText("Second song"))
            compose.onNodeWithText("Second song").performClick()
            waitFor { snapshot().optJSONObject("currentTrack")?.optString("id") == "two" }
            assertEquals("queued", snapshot().getJSONArray("queue").getJSONObject(0).getString("id"))
            compose.onNodeWithText("Pause", useUnmergedTree = true).performClick()
            waitFor { !snapshot().optBoolean("desiredPlaying") }
            scenario.recreate()
            compose.waitUntil(15000) { compose.onAllNodesWithText("2022").fetchSemanticsNodes().isNotEmpty() }
            assertFalse("Recreation must not autoplay", snapshot().optBoolean("desiredPlaying"))
            compose.onNodeWithText("Play", useUnmergedTree = true).performClick()
            waitFor { snapshot().optBoolean("isPlaying") }
            compose.onNodeWithText("Pause", useUnmergedTree = true).performClick()
            fail = true
            compose.onNodeWithText("Refresh").performClick()
            compose.waitUntil(15000) { compose.onAllNodesWithText("Retry library").fetchSemanticsNodes().isNotEmpty() }
            fail = false
            compose.onNodeWithText("Retry library").performClick()
            compose.waitUntil(15000) { compose.onAllNodesWithText("Retry library").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithTag("album-tracks").performScrollToIndex(0)
            scenario.onActivity { activity ->
                val file = File(activity.getExternalFilesDir(null), "native-album.png")
                // Screenshot is captured below outside the main-thread callback.
                file.parentFile?.mkdirs()
            }
            val image = compose.onRoot().captureToImage().asAndroidBitmap()
            File(instrumentation.targetContext.getExternalFilesDir(null), "native-album.png").outputStream().use { output ->
                image.compress(Bitmap.CompressFormat.PNG, 100, output)
            }
            compose.onNodeWithText("← Albums").performClick()
            compose.onNodeWithText("Search albums or artists").performTextInput("not found")
            compose.onNodeWithText("No matching albums").assertExists()
            compose.onNodeWithText("Current interface").performClick()
            waitFor { scenario.state == androidx.lifecycle.Lifecycle.State.DESTROYED }
        }
    }
    @After fun stopServer() {
        if (::server.isInitialized) server.close()
        pool.shutdownNow()
        instrumentation.runOnMainSync { PlaybackService.getInstance()?.coordinator()?.pause() }
    }
}
