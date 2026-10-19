package com.yourname.crate;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Set;

/** Small, synchronized disk cache. Only complete files are eligible for LRU eviction. */
final class BoundedFileCache {
    static final class Download {
        final File target;
        final File temporary;
        long bytes;
        volatile boolean cancelled;

        Download(File target, File temporary) {
            this.target = target;
            this.temporary = temporary;
        }
    }

    private final File directory;
    private final String suffix;
    private final long maximumFileBytes;
    private final Set<String> pinned = new HashSet<>();
    private final Set<Download> downloads = new HashSet<>();
    private long limitBytes;
    private long usedBytes;

    BoundedFileCache(File directory, String suffix, long limitBytes, long maximumFileBytes) {
        this.directory = directory;
        this.suffix = suffix;
        this.limitBytes = limitBytes;
        this.maximumFileBytes = maximumFileBytes;
        directory.mkdirs();
        // No writers exist when a cache is constructed. Clean interrupted downloads.
        for (File file : files()) {
            if (isTemporary(file) || (file.getName().endsWith(suffix)
                    && (file.length() == 0 || file.length() > maximumFileBytes))) file.delete();
        }
        usedBytes = scanSizeBytes();
        evictToFit(0);
    }

    synchronized long sizeBytes() {
        usedBytes = scanSizeBytes();
        return usedBytes;
    }

    private long scanSizeBytes() {
        long total = 0;
        for (File file : files()) if (isManaged(file)) total += file.length();
        return total;
    }

    /** Completed IDs only; listing must not touch LRU recency or pin files. */
    synchronized ArrayList<String> completedIds() {
        ArrayList<String> ids = new ArrayList<>();
        for (File file : files()) {
            String name = file.getName();
            if (checkedFile(name) != null && file.length() > 0 && file.length() <= maximumFileBytes) {
                ids.add(name.substring(0, name.length() - suffix.length()));
            }
        }
        ids.sort(String::compareTo);
        return ids;
    }

    synchronized long limitBytes() { return limitBytes; }

    synchronized void setLimit(long bytes) {
        limitBytes = bytes;
        usedBytes = scanSizeBytes();
        evictToFit(0);
    }

    synchronized File find(String name, boolean pin) {
        File file = checkedFile(name);
        if (file == null || !file.isFile() || file.length() <= 0) return null;
        if (pin) pinned.add(name);
        file.setLastModified(System.currentTimeMillis());
        return file;
    }

    synchronized void retainPin(String name) {
        pinned.clear();
        if (name != null) pinned.add(name);
        evictToFit(0);
    }

    synchronized Download begin(String name) throws IOException {
        File target = checkedFile(name);
        if (target == null) throw new IOException("Invalid cache item ID");
        for (Download download : downloads) {
            if (download.target.equals(target)) return null;
        }
        File temporary = File.createTempFile("download-", ".part", directory);
        Download download = new Download(target, temporary);
        downloads.add(download);
        return download;
    }

    /** Reserve and write under one lock so concurrent writers cannot exceed the cap. */
    synchronized void write(Download download, OutputStream output, byte[] buffer, int count)
            throws IOException {
        if (download.cancelled || Thread.currentThread().isInterrupted()) {
            throw new IOException("Cache download cancelled");
        }
        if (download.bytes + count > Math.min(maximumFileBytes, limitBytes)
                || !evictToFit(count)) {
            throw new IOException("Cache size limit reached");
        }
        try {
            output.write(buffer, 0, count);
        } catch (IOException error) {
            // A failed disk write can still have written part of the chunk.
            usedBytes = scanSizeBytes();
            throw error;
        }
        usedBytes += count;
        download.bytes += count;
    }

    synchronized boolean complete(Download download) {
        if (download.cancelled || download.bytes <= 0 || !evictToFit(0)) return false;
        // A completed file is never replaced while the player holds it open.
        if (download.target.exists() || !download.temporary.renameTo(download.target)) return false;
        download.target.setLastModified(System.currentTimeMillis());
        return true;
    }

    synchronized void finish(Download download) {
        downloads.remove(download);
        deleteCounted(download.temporary);
        evictToFit(0);
    }

    synchronized void cancelDownloads() {
        for (Download download : downloads) download.cancelled = true;
    }

    /** Keep pinned playback files. Active writers clean their own temporary file in finally. */
    synchronized void clear() {
        cancelDownloads();
        for (File file : files()) {
            if (file.getName().endsWith(suffix) && !pinned.contains(file.getName())) deleteCounted(file);
        }
    }

    private File checkedFile(String name) {
        if (name == null || !name.endsWith(suffix)
                || !name.matches("[A-Za-z0-9_-]+\\Q" + suffix + "\\E")) return null;
        return new File(directory, name);
    }

    private boolean evictToFit(long additionalBytes) {
        // Track writes instead of re-statting every cache file for every 32 KiB chunk.
        if (usedBytes + additionalBytes <= limitBytes) return true;
        ArrayList<File> candidates = new ArrayList<>();
        for (File file : files()) {
            if (file.getName().endsWith(suffix) && !pinned.contains(file.getName())) candidates.add(file);
        }
        candidates.sort(Comparator.comparingLong(File::lastModified).thenComparing(File::getName));
        for (File file : candidates) {
            deleteCounted(file);
            if (usedBytes + additionalBytes <= limitBytes) return true;
        }
        return usedBytes + additionalBytes <= limitBytes;
    }

    private void deleteCounted(File file) {
        long bytes = file.length();
        if (file.delete()) usedBytes = Math.max(0L, usedBytes - bytes);
    }

    private File[] files() {
        File[] files = directory.listFiles(File::isFile);
        return files == null ? new File[0] : files;
    }

    private boolean isTemporary(File file) {
        return file.getName().endsWith(".tmp") || file.getName().endsWith(".part");
    }

    private boolean isManaged(File file) {
        return file.getName().endsWith(suffix) || isTemporary(file);
    }
}
