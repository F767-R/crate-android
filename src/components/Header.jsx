import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { config } from '../config.js';
import {
  queueVisible,
  userId,
  musicLibraryId,
  allAlbums,
  allTracksFetched,
  translationComplete,
  searchQuery,
} from '../stores/state.js';
import { getAlbums } from '../utils/api.js';
import { navigateToView, showAlbumGrid } from '../utils/navigation.js';

export default function Header() {
  const [connStatus, setConnStatus] = useState('connecting');
  const [showConnPopup, setShowConnPopup] = useState(false);
  const searchDebounceRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch(`${config.SERVER}/System/Info/Public`);
        if (response.ok) setConnStatus('connected');
        else setConnStatus('disconnected');
      } catch {
        setConnStatus('disconnected');
      }
    };
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const blurSearchOutside = event => {
      if (document.activeElement === searchInputRef.current
        && event.target !== searchInputRef.current
        && !event.target.closest?.('.search-container')) {
        searchInputRef.current.blur();
      }
    };
    document.addEventListener('pointerdown', blurSearchOutside, true);
    return () => {
      document.removeEventListener('pointerdown', blurSearchOutside, true);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const handleSearch = (e) => {
    const rawQuery = e.currentTarget.value;
    const query = rawQuery.trim();
    searchQuery.value = rawQuery;
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (!query) {
      showAlbumGrid({ restoreScroll: true });
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      navigateToView({ type: 'search', query });
    }, 350);
  };

  const clearSearch = () => {
    searchQuery.value = '';
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    showAlbumGrid({ restoreScroll: true });
    searchInputRef.current?.focus();
  };

  const toggleQueue = () => {
    queueVisible.value = !queueVisible.value;
  };

  const refreshView = async () => {
    try {
      const albums = await getAlbums(userId.value, musicLibraryId.value);
      allAlbums.value = albums.Items || [];
      allTracksFetched.value = false;
      translationComplete.value = false;
    } catch (err) {
      console.error('Refresh error:', err);
    }
  };

  return (
    <header>
      <div class="brand">
        <h1>C.R.A.T.E.</h1>
        <span class="tagline">Custom Remote Audio & Translation Engine</span>
      </div>
      <div class="header-right">
        <div class="conn-status">
          <button
            class="conn-dot-btn"
            aria-label="Connection status"
            title="Connection status"
            onClick={() => setShowConnPopup(value => !value)}
            onBlur={() => setShowConnPopup(false)}
          >
            <span class={`conn-dot ${connStatus === 'connected' ? 'ok' : connStatus === 'disconnected' ? 'err' : ''}`}></span>
          </button>
          <div class={`conn-popup ${showConnPopup ? 'show' : ''}`}>{connStatus === 'connected' ? 'Connected' : connStatus === 'connecting' ? 'Connecting…' : 'Disconnected'}</div>
        </div>
        <button id="refreshBtn" onClick={refreshView} title="Refresh this view" aria-label="Refresh">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L14 11h7V4l-3.35 2.35z"/></svg>
        </button>
        <button id="queueBtn" onClick={toggleQueue} title="Queue" aria-label="Queue">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
        </button>
        <div class="search-container">
          <input
            ref={searchInputRef}
            type="text"
            id="searchInput"
            placeholder="Search albums, artists, tracks…"
            autocomplete="off"
            value={searchQuery.value}
            onInput={handleSearch}
          />
          <button
            type="button"
            class={`clear-search-btn ${!searchQuery.value ? 'hidden' : ''}`}
            onPointerDown={event => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={clearSearch}
            aria-label="Clear search"
            title="Clear search"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      </div>
    </header>
  );
}
