import { useEffect, useRef, useState } from "react";
import type { IceServer, VoicePeer } from "@scrabble/game-engine/protocol";

/**
 * Live voice chat for an online room. Audio goes straight between browsers
 * over WebRTC (encrypted, never recorded); the room's WebSocket only relays
 * the few messages browsers need to find each other. With 2 to 4 players
 * every player calls every other one directly. Of each pair, the player
 * with the smaller id places the call, so two offers never cross.
 */

export type VoiceStatus =
  | "off"
  | "joining"
  | "on"
  | "denied"
  | "unsupported"
  | "error";
export type LinkState = "connecting" | "connected" | "failed";
export interface VoiceSnapshot {
  status: VoiceStatus;
  /** Why the last attempt to join failed, in words for the player. */
  error: string | null;
  muted: boolean;
  speakerOff: boolean;
  /** Everyone in the voice chat, as the server last reported. */
  peers: readonly VoicePeer[];
  /** Player ids heard talking in the last moment, including mine. */
  speaking: ReadonlySet<string>;
  /** How my call to each other player in voice is going. */
  links: ReadonlyMap<string, LinkState>;
  /** The browser would not start playback until the player taps. */
  blocked: boolean;
}
interface Signal {
  session: string;
  toSession: string;
  description?: { type: "offer" | "answer"; sdp: string } | undefined;
  candidate?:
    | {
        candidate: string;
        sdpMid?: string | null | undefined;
        sdpMLineIndex?: number | null | undefined;
        usernameFragment?: string | null | undefined;
      }
    | undefined;
  bye?: true | undefined;
}
export type VoiceMessage =
  | { type: "voice.roster"; peers: VoicePeer[] }
  | { type: "voice.config"; iceServers: IceServer[] }
  | ({ type: "voice.signal"; from: string } & Signal);

const DEFAULT_ICE: IceServer[] = [
    {
      urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"],
    },
  ],
  /** RMS level that counts as talking; echo-cancelled room noise sits well below. */
  SPEAKING_LEVEL = 0.02,
  /** How long a name stays lit after the voice drops, so it doesn't flicker. */
  SPEAKING_HOLD_MS = 450,
  /** A call that has not connected by now is placed again. */
  CONNECT_TIMEOUT_MS = 15_000,
  /** How often a failed call is retried before it is reported as failed. */
  MAX_ATTEMPTS = 4,
  /** A connected player missing from the roster (a WebSocket blip) keeps
   * talking this long before the call is dropped. */
  GONE_GRACE_MS = 12_000,
  SPEAKER_KEY = "scrabble.voice.speaker";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isSession = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(value);

/** Validates a voice message from the server. */
export function isVoiceMessage(value: unknown): value is VoiceMessage {
  if (!isRecord(value)) return false;
  if (value.type === "voice.roster")
    return (
      Array.isArray(value.peers) &&
      value.peers.every(
        (peer) =>
          isRecord(peer) &&
          typeof peer.playerId === "string" &&
          isSession(peer.session) &&
          typeof peer.muted === "boolean",
      )
    );
  if (value.type === "voice.config")
    return (
      Array.isArray(value.iceServers) &&
      value.iceServers.every(
        (server) =>
          isRecord(server) &&
          (typeof server.urls === "string" ||
            (Array.isArray(server.urls) &&
              server.urls.every((url) => typeof url === "string"))),
      )
    );
  if (value.type === "voice.signal") {
    const { description, candidate } = value;
    return (
      typeof value.from === "string" &&
      isSession(value.session) &&
      isSession(value.toSession) &&
      (description === undefined ||
        (isRecord(description) &&
          (description.type === "offer" || description.type === "answer") &&
          typeof description.sdp === "string")) &&
      (candidate === undefined ||
        (isRecord(candidate) && typeof candidate.candidate === "string")) &&
      (value.bye === undefined || value.bye === true)
    );
  }
  return false;
}

/** Root-mean-square of an analyser frame: 0 is silence, 1 is full scale. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Who counts as speaking at `now`, given when each was last loud. */
export function speakingAt(
  loudAt: ReadonlyMap<string, number>,
  now: number,
): Set<string> {
  const speaking = new Set<string>();
  for (const [id, at] of loudAt)
    if (now - at < SPEAKING_HOLD_MS) speaking.add(id);
  return speaking;
}

/**
 * Marks the call's audio as high priority, so browsers and networks that
 * honour it send voice ahead of other traffic (the default is "low"). Best
 * effort: a browser that refuses keeps the default.
 */
async function prioritize(pc: RTCPeerConnection) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "audio") continue;
    const parameters = sender.getParameters();
    if (!parameters.encodings.length) continue;
    parameters.encodings = parameters.encodings.map((encoding) => ({
      ...encoding,
      priority: "high",
      networkPriority: "high",
    }));
    try {
      await sender.setParameters(parameters);
    } catch {
      // Unsupported here; the call carries on at default priority.
    }
  }
}
function newSession(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
function readSpeakerOff(): boolean {
  try {
    return localStorage.getItem(SPEAKER_KEY) === "off";
  } catch {
    return false;
  }
}

interface Meter {
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  frame: Float32Array<ArrayBuffer>;
}
interface Link {
  playerId: string;
  /** The other player's voice session this call belongs to. */
  session: string;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  meter: Meter | null;
  /** Candidates that arrived before the remote description. */
  pending: RTCIceCandidateInit[];
  /** Signals are applied one at a time, in arrival order. */
  queue: Promise<void>;
  state: LinkState;
  watchdog: number | null;
  goneTimer: number | null;
}

export class VoiceSession {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private self: Meter | null = null;
  private session: string | null = null;
  private links = new Map<string, Link>();
  private attempts = new Map<string, number>();
  private ice: IceServer[] = DEFAULT_ICE;
  private loudAt = new Map<string, number>();
  private poll: number | null = null;
  private destroyed = false;
  private snapshot: VoiceSnapshot;

  constructor(
    private readonly selfId: string,
    private readonly roomCode: string,
    private readonly send: (message: object) => boolean,
    private readonly onChange: (snapshot: VoiceSnapshot) => void,
  ) {
    this.snapshot = {
      status:
        typeof RTCPeerConnection === "undefined" ||
        // Missing on pages that are not served over HTTPS.
        !("mediaDevices" in navigator)
          ? "unsupported"
          : "off",
      error: null,
      muted: this.remembered() === "muted",
      speakerOff: readSpeakerOff(),
      peers: [],
      speaking: new Set(),
      links: new Map(),
      blocked: false,
    };
  }

  private isDestroyed() {
    return this.destroyed;
  }

  get state(): VoiceSnapshot {
    return this.snapshot;
  }

  /** Rejoins after a reload when this tab was in voice and may use the mic. */
  async resume() {
    if (this.remembered() === null || this.snapshot.status !== "off") return;
    try {
      const permission = await navigator.permissions.query({
        name: "microphone",
      });
      if (permission.state === "granted") await this.join();
    } catch {
      // No permissions API: wait for the player to tap Join voice.
    }
  }

  async join() {
    if (
      this.destroyed ||
      this.snapshot.status === "joining" ||
      this.snapshot.status === "on" ||
      this.snapshot.status === "unsupported"
    )
      return;
    this.update({ status: "joining", error: null });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      this.update(
        name === "NotAllowedError" || name === "SecurityError"
          ? {
              status: "denied",
              error:
                "Microphone access is blocked. Allow it for this site in the browser, then try again.",
            }
          : name === "NotFoundError"
            ? { status: "error", error: "No microphone was found." }
            : name === "NotReadableError"
              ? {
                  status: "error",
                  error: "The microphone is busy in another app.",
                }
              : { status: "error", error: "Could not start the microphone." },
      );
      return;
    }
    // The room may have closed while the permission prompt was open.
    if (this.isDestroyed()) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    for (const track of stream.getAudioTracks()) {
      track.enabled = !this.snapshot.muted;
      track.addEventListener("ended", () => {
        this.leave();
        this.update({
          status: "error",
          error: "The microphone was disconnected.",
        });
      });
    }
    try {
      this.context = new AudioContext();
      this.self = this.meter(stream);
      void this.context.resume();
    } catch {
      // Without Web Audio there are no speaking rings, but calls still work.
    }
    this.session = newSession();
    this.poll = window.setInterval(() => this.listen(), 100);
    this.remember(this.snapshot.muted ? "muted" : "on");
    this.update({ status: "on" });
    this.announce();
  }

  /**
   * Hangs up every call and releases the microphone. `forget` is false when
   * the page is going away, so a reload joins again by itself.
   */
  leave(forget = true) {
    if (this.session) {
      for (const link of this.links.values()) this.signal(link, { bye: true });
      this.send({
        protocolVersion: 1,
        type: "voice.state",
        session: null,
        muted: this.snapshot.muted,
      });
    }
    this.teardown();
    if (forget) this.remember(null);
    this.update({
      status: this.snapshot.status === "unsupported" ? "unsupported" : "off",
      speaking: new Set(),
      links: new Map(),
      blocked: false,
    });
  }

  destroy() {
    this.destroyed = true;
    this.teardown();
  }

  setMuted(muted: boolean) {
    for (const track of this.stream?.getAudioTracks() ?? [])
      track.enabled = !muted;
    if (this.session) this.remember(muted ? "muted" : "on");
    this.update({ muted });
    this.announce();
  }

  setSpeakerOff(speakerOff: boolean) {
    for (const link of this.links.values()) link.audio.muted = speakerOff;
    try {
      localStorage.setItem(SPEAKER_KEY, speakerOff ? "off" : "on");
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    this.update({ speakerOff });
  }

  /** Starts audio the browser held back until a tap. */
  unblock() {
    void this.context?.resume();
    let pending = 0;
    for (const link of this.links.values())
      if (link.audio.srcObject) {
        pending += 1;
        void link.audio.play().catch(() => undefined);
      }
    if (pending === 0 || this.context?.state !== "suspended")
      this.update({ blocked: false });
  }

  /** The room socket reconnected; the server forgot this tab's voice state. */
  resync() {
    this.announce();
  }

  handle(message: VoiceMessage) {
    if (this.destroyed) return;
    if (message.type === "voice.config") {
      if (message.iceServers.length) this.ice = message.iceServers;
      return;
    }
    if (message.type === "voice.roster") {
      this.update({ peers: message.peers });
      this.reconcile();
      return;
    }
    this.onSignal(message);
  }

  private announce() {
    if (!this.session) return;
    this.send({
      protocolVersion: 1,
      type: "voice.state",
      session: this.session,
      muted: this.snapshot.muted,
    });
  }

  private initiates(playerId: string) {
    return this.selfId < playerId;
  }

  /** Matches my calls to the roster: call newcomers, drop leavers. */
  private reconcile() {
    if (!this.session) return;
    const present = new Map(
      this.snapshot.peers
        .filter((peer) => peer.playerId !== this.selfId)
        .map((peer) => [peer.playerId, peer]),
    );
    // Someone who left and came back gets a fresh set of attempts.
    for (const id of [...this.attempts.keys()])
      if (!present.has(id)) this.attempts.delete(id);
    for (const link of [...this.links.values()]) {
      const peer = present.get(link.playerId);
      if (!peer) {
        if (link.state !== "connected") this.close(link.playerId);
        else
          link.goneTimer ??= window.setTimeout(
            () => this.close(link.playerId),
            GONE_GRACE_MS,
          );
        continue;
      }
      if (link.goneTimer !== null) {
        window.clearTimeout(link.goneTimer);
        link.goneTimer = null;
      }
      if (peer.session !== link.session) {
        this.close(link.playerId);
        this.attempts.delete(link.playerId);
      }
    }
    for (const peer of present.values())
      if (
        !this.links.has(peer.playerId) &&
        this.initiates(peer.playerId) &&
        (this.attempts.get(peer.playerId) ?? 0) < MAX_ATTEMPTS
      )
        this.call(peer);
    this.publishLinks();
  }

  private call(peer: VoicePeer) {
    const link = this.open(peer.playerId, peer.session);
    this.attempts.set(
      peer.playerId,
      (this.attempts.get(peer.playerId) ?? 0) + 1,
    );
    this.enqueue(link, async () => {
      const offer = await link.pc.createOffer();
      await link.pc.setLocalDescription(offer);
      this.signal(link, {
        description: { type: "offer", sdp: offer.sdp ?? "" },
      });
    });
  }

  private open(playerId: string, session: string): Link {
    const pc = new RTCPeerConnection({
        iceServers: this.ice.map(({ urls, username, credential }) => ({
          urls,
          ...(username === undefined ? {} : { username }),
          ...(credential === undefined ? {} : { credential }),
        })),
      }),
      audio = new Audio();
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    audio.muted = this.snapshot.speakerOff;
    const link: Link = {
      playerId,
      session,
      pc,
      audio,
      meter: null,
      pending: [],
      queue: Promise.resolve(),
      state: "connecting",
      watchdog: null,
      goneTimer: null,
    };
    const local = this.stream;
    if (local)
      for (const track of local.getAudioTracks()) pc.addTrack(track, local);
    pc.onicecandidate = (event) => {
      if (event.candidate)
        this.signal(link, {
          candidate: event.candidate.toJSON() as Signal["candidate"],
        });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = stream;
      this.play(audio);
      if (link.meter) link.meter.source.disconnect();
      link.meter = this.meter(stream);
    };
    pc.onconnectionstatechange = () => this.onState(link);
    link.watchdog = window.setTimeout(
      () => this.retry(link),
      CONNECT_TIMEOUT_MS,
    );
    this.links.set(playerId, link);
    this.publishLinks();
    return link;
  }

  private onState(link: Link) {
    if (this.links.get(link.playerId) !== link) return;
    const state = link.pc.connectionState;
    if (state === "connected") {
      link.state = "connected";
      this.attempts.delete(link.playerId);
      if (link.watchdog !== null) window.clearTimeout(link.watchdog);
      link.watchdog = null;
      void prioritize(link.pc);
    } else if (state === "failed") {
      this.retry(link);
      return;
    } else if (state === "disconnected") {
      // Often recovers by itself; if not, place the call again.
      link.watchdog ??= window.setTimeout(
        () => this.retry(link),
        CONNECT_TIMEOUT_MS / 2,
      );
    }
    this.publishLinks();
  }

  /** Drops a stuck call; the caller places it again, a few times at most. */
  private retry(link: Link) {
    if (this.links.get(link.playerId) !== link) return;
    if (link.pc.connectionState === "connected") {
      link.watchdog = null;
      return;
    }
    this.close(link.playerId);
    const peer = this.snapshot.peers.find(
      (item) => item.playerId === link.playerId,
    );
    if (peer?.session !== link.session) return;
    if (!this.initiates(link.playerId)) return;
    if ((this.attempts.get(link.playerId) ?? 0) >= MAX_ATTEMPTS) {
      this.publishLinks();
      return;
    }
    window.setTimeout(() => {
      if (!this.destroyed && this.session && !this.links.has(peer.playerId))
        this.reconcile();
    }, 1_000);
  }

  private onSignal(message: Extract<VoiceMessage, { type: "voice.signal" }>) {
    if (!this.session || message.toSession !== this.session) return;
    const link = this.links.get(message.from);
    if (message.bye) {
      if (link?.session === message.session) {
        this.close(message.from);
        this.attempts.delete(message.from);
      }
      return;
    }
    const { description, candidate } = message;
    if (description?.type === "offer") {
      if (this.initiates(message.from)) return;
      // Every offer starts a fresh call; the caller never renegotiates.
      if (link) this.close(message.from);
      const fresh = this.open(message.from, message.session);
      this.enqueue(fresh, async () => {
        await fresh.pc.setRemoteDescription(description);
        const answer = await fresh.pc.createAnswer();
        await fresh.pc.setLocalDescription(answer);
        this.signal(fresh, {
          description: { type: "answer", sdp: answer.sdp ?? "" },
        });
        await this.flush(fresh);
      });
      return;
    }
    const found = this.links.get(message.from),
      current = found?.session === message.session ? found : undefined;
    if (!current) return;
    if (description?.type === "answer")
      this.enqueue(current, async () => {
        if (current.pc.signalingState !== "have-local-offer") return;
        await current.pc.setRemoteDescription(description);
        await this.flush(current);
      });
    if (candidate)
      this.enqueue(current, async () => {
        const init: RTCIceCandidateInit = {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          ...(candidate.usernameFragment
            ? { usernameFragment: candidate.usernameFragment }
            : {}),
        };
        if (current.pc.remoteDescription)
          await this.addCandidate(current, init);
        else current.pending.push(init);
      });
  }

  private async flush(link: Link) {
    const pending = link.pending.splice(0);
    for (const candidate of pending) await this.addCandidate(link, candidate);
  }

  private async addCandidate(link: Link, candidate: RTCIceCandidateInit) {
    try {
      await link.pc.addIceCandidate(candidate);
    } catch {
      // A candidate for a call that has since moved on; harmless.
    }
  }

  private enqueue(link: Link, step: () => Promise<void>) {
    link.queue = link.queue.then(async () => {
      if (this.links.get(link.playerId) !== link) return;
      try {
        await step();
      } catch {
        this.retry(link);
      }
    });
  }

  private signal(link: Link, payload: Omit<Signal, "session" | "toSession">) {
    if (!this.session) return;
    this.send({
      protocolVersion: 1,
      type: "voice.signal",
      to: link.playerId,
      session: this.session,
      toSession: link.session,
      ...payload,
    });
  }

  private close(playerId: string) {
    const link = this.links.get(playerId);
    if (!link) return;
    this.links.delete(playerId);
    if (link.watchdog !== null) window.clearTimeout(link.watchdog);
    if (link.goneTimer !== null) window.clearTimeout(link.goneTimer);
    link.meter?.source.disconnect();
    link.pc.onicecandidate = null;
    link.pc.ontrack = null;
    link.pc.onconnectionstatechange = null;
    link.pc.close();
    link.audio.pause();
    link.audio.srcObject = null;
    this.loudAt.delete(playerId);
    this.publishLinks();
  }

  private teardown() {
    for (const id of [...this.links.keys()]) this.close(id);
    this.attempts.clear();
    if (this.poll !== null) window.clearInterval(this.poll);
    this.poll = null;
    this.self?.source.disconnect();
    this.self = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.session = null;
    this.loudAt.clear();
  }

  private play(audio: HTMLAudioElement) {
    audio.play().then(
      () => {
        if (this.snapshot.blocked && this.context?.state !== "suspended")
          this.update({ blocked: false });
      },
      () => this.update({ blocked: true }),
    );
  }

  private meter(stream: MediaStream): Meter | null {
    if (!this.context) return null;
    try {
      const source = this.context.createMediaStreamSource(stream),
        analyser = this.context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      return { source, analyser, frame: new Float32Array(analyser.fftSize) };
    } catch {
      return null;
    }
  }

  /** Samples every voice ten times a second to light up who is talking. */
  private listen() {
    if (
      this.context?.state === "suspended" &&
      this.links.size > 0 &&
      !this.snapshot.blocked
    )
      this.update({ blocked: true });
    const now = performance.now(),
      mutedIds = new Set(
        this.snapshot.peers
          .filter((peer) => peer.muted)
          .map((peer) => peer.playerId),
      );
    const level = (meter: Meter | null) => {
      if (!meter) return 0;
      meter.analyser.getFloatTimeDomainData(meter.frame);
      return rms(meter.frame);
    };
    if (!this.snapshot.muted && level(this.self) > SPEAKING_LEVEL)
      this.loudAt.set(this.selfId, now);
    for (const link of this.links.values())
      if (!mutedIds.has(link.playerId) && level(link.meter) > SPEAKING_LEVEL)
        this.loudAt.set(link.playerId, now);
    const speaking = speakingAt(this.loudAt, now),
      before = this.snapshot.speaking;
    // Muting takes effect at once, not after the hold runs out.
    if (this.snapshot.muted) speaking.delete(this.selfId);
    for (const id of mutedIds) speaking.delete(id);
    if (
      speaking.size !== before.size ||
      [...speaking].some((id) => !before.has(id))
    )
      this.update({ speaking });
  }

  private publishLinks() {
    const links = new Map<string, LinkState>();
    for (const peer of this.snapshot.peers) {
      if (peer.playerId === this.selfId || !this.session) continue;
      const link = this.links.get(peer.playerId);
      links.set(
        peer.playerId,
        link
          ? link.state
          : this.initiates(peer.playerId) &&
              (this.attempts.get(peer.playerId) ?? 0) >= MAX_ATTEMPTS
            ? "failed"
            : "connecting",
      );
    }
    this.update({ links });
  }

  private update(patch: Partial<VoiceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (!this.destroyed) this.onChange(this.snapshot);
  }

  private remembered(): "on" | "muted" | null {
    try {
      const value = sessionStorage.getItem(`scrabble.voice.${this.roomCode}`);
      return value === "on" || value === "muted" ? value : null;
    } catch {
      return null;
    }
  }
  private remember(value: "on" | "muted" | null) {
    try {
      const key = `scrabble.voice.${this.roomCode}`;
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch {
      // Private mode: a reload just asks the player to join again.
    }
  }
}

function forgetVoice(roomCode: string) {
  try {
    sessionStorage.removeItem(`scrabble.voice.${roomCode}`);
  } catch {
    // Nothing was stored.
  }
}

/**
 * Keeps one VoiceSession per room seat while voice is allowed. `send` must
 * write to whichever room socket is open and return false when none is.
 */
export function useVoice({
  enabled,
  roomCode,
  selfId,
  send,
}: {
  enabled: boolean;
  roomCode: string | null;
  selfId: string | null;
  send: (message: object) => boolean;
}) {
  const session = useRef<VoiceSession | null>(null),
    sendRef = useRef(send),
    [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);
  sendRef.current = send;
  useEffect(() => {
    // Voice switched off by the host: a later switch back on must not
    // restart anyone's microphone without them choosing to join again.
    if (!enabled && roomCode) forgetVoice(roomCode);
    if (!enabled || !roomCode || !selfId) return;
    const voice = new VoiceSession(
      selfId,
      roomCode,
      (message) => sendRef.current(message),
      setSnapshot,
    );
    session.current = voice;
    setSnapshot(voice.state);
    void voice.resume();
    const hangUp = () => voice.leave(false);
    window.addEventListener("pagehide", hangUp);
    return () => {
      window.removeEventListener("pagehide", hangUp);
      voice.leave(false);
      voice.destroy();
      if (session.current === voice) session.current = null;
      setSnapshot(null);
    };
  }, [enabled, roomCode, selfId]);
  return { voice: snapshot, session };
}
