import { h } from 'preact';
import LyricsContent from './LyricsContent.jsx';
import { hideLyricsView } from '../utils/navigation.js';

export default function LyricsView() {
  return (
    <div class="lyrics-view">
      <div class="crumb">
        <button onClick={hideLyricsView}>← Back</button>
      </div>
      <LyricsContent active layout="view" />
    </div>
  );
}
