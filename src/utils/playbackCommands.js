// One revision per transport intent. Internal steps share the same revision;
// after any await they must still own it before touching playback again.
let revision = 0;

export const beginPlaybackCommand = () => ++revision;
/** @param {number} command */
export const isPlaybackCommandCurrent = command => command === revision;
