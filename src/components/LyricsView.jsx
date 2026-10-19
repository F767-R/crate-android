import { h } from 'preact';
import LyricsContent from './LyricsContent.jsx';

export default function LyricsView() {
  return (
    <div class="lyrics-view">
      <LyricsContent active layout="view" />
    </div>
  );
}
