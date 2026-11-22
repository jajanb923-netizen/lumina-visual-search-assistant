"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SAMPLE_PHOTOS } from "@/lib/samples";
import {
  loadVoices,
  speak,
  stopSpeaking,
  pauseSpeaking,
  resumeSpeaking,
  speechSupported,
} from "@/lib/speech";
import { loadHistory, saveHistoryEntry, clearHistory, type HistoryEntry } from "@/lib/history";
import type { Analysis } from "./api/analyze/route";

interface AttemptInfo {
  model: string;
  ok: boolean;
  status?: number;
  error?: string;
  latencyMs: number;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_SIDE_PX = 1024;

/** Downscale an image file to max 1024px on its longest side (keeps API payloads small). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(new Error("That image is over 8 MB — please pick a smaller one."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not a readable image."));
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE_PX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas is unavailable in this browser."));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load that sample photo.");
  const blob = await res.blob();
  return fileToDataUrl(new File([blob], "sample.jpg", { type: blob.type || "image/jpeg" }));
}

export default function Home() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [modelUsed, setModelUsed] = useState("");
  const [attempts, setAttempts] = useState<AttemptInfo[]>([]);
  const [latencyMs, setLatencyMs] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [spokenChar, setSpokenChar] = useState(-1);
  const [speechNote, setSpeechNote] = useState("");

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [highContrast, setHighContrast] = useState(false);
  const [largeText, setLargeText] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
    if (!speechSupported()) {
      setSpeechNote("Speech is not supported in this browser — try Chrome or Edge on desktop.");
      return;
    }
    loadVoices().then((list) => {
      setVoices(list);
      if (list.length === 0) {
        setSpeechNote("No speech voices found in this browser — try Chrome or Edge on desktop.");
        return;
      }
      const preferred =
        list.find((v) => v.lang.startsWith("en") && /natural|neural|google us english/i.test(v.name)) ||
        list.find((v) => v.lang.startsWith("en")) ||
        list[0];
      setVoiceURI(preferred.voiceURI);
    });
    return () => stopSpeaking();
  }, []);

  useEffect(() => {
    document.body.classList.toggle("high-contrast", highContrast);
  }, [highContrast]);
  useEffect(() => {
    document.body.classList.toggle("large-text", largeText);
  }, [largeText]);

  const analyzeImage = useCallback(async (dataUrl: string, name: string) => {
    stopSpeaking();
    setSpeaking(false);
    setSpokenChar(-1);
    setError("");
    setAnalysis(null);
    setChat([]);
    setImageUrl(dataUrl);
    setImageName(name);
    setAnalyzing(true);
    setProgress("Sending your photo to the vision model…");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Analysis failed (HTTP ${res.status}).`);
      setAnalysis(payload.analysis as Analysis);
      setModelUsed(payload.model as string);
      setAttempts((payload.attempts as AttemptInfo[]) || []);
      setLatencyMs(payload.totalLatencyMs as number);
      setHistory(
        saveHistoryEntry({
          title: name,
          thumbnail: dataUrl,
          description: (payload.analysis as Analysis).description,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
      setProgress("");
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const dataUrl = await fileToDataUrl(file);
        await analyzeImage(dataUrl, file.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load that image.");
      }
    },
    [analyzeImage],
  );

  const handleSample = useCallback(
    async (src: string, title: string) => {
      try {
        const dataUrl = await urlToDataUrl(src);
        await analyzeImage(dataUrl, title);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load that sample.");
      }
    },
    [analyzeImage],
  );

  const selectedVoice = useMemo(
    () => voices.find((v) => v.voiceURI === voiceURI) ?? null,
    [voices, voiceURI],
  );

  const handleListen = useCallback(() => {
    if (!analysis) return;
    if (speaking && !paused) {
      pauseSpeaking();
      setPaused(true);
      return;
    }
    if (speaking && paused) {
      resumeSpeaking();
      setPaused(false);
      return;
    }
    if (voices.length === 0) {
      setSpeechNote("No speech voices found in this browser — try Chrome or Edge on desktop.");
      return;
    }
    setSpeechNote("");
    setSpeaking(true);
    setPaused(false);
    speak({
      text: analysis.description,
      voice: selectedVoice,
      rate,
      pitch,
      onBoundary: (charIndex) => setSpokenChar(charIndex),
      onEnd: () => {
        setSpeaking(false);
        setPaused(false);
        setSpokenChar(-1);
      },
      onError: (message) => {
        setSpeaking(false);
        setSpeechNote(`Speech failed: ${message}. Try another voice.`);
      },
    });
  }, [analysis, speaking, paused, voices, selectedVoice, rate, pitch]);

  const handleStopSpeech = useCallback(() => {
    stopSpeaking();
    setSpeaking(false);
    setPaused(false);
    setSpokenChar(-1);
  }, []);

  const askQuestion = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || !imageUrl || asking) return;
      setQuestion("");
      setError("");
      const nextChat: ChatTurn[] = [...chat, { role: "user", content: q }];
      setChat(nextChat);
      setAsking(true);
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageDataUrl: imageUrl, question: q, history: chat }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || `Could not answer (HTTP ${res.status}).`);
        setChat([...nextChat, { role: "assistant", content: String(payload.answer) }]);
        setModelUsed(payload.model as string);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not answer that question.");
      } finally {
        setAsking(false);
      }
    },
    [chat, imageUrl, asking],
  );

  // Word offsets for speak-along highlighting.
  const words = useMemo(() => {
    if (!analysis) return [];
    const out: Array<{ text: string; start: number }> = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(analysis.description)) !== null) {
      out.push({ text: m[0], start: m.index });
    }
    return out;
  }, [analysis]);

  const copyAltText = useCallback(async () => {
    if (!analysis?.altText) return;
    try {
      await navigator.clipboard.writeText(analysis.altText);
    } catch {
      /* clipboard unavailable — user can select the text manually */
    }
  }, [analysis]);

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <div className="logo" aria-hidden="true">👁️</div>
          <div>
            <h1>Lumina</h1>
            <p>Visual Search Assistant — see the world, hear the story</p>
          </div>
        </div>
        <div className="toggles" role="group" aria-label="Accessibility display options">
          <button
            className="chip-btn"
            aria-pressed={highContrast}
            onClick={() => setHighContrast((v) => !v)}
          >
            ◐ High contrast
          </button>
          <button
            className="chip-btn"
            aria-pressed={largeText}
            onClick={() => setLargeText((v) => !v)}
          >
            A+ Large text
          </button>
        </div>
      </header>

      <section className="hero">
        <h2>From a picture to a story you can hear</h2>
        <p>
          Lumina turns photos into words and words into speech. Upload a photo — AI vision
          describes it in detail, then reads the description aloud. Ask follow-up questions
          or tap an object to find exactly where it is in the frame.
        </p>
        <div className="steps">
          <span className="step"><b>1</b> Upload or pick a photo</span>
          <span className="step"><b>2</b> AI describes it</span>
          <span className="step"><b>3</b> Listen &amp; ask questions</span>
        </div>
      </section>

      <section className="card" aria-label="Add a photo">
        <h2>Add a photo</h2>
        <p className="sub">JPG, PNG, WebP or GIF — up to 8 MB. Photos are sent to the vision model only to be described; nothing is stored on a server.</p>
        <div
          className={`dropzone${dragOver ? " drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
        >
          <div className="big" aria-hidden="true">🖼️</div>
          <p>Drag a photo here, or choose a file from your device.</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={analyzing}>
            Choose a photo
          </button>
        </div>

        <h2 style={{ marginTop: 18 }}>Or try a sample</h2>
        <p className="sub">No photo handy? These six work instantly.</p>
        <div className="samples">
          {SAMPLE_PHOTOS.map((s) => (
            <button key={s.id} className="sample" onClick={() => void handleSample(s.src, s.title)} disabled={analyzing}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={s.title} loading="lazy" />
              <span>{s.title}</span>
            </button>
          ))}
        </div>

        {analyzing && (
          <p className="progress-steps" role="status">
            <span className="spinner" aria-hidden="true" /> {progress}
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            {error}{" "}
            {imageUrl && (
              <button className="btn small secondary" onClick={() => void analyzeImage(imageUrl, imageName)}>
                Retry
              </button>
            )}
          </div>
        )}
      </section>

      {imageUrl && analysis && (
        <section className="card" aria-label="Photo analysis">
          <div className="grid2">
            <div>
              <div className="photo-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={analysis.altText || imageName} />
              </div>
              <div className="meta">
                <span>📷 {imageName}</span>
                <span>Model <code>{modelUsed}</code></span>
                <span>⏱ {(latencyMs / 1000).toFixed(1)}s</span>
                {attempts.length > 1 && (
                  <span title={attempts.map((a) => `${a.model}: ${a.ok ? "ok" : a.error || a.status}`).join(" | ")}>
                    🔁 failover ×{attempts.length}
                  </span>
                )}
              </div>
              <div className="row">
                <button className="btn" onClick={handleListen} disabled={voices.length === 0 && !speaking}>
                  {speaking && !paused ? "⏸ Pause reading" : speaking && paused ? "▶ Resume reading" : "🔊 Listen to description"}
                </button>
                {speaking && (
                  <button className="btn secondary" onClick={handleStopSpeech}>⏹ Stop</button>
                )}
              </div>
              <div className="controls">
                <div>
                  <label htmlFor="voice">Voice</label>
                  <select id="voice" value={voiceURI} onChange={(e) => setVoiceURI(e.target.value)}>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rate">Speed: {rate.toFixed(1)}×</label>
                  <input id="rate" type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
                </div>
                <div>
                  <label htmlFor="pitch">Pitch: {pitch.toFixed(1)}</label>
                  <input id="pitch" type="range" min={0.5} max={1.5} step={0.1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />
                </div>
              </div>
              {speechNote && <p className="speech-note">{speechNote}</p>}
            </div>

            <div>
              <h2>What Lumina sees</h2>
              <p className="desc" aria-live="polite">
                {words.map((w, i) => {
                  const next = words[i + 1];
                  const isSpoken =
                    speaking && spokenChar >= w.start && (next ? spokenChar < next.start : true);
                  return (
                    <span key={i} className={`word${isSpoken ? " spoken" : ""}`}>
                      {w.text}{" "}
                    </span>
                  );
                })}
              </p>

              {analysis.objects.length > 0 && (
                <>
                  <h2 style={{ marginTop: 16 }}>Objects — tap to find one</h2>
                  <div className="kv">
                    {analysis.objects.map((obj) => (
                      <button
                        key={obj}
                        className="tag obj"
                        onClick={() => void askQuestion(`Where is the ${obj} in this photo? Describe its position and what it looks like.`)}
                        title={`Ask where the ${obj} is`}
                      >
                        🔍 {obj}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {analysis.colors.length > 0 && (
                <>
                  <h2 style={{ marginTop: 16 }}>Colours &amp; mood</h2>
                  <div className="kv">
                    {analysis.colors.map((c) => (
                      <span key={c} className="tag">{c}</span>
                    ))}
                    {analysis.mood && <span className="tag">Mood: {analysis.mood}</span>}
                  </div>
                </>
              )}

              {analysis.altText && (
                <div style={{ marginTop: 16 }}>
                  <h2>Alt text (ready to copy)</h2>
                  <div className="altbox">
                    <code>alt=&quot;{analysis.altText}&quot;</code>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn small secondary" onClick={copyAltText}>📋 Copy alt text</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <h2>Ask about this photo</h2>
            <p className="sub">Visual search: ask anything — Lumina looks at the photo again and answers.</p>
            <div className="suggest">
              <button className="btn small secondary" onClick={() => void askQuestion("What is happening in this photo?")}>What is happening here?</button>
              <button className="btn small secondary" onClick={() => void askQuestion("What colours dominate this photo?")}>What colours dominate?</button>
              <button className="btn small secondary" onClick={() => void askQuestion("Is there any text visible in this photo? If so, what does it say?")}>Is there any text?</button>
              <button className="btn small secondary" onClick={() => void askQuestion("Describe the background of this photo.")}>Describe the background</button>
            </div>
            <form
              className="askbox"
              onSubmit={(e) => {
                e.preventDefault();
                void askQuestion(question);
              }}
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask anything about this photo…"
                aria-label="Ask a question about this photo"
                maxLength={500}
              />
              <button className="btn" type="submit" disabled={asking || !question.trim()}>
                {asking ? "Thinking…" : "Ask"}
              </button>
            </form>
            <div className="chat">
              {chat.map((turn, i) => (
                <div key={i} className={`msg ${turn.role}`}>
                  <span className="who">{turn.role === "user" ? "You" : "Lumina"}</span>
                  {turn.content}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="card" aria-label="Recent photos">
          <h2>Recent photos</h2>
          <p className="sub">Saved only in your browser — nothing leaves your device.</p>
          <div className="history">
            {history.map((h) => (
              <button
                key={h.id}
                className="hist-item"
                onClick={() => {
                  if (h.thumbnail) void analyzeImage(h.thumbnail, h.title);
                }}
                title={h.description}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {h.thumbnail ? <img src={h.thumbnail} alt={h.title} /> : null}
                <span>{h.title}</span>
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn small ghost" onClick={() => { clearHistory(); setHistory([]); }}>
              Clear history
            </button>
          </div>
        </section>
      )}

      <footer>
        Lumina — Visual Search Assistant · StackUp November Coding Challenge · Theme: From Words to Worlds (Multimodal GenAI) ·
        Vision via OpenRouter free-tier models with automatic failover · Speech via your browser&apos;s built-in voices · MIT License
      </footer>
    </main>
  );
}
