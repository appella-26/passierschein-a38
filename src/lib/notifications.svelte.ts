export const notification = $state({ enabled: false });
let audio: AudioContext | undefined;

/** Called inside a user gesture, before awaiting network requests. */
export async function enableSound(): Promise<boolean> {
  try {
    if (typeof AudioContext === 'undefined') return false;
    audio ??= new AudioContext();
    await audio.resume();
    notification.enabled = audio.state === 'running';
    return notification.enabled;
  } catch { return false; }
}

export function notifyHuman() {
  if (audio?.state === 'running') {
    const start = audio.currentTime;
    for (const [offset, frequency] of [[0, 660], [0.28, 880]]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(0.12, start + offset + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, start + offset + 0.24);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.25);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  }
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* Not available on every browser. */ }
}
