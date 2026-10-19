/** Shared application contracts. These declarations contain no runtime values. */
export type ItemId = string;
export type PlaybackQuality = 'high' | 'low';
export type RepeatMode = 'off' | 'one' | 'all';
export type SleepMode = 'duration' | 'track' | 'queue' | null;

export interface NamedArtist {
  Id?: ItemId | null;
  Name?: string | null;
}

export interface LibraryItem {
  Id: ItemId;
  Name?: string | null;
  Artists?: Array<string | NamedArtist> | null;
  ArtistNames?: string[] | null;
  ArtistItems?: NamedArtist[] | null;
  AlbumArtist?: string | null;
  ImageTags?: Record<string, string> | null;
}

export interface Track extends LibraryItem {
  AlbumId?: ItemId | null;
  Album?: string | null;
  RunTimeTicks?: number | null;
  IndexNumber?: number | null;
  ParentIndexNumber?: number | null;
  ImageUrl?: string | null;
  MediaSources?: Array<{ Id?: string; Container?: string; [field: string]: unknown }> | null;
}

export interface Album extends LibraryItem {
  ProductionYear?: number | null;
  PremiereDate?: string | null;
  Overview?: string | null;
  Genres?: string[] | null;
  ChildCount?: number | null;
}

/** The album cache stores this object, never a bare Track[]. */
export interface AlbumDetails extends Album {
  Items: Track[];
}

export interface LibraryItemsResponse<T extends LibraryItem> {
  Items: T[];
  TotalRecordCount?: number;
  StartIndex?: number;
}

export interface QueueEntry {
  track: Track;
  albumId?: ItemId | null;
}

export interface ResumeAfterQueue {
  tracks: Track[];
  index: number;
}

export interface TranslatedLabel {
  title: string;
  artist: string;
}

export type TranslationCache = Record<ItemId, TranslatedLabel>;

export interface NativeCacheStats {
  audioBytes: number;
  artworkBytes: number;
  audioLimitBytes: number;
  artworkLimitBytes: number;
}

export interface NativePlaybackTrackMetadata {
  id: ItemId;
  title: string;
  artist: string;
  albumId: ItemId | null;
  durationMs: number;
  originalTitle?: string;
  originalArtist?: string;
  albumTitle?: string;
  originalAlbumTitle?: string;
  trackNumber?: number;
  discNumber?: number;
}

/** URL-free native metadata that may safely cross snapshot/event boundaries. */
export interface NativePlaybackTrackSnapshot extends NativePlaybackTrackMetadata {
  lowUrl?: never;
  highUrl?: never;
  artUrl?: never;
}

/** Private command input. Never persist or expose these URLs in snapshots. */
export interface NativePlaybackTrackInput extends NativePlaybackTrackMetadata {
  lowUrl: string;
  highUrl: string;
  artUrl: string | null;
}

export type NativePlaybackError = string | { message: string; code?: string } | null;

export interface NativePlaybackStatus {
  supported: true;
  protocolVersion: 2;
  sessionId: string;
  revision: number;
  eventRequestId: number;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  desiredPlaying: boolean;
  buffering: boolean;
  isLocal: boolean;
  quality: PlaybackQuality;
  cached?: boolean;
}

export interface NativePlaybackSnapshot extends NativePlaybackStatus {
  initialized?: boolean;
  restoredState?: boolean;
  currentTrack: NativePlaybackTrackSnapshot | null;
  error: NativePlaybackError;
  sourceTracks: NativePlaybackTrackSnapshot[];
  index: number;
  queue: NativePlaybackTrackSnapshot[];
  repeatMode: RepeatMode;
  shuffleOn: boolean;
  sleep: { mode: SleepMode; endTimeMs: number | null; queueDrained: boolean };
}

export interface NativePlaybackPositionEvent extends NativePlaybackStatus {
  currentTrackId: ItemId | null;
  error?: NativePlaybackError;
}

export interface NativePlaybackEvents {
  playbackSnapshot: NativePlaybackSnapshot;
  playbackPosition: NativePlaybackPositionEvent;
  cacheReady: { itemId: ItemId };
}

export interface NativeListenerHandle {
  remove(): Promise<void>;
}

export type NativeCommandResult = NativePlaybackSnapshot;

export type NativeQueueMutation =
  | { action: 'add'; track: NativePlaybackTrackInput; position?: 'next' | 'last'; expectedRevision?: number }
  | { action: 'remove'; index: number; expectedRevision?: number }
  | { action: 'move'; index: number; toIndex: number; expectedRevision?: number }
  | { action: 'clear'; expectedRevision?: number };

/** Protocol v2. Older installed APKs must be detected before using this API. */
export interface NativePlaybackPlugin {
  getPlaybackSnapshot(): Promise<NativePlaybackSnapshot>;
  configurePlayback(options: { scope: string }): Promise<NativeCommandResult>;
  playSelection(options: { tracks: NativePlaybackTrackInput[]; index: number; queueMode: 'preserve' | 'replace-tail' }): Promise<NativeCommandResult>;
  replaceQueue(options: { queue: NativePlaybackTrackInput[]; expectedRevision?: number }): Promise<NativeCommandResult>;
  mutateQueue(options: NativeQueueMutation): Promise<NativeCommandResult>;
  setPlaybackOptions(options: { repeatMode?: RepeatMode; shuffleOn?: boolean; quality?: PlaybackQuality }): Promise<NativeCommandResult>;
  setSleepTimer(options: { mode: SleepMode; endTimeMs?: number | null }): Promise<NativeCommandResult>;
  nextTrack(): Promise<NativeCommandResult>;
  previousTrack(): Promise<NativeCommandResult>;
  playQueueItem(options: { index: number }): Promise<NativeCommandResult>;
  seekAbsolute(options: { positionMs: number; playWhenReady?: boolean }): Promise<NativeCommandResult>;
  retryPlayback(): Promise<NativeCommandResult>;
  pause(): Promise<NativeCommandResult>;
  resume(): Promise<NativeCommandResult>;
  stop(): Promise<NativeCommandResult>;
  getCacheStats(): Promise<NativeCacheStats>;
  setCacheLimit(options: { audioLimitBytes: number }): Promise<NativeCacheStats>;
  clearCache(): Promise<NativeCacheStats>;
  addListener<K extends keyof NativePlaybackEvents>(eventName: K, listener: (event: NativePlaybackEvents[K]) => void): Promise<NativeListenerHandle>;
}
