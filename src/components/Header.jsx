import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { config } from '../config.js';
import {
  queueVisible,
  searchQuery,
  settingsVisible,
} from '../stores/state.js';
import { refreshLibrary, syncLibraryIndex } from '../utils/libraryData.js';
import { navigateToView, showAlbumGrid, getNavigationRevision } from '../utils/navigation.js';
import { fetchWithTimeout, safeRequestError } from '../utils/request.js';

export default function Header({ libraryReady = true }) {
  const [connStatus, setConnStatus] = useState('connecting');
  const [showConnPopup, setShowConnPopup] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const refreshAbortRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    let checking = false;
    const checkConnection = async () => {
      if (checking) return;
      checking = true;
      try {
        const ok = await fetchWithTimeout(`${config.SERVER}/System/Info/Public`,
          { signal: controller.signal }, { timeoutMs: 10000, consume: response => response.ok });
        if (!controller.signal.aborted) setConnStatus(ok ? 'connected' : 'disconnected');
      } catch {
        if (!controller.signal.aborted) setConnStatus('disconnected');
      } finally {
        checking = false;
      }
    };
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => {
      clearInterval(interval);
      controller.abort();
      refreshAbortRef.current?.abort();
    };
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
    const revision = getNavigationRevision();
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      if (revision !== getNavigationRevision()) return;
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
    if (refreshAbortRef.current) return;
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshLibrary({ signal: controller.signal });
      await syncLibraryIndex({ signal: controller.signal });
    } catch (err) {
      if (!controller.signal.aborted && err?.code !== 'aborted') setRefreshError(err);
    } finally {
      refreshAbortRef.current = null;
      if (!controller.signal.aborted) setRefreshing(false);
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
        <button id="refreshBtn" class={refreshing ? 'spinning' : ''} disabled={refreshing || !libraryReady}
          onClick={refreshView} title="Refresh this view" aria-label="Refresh">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L14 11h7V4l-3.35 2.35z"/></svg>
        </button>
        <button id="queueBtn" onClick={toggleQueue} title="Queue" aria-label="Queue">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
        </button>
        <button id="settingsBtn" onClick={() => { settingsVisible.value = true; }}
          title="Settings" aria-label="Settings">⚙</button>
        <div class="search-container">
          <input
            disabled={!libraryReady}
            ref={searchInputRef}
            type="text"
            id="searchInput"
            placeholder="Search albums, artists, tracks…"
            aria-label="Search albums, artists and tracks"
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
            aria-hidden={!searchQuery.value}
            tabIndex={searchQuery.value ? 0 : -1}
            title="Clear search"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      </div>
      {refreshError && (
        <div class="header-feedback" role="alert">
          <span>{safeRequestError(refreshError)}</span>
          <button class="action-button" onClick={refreshView}>Retry refresh</button>
        </div>
      )}
    </header>
  );
}
