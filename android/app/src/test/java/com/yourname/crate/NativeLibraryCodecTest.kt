package com.yourname.crate

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder

class NativeLibraryCodecTest {
    private val album = NativeAlbum("album", "Long album title", "Artist", 2022, "image")

    @Test fun metadataRetainsDiscNumbersAndSortsTracks() {
        val tracks = NativeLibraryCodec.tracks(JSONArray("""[
          {"Id":"disc2","Name":"Later","ParentIndexNumber":2,"IndexNumber":1,"RunTimeTicks":1200000000},
          {"Id":"second","Name":"Second","ParentIndexNumber":1,"IndexNumber":2,"Artists":["A","B"]},
          {"Id":"first","Name":"First","ParentIndexNumber":1,"IndexNumber":1}
        ]"""), album)
        assertEquals(listOf("first", "second", "disc2"), tracks.map { it.id })
        assertEquals(120000L, tracks.last().durationMs)
        assertEquals("A, B", tracks[1].artist)
        assertEquals(2, tracks.last().disc)
        assertEquals(1, tracks.last().number)
    }

    @Test fun missingYearIsOmittedAndInvalidIdsRejected() {
        assertNull(NativeLibraryCodec.album(JSONObject("""{"Id":"a","Name":"Album"}""")).year)
        assertThrows(IllegalArgumentException::class.java) { NativeLibraryCodec.album(JSONObject("""{"Id":""}""")) }
    }

    @Test fun scopeMatchesWebFingerprintAndIgnoresTrailingSlash() {
        assertEquals("https://example.test|ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            NativeLibraryCodec.scope("https://example.test/", "abc"))
        assertNotEquals(NativeLibraryCodec.scope("https://example.test", "one"), NativeLibraryCodec.scope("https://example.test", "two"))
    }

    @Test fun selectionPreservesQueueAndUsesCompatibleNativeDescriptors() {
        val repository = NativeLibraryRepository("https://example.test/jellyfin", "test key&?")
        val input = repository.selection(listOf(NativeTrack("track /?", "Song", "Singer", "album", "Album", 123000, 7, 2)), 0)
        assertEquals("preserve", input.getString("queueMode"))
        assertTrue(input.getBoolean("playWhenReady"))
        val wire = input.getJSONArray("tracks").getJSONObject(0)
        val parsed = PlaybackSessionCodec.parseTrack(wire)
        assertEquals("track /?", parsed.id)
        assertEquals(7, parsed.trackNumber)
        assertEquals(2, parsed.discNumber)
        val url = URI(wire.getString("lowUrl"))
        assertEquals("/jellyfin/Audio/track%20%2F%3F/universal", url.rawPath)
        val params = url.rawQuery.split('&').associate { val pieces = it.split('=', limit = 2); pieces[0] to URLDecoder.decode(pieces[1], "UTF-8") }
        assertEquals("test key&?", params["ApiKey"])
        assertEquals("opus", params["AudioCodec"])
        val public = PlaybackSessionCodec.track(parsed, false).toString()
        assertFalse(public.contains("lowUrl"))
        assertFalse(public.contains("test key"))
        assertThrows(IllegalArgumentException::class.java) { repository.selection(emptyList(), 0) }
    }
}
