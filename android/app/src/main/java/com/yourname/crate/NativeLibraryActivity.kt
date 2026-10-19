package com.yourname.crate

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.memory.MemoryCache
import coil.request.ImageRequest
import kotlinx.coroutines.*
import org.json.JSONObject
import kotlin.coroutines.resume

private val Gold = Color(0xFFC9A24B)
private val Muted = Color(0xFF8A939C)
private val Panel = Color(0xFF1A2025)
private val Background = Color(0xFF12161A)
private val TextColor = Color(0xFFEAE6DD)

internal data class NativePlayerState(val id: String? = null, val title: String = "Nothing playing", val artist: String = "",
    val position: Long = 0, val duration: Long = 0, val playing: Boolean = false, val buffering: Boolean = false, val quality: String = "low", val error: String? = null) {
    companion object {
        fun from(value: JSONObject): NativePlayerState {
            val track = value.optJSONObject("currentTrack")
            return NativePlayerState(track?.optString("id"), track?.optString("title") ?: "Nothing playing", track?.optString("artist") ?: "",
                value.optLong("positionMs"), value.optLong("durationMs"), value.optBoolean("desiredPlaying"), value.optBoolean("buffering"),
                value.optString("quality", "low"), value.optJSONObject("error")?.optString("message"))
        }
    }
}

class NativeLibraryActivity : ComponentActivity() {
    private val model: NativeLibraryViewModel by viewModels()
    private var player by mutableStateOf(NativePlayerState())
    private var ready by mutableStateOf(false)
    private var commandError by mutableStateOf<String?>(null)
    private var coordinator: NativePlaybackCoordinator? = null
    private var selection: Job? = null
    private lateinit var images: ImageLoader

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        images = ImageLoader.Builder(this).memoryCache { MemoryCache.Builder(this).maxSizeBytes(32 * 1024 * 1024).build() }
            .diskCache(null).build()
        window.statusBarColor = android.graphics.Color.rgb(18, 22, 26)
        window.navigationBarColor = android.graphics.Color.rgb(18, 22, 26)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                try {
                    while (isActive) {
                        val service = suspendCancellableCoroutine<PlaybackService?> { continuation ->
                            PlaybackService.whenReady(this@NativeLibraryActivity, { service ->
                                if (continuation.isActive) continuation.resume(service)
                            }, { if (continuation.isActive) continuation.resume(null) })
                        }
                        if (service == null) { commandError = "Playback service is unavailable. Return to the current interface and retry."; delay(2000); continue }
                        coordinator = service.coordinator()
                        coordinator?.configure(model.repository.scope)
                        ready = true
                        while (isActive && PlaybackService.getInstance() === service) {
                            player = NativePlayerState.from(service.coordinator().screenSnapshot())
                            delay(500)
                        }
                        ready = false
                    }
                } finally { ready = false; coordinator = null }
            }
        }
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Gold, background = Background, surface = Panel, onSurface = TextColor, onBackground = TextColor)) {
                val state by model.state.collectAsState()
                val gridScroll = rememberLazyGridState()
                BackHandler { if (state.selected != null) model.back() else finish() }
                Column(Modifier.fillMaxSize().background(Background)) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("C.R.A.T.E.", fontFamily = FontFamily.Serif, fontSize = 24.sp, color = TextColor, modifier = Modifier.weight(1f))
                        TextButton(onClick = { finish() }) { Text("Current interface") }
                    }
                    Text("Native preview · online library", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp))
                    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (state.selected != null) TextButton(onClick = model::back) { Text("← Albums") }
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = model::refresh, enabled = !state.loading) { Text("Refresh") }
                    }
                    if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Gold)
                    state.error?.let { message ->
                        Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
                        TextButton(onClick = model::refresh) { Text("Retry library") }
                    }
                    if (state.selected == null) {
                        OutlinedTextField(value = state.query, onValueChange = model::search, label = { Text("Search albums or artists") }, singleLine = true,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
                        val albums = state.albums.filter { state.query.isBlank() || "${it.title} ${it.artist}".contains(state.query.trim(), true) }
                        if (!state.loading && state.error == null && albums.isEmpty()) Text("No matching albums", color = Muted, modifier = Modifier.padding(16.dp))
                        LazyVerticalGrid(columns = GridCells.Adaptive(140.dp), state = gridScroll, modifier = Modifier.weight(1f), contentPadding = PaddingValues(16.dp),
                            horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                            items(albums, key = { it.id }) { album ->
                                Column(Modifier.clickable { model.open(album) }.semantics { contentDescription = "Open album ${album.title}" }) {
                                    AlbumArtwork(album, false)
                                    Text(album.title, color = TextColor, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, modifier = Modifier.padding(top = 7.dp))
                                    Text(album.artist, color = Muted, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 12.sp)
                                }
                            }
                        }
                    } else {
                        AlbumTracks(state, Modifier.weight(1f))
                    }
                    commandError?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp)) }
                    PlayerControls(player, ready, onAction = ::action, onSeek = { target -> command { it.seekAbsolute(target, null) } })
                }
            }
        }
    }
    private fun command(block: (NativePlaybackCoordinator) -> Unit) {
        selection?.cancel()
        val owner = coordinator ?: return
        try { block(owner); player = NativePlayerState.from(owner.screenSnapshot()); commandError = null }
        catch (_: Exception) { commandError = "Playback could not be changed. Please retry." }
    }
    private fun action(action: String) = command { owner ->
        when (action) {
            "play" -> owner.resume()
            "pause" -> owner.pause()
            "previous" -> owner.previousTrack()
            "next" -> owner.nextTrack()
            "retry" -> owner.retry()
            "quality" -> owner.setOptions(JSONObject().put("quality", if (player.quality == "low") "high" else "low"))
        }
    }
    private fun play(tracks: List<NativeTrack>, index: Int) {
        selection?.cancel()
        selection = lifecycleScope.launch {
            try {
                val payload = withContext(Dispatchers.Default) { model.repository.selection(tracks, index) }
                val owner = coordinator ?: return@launch
                owner.playSelection(payload)
                player = NativePlayerState.from(owner.screenSnapshot())
                commandError = null
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { commandError = "Could not start this track. Please retry." }
        }
    }
    override fun onStop() { selection?.cancel(); super.onStop() }
    override fun onDestroy() { images.shutdown(); super.onDestroy() }

    @Composable private fun AlbumArtwork(album: NativeAlbum, detail: Boolean) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(6.dp)).background(Panel), contentAlignment = Alignment.Center) {
            Text("♪", color = Muted, fontSize = 32.sp)
            if (album.imageTag != null) AsyncImage(model = ImageRequest.Builder(LocalContext.current).data(model.repository.artwork(album, if (detail) 800 else 400))
                .addHeader("Authorization", "MediaBrowser Token=\"${model.repository.imageToken()}\"").build(), imageLoader = images,
                contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
    @Composable private fun AlbumTracks(state: NativeLibraryState, modifier: Modifier) {
        val album = state.selected ?: return
        LazyColumn(modifier.testTag("album-tracks"), contentPadding = PaddingValues(16.dp)) {
            item(key = "header") {
                AlbumArtwork(album, true)
                Text(album.title, fontFamily = FontFamily.Serif, fontSize = 24.sp, color = TextColor, modifier = Modifier.padding(top = 16.dp))
                album.year?.let { Text("$it", color = Gold, fontSize = 14.sp, modifier = Modifier.padding(vertical = 6.dp)) }
                Text(album.artist, color = Muted, fontSize = 13.sp, modifier = Modifier.padding(bottom = 20.dp))
            }
            val multiDisc = state.tracks.map { it.disc }.distinct().size > 1
            state.tracks.forEachIndexed { index, track ->
                if (multiDisc && (index == 0 || state.tracks[index - 1].disc != track.disc)) item(key = "disc:${track.disc}") {
                    Text("DISC ${track.disc}", color = Gold, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 6.dp).border(1.dp, Gold.copy(alpha = .55f), RoundedCornerShape(6.dp)).background(Color(0xFF29261E)).padding(12.dp))
                }
                item(key = track.id) {
                    val selected = player.id == track.id
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(if (selected) Panel else Color.Transparent)
                        .clickable(enabled = ready) { play(state.tracks, index) }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (selected) "♫" else "${track.number}", color = if (selected) Gold else Muted, fontSize = 12.sp, modifier = Modifier.width(32.dp))
                        Column(Modifier.weight(1f)) {
                            Text(track.title, color = TextColor, fontSize = 14.sp)
                            Text(track.artist, color = Muted, fontSize = 12.sp)
                        }
                        Text(duration(track.durationMs), color = Muted, fontSize = 11.sp, modifier = Modifier.padding(start = 8.dp))
                    }
                }
            }
            if (!state.loading && state.error == null && state.tracks.isEmpty()) item { Text("No tracks in this album", color = Muted) }
        }
    }
}

private fun duration(ms: Long): String { val seconds = ms.coerceAtLeast(0) / 1000; return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}" }

@Composable private fun PlayerControls(player: NativePlayerState, ready: Boolean, onAction: (String) -> Unit, onSeek: (Long) -> Unit) {
    var dragged by remember(player.id) { mutableStateOf<Float?>(null) }
    Surface(color = Panel) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
            Text(player.title, color = TextColor, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
            Text(player.artist, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp)
            player.error?.let { Text("Playback failed. Check your connection and retry.", color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            if (player.buffering) Text("Buffering…", color = Muted, fontSize = 11.sp)
            Slider(value = dragged ?: player.position.toFloat().coerceIn(0f, player.duration.coerceAtLeast(1).toFloat()),
                valueRange = 0f..player.duration.coerceAtLeast(1).toFloat(), enabled = ready && player.id != null && player.duration > 0,
                onValueChange = { dragged = it }, onValueChangeFinished = { dragged?.let { onSeek(it.toLong()) }; dragged = null },
                modifier = Modifier.height(28.dp).semantics { contentDescription = "Playback position" })
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(duration(player.position), fontSize = 11.sp, color = Muted)
                TextButton(onClick = { onAction("previous") }, enabled = ready && player.id != null) { Text("Previous") }
                TextButton(onClick = { onAction(if (player.playing) "pause" else "play") }, enabled = ready && player.id != null) { Text(if (player.playing) "Pause" else "Play") }
                TextButton(onClick = { onAction("next") }, enabled = ready && player.id != null) { Text("Next") }
                TextButton(onClick = { onAction("quality") }, enabled = ready) { Text(if (player.quality == "high") "HD" else "LQ") }
            }
            if (player.error != null) TextButton(onClick = { onAction("retry") }, enabled = ready) { Text("Retry playback") }
        }
    }
}
