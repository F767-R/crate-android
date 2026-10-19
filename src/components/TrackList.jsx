import DownloadBadge from './DownloadBadge.jsx';
import { filterDownloadedTracks } from '../utils/downloads.js';
import { h } from 'preact';
import { currentTracks, playbackCurrentTrack } from '../stores/state.js';
import { formatDuration } from '../utils/api.js';
import { playTrack } from '../utils/playbackControls.js';

export default function TrackList() {
  const tracks = filterDownloadedTracks(currentTracks.value);
  const playingTrack = playbackCurrentTrack.value;

  const handlePlay = (i) => {
    const track = tracks[i];
    if (!track) return;
    playTrack(track);
  };

  if (!tracks || tracks.length === 0) {
    return <div class="status-msg">No tracks in current list</div>;
  }

  return (
    <div class="track-list">
      {tracks.map((track, i) => (
        <div
          class={`track-row ${track.Id === playingTrack?.Id ? 'playing' : ''}`}
          key={track.Id}
          onClick={() => handlePlay(i)}
        >
          <div class="track-number">{track.IndexNumber || i + 1}</div>
          <div class="track-info">
            <div class="track-title">{track.Name}<DownloadBadge track={track} /></div>
            <div class="track-duration">{formatDuration(track.RunTimeTicks)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
