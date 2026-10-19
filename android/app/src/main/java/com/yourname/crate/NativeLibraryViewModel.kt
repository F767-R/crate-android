package com.yourname.crate

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

internal data class NativeLibraryState(val albums: List<NativeAlbum> = emptyList(), val selected: NativeAlbum? = null,
    val tracks: List<NativeTrack> = emptyList(), val loading: Boolean = false, val error: String? = null, val query: String = "")

internal class NativeLibraryViewModel : ViewModel() {
    val repository = NativeLibraryRepository()
    private val mutable = MutableStateFlow(NativeLibraryState())
    val state = mutable.asStateFlow()
    private var request: Job? = null
    init { refresh() }
    fun search(query: String) { mutable.value = mutable.value.copy(query = query) }
    fun open(album: NativeAlbum) {
        request?.cancel()
        mutable.value = mutable.value.copy(selected = album, tracks = emptyList(), error = null)
        refresh()
    }
    fun back() {
        request?.cancel()
        mutable.value = mutable.value.copy(selected = null, tracks = emptyList(), loading = false, error = null)
    }
    fun refresh() {
        request?.cancel()
        val album = mutable.value.selected
        mutable.value = mutable.value.copy(loading = true, error = null)
        request = viewModelScope.launch {
            try {
                if (album == null) {
                    val albums = repository.albums()
                    mutable.value = mutable.value.copy(albums = albums, loading = false)
                } else {
                    val tracks = repository.tracks(album)
                    mutable.value = mutable.value.copy(tracks = tracks, loading = false)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                val message = if (error is IllegalStateException) error.message else "Could not connect to your library. Check your connection and retry."
                mutable.value = mutable.value.copy(loading = false, error = message)
            }
        }
    }
}
