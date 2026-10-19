import assert from 'node:assert/strict';
import { libraryItem, librarySnapshot, albumFromSnapshot, libraryStorageKey } from '../src/utils/libraryStorage.js';

const input = { Id:'track', Name:'Title', AlbumId:'album', IndexNumber:2, ParentIndexNumber:1,
  ArtistItems:[{Id:'artist',Name:'Artist',url:'private'}], ImageUrl:'private', MediaSources:[{Path:'private'}],
  lowUrl:'private', api_key:'private', ImageTags:{Primary:'tag',Private:'private'} };
const item = libraryItem(input);
assert(!JSON.stringify(item).includes('private'), 'only display metadata is persisted');
assert.equal(item.IndexNumber,2);
assert.equal(librarySnapshot({version:99}),null);
const snapshot = librarySnapshot({version:1,userId:'user',libraryId:'music',savedAt:1,
  albums:[{Id:'album',Name:'Album'}], tracksComplete:true,
  tracks:[{...input,Id:'disc2',ParentIndexNumber:2,IndexNumber:1},{...input,Id:'second'}, {...input,Id:'first',IndexNumber:1}]});
assert.deepEqual(albumFromSnapshot(snapshot,'album').Items.map(t=>t.Id),['first','second','disc2']);
assert.equal(albumFromSnapshot({...snapshot,tracksComplete:false},'album'),null);
assert.equal(albumFromSnapshot(snapshot,'missing'),null);
assert.equal(await libraryStorageKey('https://server/','key'),await libraryStorageKey('https://server','key'));
assert.notEqual(await libraryStorageKey('https://server','key'),await libraryStorageKey('https://server','changed'));

// Minimal asynchronous IndexedDB boundary; application fetches and fallback are real.
const records = new Map();
globalThis.indexedDB = { open() {
  const request = {};
  queueMicrotask(() => {
    request.result = { transaction() {
      const tx = {};
      const action = (write,key,value) => {
        const result = {};
        setTimeout(() => {
          if(write) records.set(key,structuredClone(value));
          result.result = write ? key : structuredClone(records.get(key));
          tx.oncomplete?.();
        },0);
        return result;
      };
      tx.objectStore = () => ({get:key=>action(false,key),put:(value,key)=>action(true,key,value)});
      return tx;
    }};
    request.onsuccess();
  });
  return request;
}};
globalThis.localStorage = {getItem:()=>null,setItem(){}};
const state=await import('../src/stores/state.js');
const offline=await import('../src/stores/offline.js');
const lib=await import('../src/utils/libraryData.js');
const {config}=await import('../src/config.js');
assert.equal(await lib.restoreSavedLibrary(),false);
state.userId.value='user'; state.musicLibraryId.value='music';
let online=true, denied=false, requests=0;
globalThis.fetch=async input=>{
  requests++;
  if(!online) throw new TypeError('offline');
  if(denied) return {ok:false,status:401};
  const url=new URL(input);
  const Items=url.searchParams.get('IncludeItemTypes')==='MusicAlbum'?snapshot.albums:snapshot.tracks;
  return {ok:true,json:async()=>({Items})};
};
await lib.refreshLibrary();
await lib.syncLibraryIndex();
await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(records.size,1);
assert.equal([...records.values()][0].tracks.length,3);
assert(!JSON.stringify([...records.values()]).includes('private'));
lib.invalidateLibrary(); online=false;
assert.equal(await lib.restoreSavedLibrary(),true);
const before=requests;
assert.equal((await lib.ensureAlbumsLoaded()).length,1);
assert.equal((await lib.ensureAllTracksLoaded()).length,3);
assert.deepEqual((await lib.ensureAlbumDetailLoaded('album')).Items.map(t=>t.Id),['first','second','disc2']);
assert.equal(requests,before,'saved albums, search index and unvisited album tracks need no network');
offline.downloadedOnly.value = true;
const retryOffline = lib.refreshLibrary();
assert.equal(offline.libraryUsingSaved.value, true, 'reconnect keeps offline controls visible while pending');
assert.equal(offline.downloadedOnly.value, true, 'pending reconnect preserves the filter');
await retryOffline;
assert.equal(offline.downloadedOnly.value, true, 'failed reconnect preserves the filter');
assert.equal(state.allAlbums.value.length,1,'failed refresh preserves the saved library');
assert.equal(offline.libraryUsingSaved.value,true);
await lib.ensureAllTracksLoaded();
online=true; denied=true;
await assert.rejects(lib.refreshLibrary(),error=>error.status===401);
denied=false;
await lib.refreshLibrary(); await lib.syncLibraryIndex();
assert.equal(offline.libraryUsingSaved.value,false,'reconnect replaces saved data with the live index');
assert.equal(offline.downloadedOnly.value, false, 'successful reconnect clears the filter');
offline.libraryUsingSaved.value = true;
assert.equal(offline.downloadedOnly.value, false, 'new offline sessions start unfiltered');
offline.libraryUsingSaved.value = false;
state.userId.value='another-user'; online=false;
await assert.rejects(lib.ensureAlbumsLoaded(),error=>error.code==='network','one user cannot read another user snapshot');
const keyBefore=config.API_KEY;
config.API_KEY='different-credential';
assert.equal(await lib.restoreSavedLibrary(),false,'a rotated credential cannot resurrect a previous snapshot');
state.userId.value='user'; state.musicLibraryId.value='music';
await assert.rejects(lib.ensureAlbumsLoaded(),error=>error.code==='network','a missing snapshot after credential rotation must not reuse the old in-memory snapshot');
config.API_KEY=keyBefore;
console.log('Offline library passed: persistence, metadata allowlist, cold restore, search/detail index, failed refresh, reconnect and scope isolation.');
