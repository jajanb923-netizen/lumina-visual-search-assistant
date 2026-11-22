/**
 * Browser speech synthesis wrapper.
 * Uses the free, built-in Web Speech API — no key, no network, no cost.
 * Gracefully reports when the browser has no voices (e.g. headless Chrome).
 */

export interface SpeechState {
  supported: boolean;
  voices: SpeechSynthesisVoice[];
  speaking: boolean;
  paused: boolean;
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!speechSupported()) return resolve([]);
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    if (voices.length > 0) return resolve(voices);
    const onChange = () => {
      synth.removeEventListener("voiceschanged", onChange);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", onChange);
    // Fallback: some browsers never fire the event.
    setTimeout(() => {
      synth.removeEventListener("voiceschanged", onChange);
      resolve(synth.getVoices());
    }, 1500);
  });
}

export interface SpeakOptions {
  text: string;
  voice?: SpeechSynthesisVoice | null;
  rate?: number;
  pitch?: number;
  /** Called with the character index of the word being spoken (for highlighting). */
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/** Speak text aloud. Returns the utterance so callers can cancel it. */
export function speak(opts: SpeakOptions): SpeechSynthesisUtterance | null {
  if (!speechSupported()) return null;
  const synth = window.speechSynthesis;
  synth.cancel(); // stop anything currently speaking
  const utterance = new SpeechSynthesisUtterance(opts.text);
  if (opts.voice) utterance.voice = opts.voice;
  utterance.rate = opts.rate ?? 1;
  utterance.pitch = opts.pitch ?? 1;
  utterance.onboundary = (event) => {
    if (event.name === "word" && typeof event.charIndex === "number") {
      opts.onBoundary?.(event.charIndex);
    }
  };
  utterance.onend = () => opts.onEnd?.();
  utterance.onerror = (event) => opts.onError?.(event.error || "speech error");
  synth.speak(utterance);
  return utterance;
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}

export function pauseSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.pause();
}

export function resumeSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.resume();
}
