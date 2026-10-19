import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { getUserId, getTrackStreamUrl, getAlbumArtUrl, getLyrics } = await import('../src/utils/api.js');
const { config } = await import('../src/config.js');
const checkUrl = value => {
  const url = new URL(value);
  assert.equal(url.searchParams.get('ApiKey'), config.API_KEY);
  assert.equal(url.searchParams.has('api_key'), false, 'Jellyfin 12 disables legacy query authentication');
};
globalThis.fetch = async (url, options) => {
  checkUrl(url);
  assert.match(options.headers.Authorization, /^MediaBrowser /);
  assert.equal(options.headers['X-Emby-Authorization'], undefined);
  return new Response(JSON.stringify([{ Id: 'user' }]), { status: 200 });
};
assert.equal(await getUserId(), 'user');
checkUrl(getTrackStreamUrl('track', 'low'));
checkUrl(getTrackStreamUrl('track', 'high'));
checkUrl(getAlbumArtUrl('album'));
console.log('Jellyfin modern authentication: library, stream, and artwork URLs passed.');

globalThis.fetch = async (url) => {
  checkUrl(url);
  assert.equal(new URL(url).pathname, '/Audio/track/Lyrics');
  return new Response(JSON.stringify({ Lyrics: [{ Start: 10000000, Text: 'Test line' }] }), { status: 200 });
};
assert.ok(await getLyrics('user', 'track', { source: 'jellyfin' }));
