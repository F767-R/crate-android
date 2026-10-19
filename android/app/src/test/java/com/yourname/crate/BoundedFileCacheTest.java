package com.yourname.crate;

import static org.junit.Assert.*;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Uses disposable fixture directories only, never the app's cache or connected phone. */
public class BoundedFileCacheTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    private BoundedFileCache cache(long limit, long fileLimit) throws IOException {
        return new BoundedFileCache(temporary.newFolder(), ".audio", limit, fileLimit);
    }

    private File add(BoundedFileCache cache, String name, int bytes) throws IOException {
        BoundedFileCache.Download download = cache.begin(name);
        assertNotNull(download);
        try {
            try (FileOutputStream output = new FileOutputStream(download.temporary)) {
                cache.write(download, output, new byte[bytes], bytes);
            }
            assertTrue(cache.complete(download));
            return download.target;
        } finally {
            cache.finish(download);
        }
    }

    @Test public void evictsLeastRecentlyUsedCompletedFile() throws Exception {
        BoundedFileCache cache = cache(12, 12);
        File oldest = add(cache, "old.audio", 4);
        File newer = add(cache, "new.audio", 4);
        oldest.setLastModified(1L);
        newer.setLastModified(2L);
        add(cache, "incoming.audio", 8);
        assertFalse(oldest.exists());
        assertTrue(newer.exists());
        assertEquals(12L, cache.sizeBytes());
    }

    @Test public void lookupRefreshesRecency() throws Exception {
        BoundedFileCache cache = cache(8, 8);
        File one = add(cache, "one.audio", 4);
        File two = add(cache, "two.audio", 4);
        one.setLastModified(1L);
        two.setLastModified(2L);
        cache.find("one.audio", false);
        add(cache, "three.audio", 4);
        assertTrue(one.exists());
        assertFalse(two.exists());
    }

    @Test public void protectsPlayingFileAndActiveDownloadFromEviction() throws Exception {
        BoundedFileCache cache = cache(10, 10);
        File playing = add(cache, "playing.audio", 6);
        cache.find("playing.audio", true);
        BoundedFileCache.Download download = cache.begin("incoming.audio");
        try (FileOutputStream output = new FileOutputStream(download.temporary)) {
            cache.write(download, output, new byte[4], 4);
            try {
                cache.write(download, output, new byte[1], 1);
                fail("Cap must reject additional bytes, not evict active files");
            } catch (IOException expected) { }
            assertTrue(playing.exists());
            assertEquals(4L, download.temporary.length());
            assertEquals(10L, cache.sizeBytes());
        } finally {
            cache.finish(download);
        }
        assertFalse(download.temporary.exists());
        assertEquals(6L, cache.sizeBytes());
    }

    @Test public void rejectsWholeChunkPastPerFileLimit() throws Exception {
        BoundedFileCache cache = cache(100, 5);
        BoundedFileCache.Download download = cache.begin("oversized.audio");
        try (FileOutputStream output = new FileOutputStream(download.temporary)) {
            try {
                cache.write(download, output, new byte[6], 6);
                fail("Oversized files must not be partially promoted");
            } catch (IOException expected) { }
            assertEquals(0L, download.temporary.length());
            assertFalse(cache.complete(download));
        } finally {
            cache.finish(download);
        }
        assertEquals(0L, cache.sizeBytes());
    }

    @Test public void clearKeepsPlayingFileAndCancelsInflightDownload() throws Exception {
        BoundedFileCache cache = cache(100, 100);
        File playing = add(cache, "playing.audio", 4);
        File other = add(cache, "other.audio", 4);
        cache.find("playing.audio", true);
        BoundedFileCache.Download download = cache.begin("inflight.audio");
        try (FileOutputStream output = new FileOutputStream(download.temporary)) {
            cache.write(download, output, new byte[3], 3);
            cache.clear();
            assertTrue(playing.exists());
            assertFalse(other.exists());
            assertTrue(download.cancelled);
            assertFalse(cache.complete(download));
            try {
                cache.write(download, output, new byte[1], 1);
                fail("Cancelled download must not restart");
            } catch (IOException expected) { }
        } finally {
            cache.finish(download);
        }
        assertEquals(4L, cache.sizeBytes());
        cache.retainPin(null);
        cache.clear();
        assertEquals(0L, cache.sizeBytes());
    }

    @Test public void lowerLimitDefersProtectedFileEvictionUntilReleased() throws Exception {
        BoundedFileCache cache = cache(100, 100);
        File playing = add(cache, "playing.audio", 20);
        add(cache, "other.audio", 10);
        cache.find("playing.audio", true);
        cache.setLimit(15);
        assertTrue(playing.exists());
        assertEquals(20L, cache.sizeBytes());
        cache.retainPin(null);
        assertEquals(0L, cache.sizeBytes());
    }

    @Test public void restartRemovesStalePartialAndOversizedFiles() throws Exception {
        File directory = temporary.newFolder();
        File partial = new File(directory, "old.audio.tmp");
        File oversized = new File(directory, "huge.audio");
        try (FileOutputStream output = new FileOutputStream(partial)) { output.write(new byte[3]); }
        try (FileOutputStream output = new FileOutputStream(oversized)) { output.write(new byte[9]); }
        BoundedFileCache cache = new BoundedFileCache(directory, ".audio", 100, 8);
        assertFalse(partial.exists());
        assertFalse(oversized.exists());
        assertEquals(0L, cache.sizeBytes());
    }

    @Test public void downloadedIdsExcludePartialFilesAndDoNotRefreshRecency() throws Exception {
        BoundedFileCache cache = cache(10, 10);
        File oldest = add(cache, "old.audio", 4);
        File newer = add(cache, "new.audio", 4);
        oldest.setLastModified(1L);
        newer.setLastModified(2L);
        BoundedFileCache.Download partial = cache.begin("pending.audio");
        assertEquals(java.util.Arrays.asList("new", "old"), cache.completedIds());
        assertEquals(1L, oldest.lastModified());
        cache.finish(partial);
        add(cache, "next.audio", 4);
        assertEquals(java.util.Arrays.asList("new", "next"), cache.completedIds());
        cache.clear();
        assertTrue(cache.completedIds().isEmpty());
    }

    @Test public void itemNamesCannotEscapeCacheDirectory() throws Exception {
        BoundedFileCache cache = cache(100, 100);
        assertNull(cache.find("../outside.audio", false));
        assertNull(cache.find("..\\outside.audio", false));
        try {
            cache.begin("../outside.audio");
            fail("Paths must not be accepted as item IDs");
        } catch (IOException expected) { }
    }

    @Test public void multipleActiveDownloadsShareOneBudget() throws Exception {
        BoundedFileCache cache = cache(10, 10);
        BoundedFileCache.Download first = cache.begin("first.audio");
        BoundedFileCache.Download second = cache.begin("second.audio");
        assertNull(cache.begin("first.audio"));
        try (FileOutputStream one = new FileOutputStream(first.temporary);
             FileOutputStream two = new FileOutputStream(second.temporary)) {
            cache.write(first, one, new byte[6], 6);
            cache.write(second, two, new byte[4], 4);
            try {
                cache.write(second, two, new byte[1], 1);
                fail("Combined cache budget must include both partial files");
            } catch (IOException expected) { }
            assertEquals(10L, cache.sizeBytes());
        } finally {
            cache.finish(first);
            cache.finish(second);
        }
    }
}
