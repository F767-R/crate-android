package com.yourname.crate;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;

/** Service-owned queue/continuation policy. Pure Java so background behavior is testable. */
final class PlaybackQueueState {
    static final int MAX_TRACKS = 10000;
    static final class Track {
        final String id, title, artist, albumId, lowUrl, highUrl, artUrl;
        final String originalTitle, originalArtist, albumTitle, originalAlbumTitle;
        final int trackNumber, discNumber;
        final long durationMs;
        Track(String id, String title, String artist, String albumId, long durationMs,
              String lowUrl, String highUrl, String artUrl) {
            this(id, title, artist, albumId, durationMs, lowUrl, highUrl, artUrl,
                title, artist, "", "", 0, 0);
        }
        Track(String id, String title, String artist, String albumId, long durationMs,
              String lowUrl, String highUrl, String artUrl, String originalTitle,
              String originalArtist, String albumTitle, String originalAlbumTitle,
              int trackNumber, int discNumber) {
            this.id = id;
            this.title = title == null ? "" : title;
            this.artist = artist == null ? "" : artist;
            this.albumId = albumId;
            this.durationMs = Math.max(0L, durationMs);
            this.lowUrl = lowUrl;
            this.highUrl = highUrl;
            this.artUrl = artUrl;
            this.originalTitle = originalTitle == null ? this.title : originalTitle;
            this.originalArtist = originalArtist == null ? this.artist : originalArtist;
            this.albumTitle = albumTitle == null ? "" : albumTitle;
            this.originalAlbumTitle = originalAlbumTitle == null ? this.albumTitle : originalAlbumTitle;
            this.trackNumber = trackNumber;
            this.discNumber = discNumber;
        }
    }

    enum Advance { PLAY, RESTART, STOP, NONE }
    final List<Track> sourceTracks = new ArrayList<>();
    final List<Track> queue = new ArrayList<>();
    final List<Integer> shuffleHistory = new ArrayList<>();
    private final Random random;
    Track current;
    int index = -1;
    boolean currentFromQueue;
    String repeatMode = "off";
    boolean shuffleOn;
    String quality = "low";
    String sleepMode;
    long sleepEndTimeMs;
    boolean sleepQueueDrained;

    PlaybackQueueState() { this(new Random()); }
    PlaybackQueueState(Random random) { this.random = random; }

    void playSelection(List<Track> tracks, int selected, boolean replaceTail) {
        if (tracks.isEmpty() || tracks.size() > MAX_TRACKS || selected < 0 || selected >= tracks.size()) {
            throw new IllegalArgumentException("Choose a valid track selection");
        }
        sourceTracks.clear();
        sourceTracks.addAll(tracks);
        current = tracks.get(selected);
        currentFromQueue = false;
        index = replaceTail ? tracks.size() - 1 : selected;
        shuffleHistory.clear();
        if (replaceTail) {
            queue.clear();
            queue.addAll(tracks.subList(selected + 1, tracks.size()));
        }
        sleepQueueDrained = "queue".equals(sleepMode) && queue.isEmpty();
    }

    void replaceQueue(List<Track> tracks) {
        if (tracks.size() > MAX_TRACKS) throw new IllegalArgumentException("Queue is too large");
        queue.clear();
        queue.addAll(tracks);
        sleepQueueDrained = "queue".equals(sleepMode) && queue.isEmpty();
    }

    boolean playQueueItem(int selected) {
        if (selected < 0 || selected >= queue.size()) return false;
        current = queue.remove(selected);
        currentFromQueue = true;
        sleepQueueDrained = "queue".equals(sleepMode) && queue.isEmpty();
        return true;
    }

    Advance next(boolean ended) {
        if (current == null) return Advance.NONE;
        if (ended && ("track".equals(sleepMode)
                || ("queue".equals(sleepMode) && sleepQueueDrained))) {
            clearSleep();
            return Advance.STOP;
        }
        if (ended && "one".equals(repeatMode)) return Advance.PLAY;
        if (!queue.isEmpty()) {
            playQueueItem(0);
            return Advance.PLAY;
        }
        if (sourceTracks.isEmpty()) return Advance.NONE;
        if (shuffleOn) {
            if (sourceTracks.size() <= 1) return Advance.NONE;
            if (index >= 0) {
                shuffleHistory.add(index);
                if (shuffleHistory.size() > 200) shuffleHistory.remove(0);
            }
            int next;
            do { next = random.nextInt(sourceTracks.size()); } while (next == index);
            index = next;
        } else if (index + 1 < sourceTracks.size()) {
            index++;
        } else if ("all".equals(repeatMode)) {
            index = 0;
        } else {
            return Advance.NONE;
        }
        current = sourceTracks.get(index);
        currentFromQueue = false;
        return Advance.PLAY;
    }

    Advance previous(long positionMs) {
        if (current == null) return Advance.NONE;
        if (currentFromQueue) return Advance.RESTART;
        if (shuffleOn) {
            if (shuffleHistory.isEmpty()) return Advance.RESTART;
            index = shuffleHistory.remove(shuffleHistory.size() - 1);
        } else if (positionMs > 3000) {
            return Advance.RESTART;
        } else if (index > 0) {
            index--;
        } else if ("all".equals(repeatMode) && !sourceTracks.isEmpty()) {
            index = sourceTracks.size() - 1;
        } else {
            return Advance.RESTART;
        }
        current = sourceTracks.get(index);
        return Advance.PLAY;
    }

    boolean hasNext() {
        return !queue.isEmpty() || (!sourceTracks.isEmpty()
            && (index + 1 < sourceTracks.size() || "all".equals(repeatMode)
                || (shuffleOn && sourceTracks.size() > 1)));
    }

    void setOptions(String repeat, Boolean shuffle, String nextQuality) {
        if (repeat != null && !repeat.equals("off") && !repeat.equals("one") && !repeat.equals("all")) {
            throw new IllegalArgumentException("Invalid repeat mode");
        }
        if (nextQuality != null && !nextQuality.equals("low") && !nextQuality.equals("high")) {
            throw new IllegalArgumentException("Invalid playback quality");
        }
        if (repeat != null) {
            if (!repeat.equals("off") && !repeat.equals("one") && !repeat.equals("all")) {
                throw new IllegalArgumentException("Invalid repeat mode");
            }
            repeatMode = repeat;
        }
        if (shuffle != null && shuffle != shuffleOn) {
            shuffleHistory.clear();
            shuffleOn = shuffle;
        }
        if (nextQuality != null) {
            if (!nextQuality.equals("low") && !nextQuality.equals("high")) {
                throw new IllegalArgumentException("Invalid playback quality");
            }
            quality = nextQuality;
        }
    }

    void setSleep(String mode, long endTimeMs) {
        if (mode != null && !mode.equals("duration") && !mode.equals("track") && !mode.equals("queue")) {
            throw new IllegalArgumentException("Invalid sleep timer mode");
        }
        sleepMode = mode;
        sleepEndTimeMs = "duration".equals(mode) ? endTimeMs : 0L;
        sleepQueueDrained = "queue".equals(mode) && queue.isEmpty();
    }

    void clearSleep() {
        sleepMode = null;
        sleepEndTimeMs = 0L;
        sleepQueueDrained = false;
    }

    static String lowUrlAtPosition(String url, long positionMs) {
        String base = newPlaySessionUrl(url).replaceAll("([?&])StartTimeTicks=[^&]*&?", "$1")
            .replaceAll("[?&]$", "");
        return base + (base.contains("?") ? "&" : "?") + "StartTimeTicks=" + Math.max(0L, positionMs) * 10000L;
    }

    static String newPlaySessionUrl(String url) {
        String base = url.replaceAll("([?&])PlaySessionId=[^&]*&?", "$1").replaceAll("[?&]$", "");
        return base + (base.contains("?") ? "&" : "?") + "PlaySessionId=" + UUID.randomUUID().toString();
    }
}
