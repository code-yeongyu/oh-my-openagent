// The script the browser runs inside the chat client's page, before the client's own code.
//
// It is plain JavaScript in a string because it executes in the page, not here. It does three things
// and nothing else:
//   1. wraps RTCPeerConnection so the call's peer connection can be found once the client builds it,
//   2. taps the inbound audio track and hands 16-bit blocks to the host,
//   3. plays host-supplied audio into a track that replaces the microphone.
//
// It never reads page storage, never touches credentials, and never writes a file. Audio lives in a
// bounded queue and is dropped, loudly, rather than growing without limit.

/** The binding the host installs; the page calls it to deliver events. */
export const BRIDGE_BINDING = "__omoHuddleEmit"

/** The namespace the host calls into with Runtime.evaluate. */
export const BRIDGE_NAMESPACE = "__omoHuddleBridge"

/** Inbound block size at 48 kHz: about 85 ms, the latency floor of the capture path. */
export const BRIDGE_BLOCK_SAMPLES = 4096

/** Ceiling on queued outbound audio. A producer faster than real time is throttled, not buffered. */
export const BRIDGE_MAX_QUEUED_SECONDS = 10

export const PAGE_BRIDGE_SOURCE = `(() => {
  if (window.${"__omoHuddleBridge"} !== undefined) return;
  var RATE = 48000;
  var BLOCK = 4096;
  var MAX_QUEUED = RATE * 10;
  var CHUNK = 8192;

  var emit = function (payload) {
    var fn = window["__omoHuddleEmit"];
    if (typeof fn !== "function") return;
    try { fn(JSON.stringify(payload)); } catch (error) { /* the host went away */ }
  };
  var toBase64 = function (samples) {
    var bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    var binary = "";
    for (var at = 0; at < bytes.length; at += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(at, Math.min(bytes.length, at + CHUNK)));
    }
    return btoa(binary);
  };
  var fromBase64 = function (encoded) {
    var binary = atob(encoded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Int16Array(bytes.buffer, 0, binary.length >> 1);
  };

  var state = { peers: [], context: null, tap: null, tapping: false, out: null, queue: [], queued: 0, lastPush: 0, playedTo: 0, sender: null, lowWater: 0, lowWaterFired: false };

  var context = function () {
    if (state.context === null) state.context = new AudioContext({ sampleRate: RATE });
    if (state.context.state === "suspended") { try { state.context.resume(); } catch (error) {} }
    return state.context;
  };

  var attachTap = function (stream) {
    if (state.tap !== null) return;
    var ctx = context();
    var source = ctx.createMediaStreamSource(stream);
    var node = ctx.createScriptProcessor(BLOCK, 1, 1);
    node.onaudioprocess = function (event) {
      if (!state.tapping) return;
      var input = event.inputBuffer.getChannelData(0);
      var pcm = new Int16Array(input.length);
      var peak = 0;
      for (var i = 0; i < input.length; i++) {
        var sample = input[i] < -1 ? -1 : input[i] > 1 ? 1 : input[i];
        pcm[i] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
        var magnitude = sample < 0 ? -sample : sample;
        if (magnitude > peak) peak = magnitude;
      }
      emit({ type: "audio", pcm: toBase64(pcm), peak: peak, at: Date.now() });
    };
    // a ScriptProcessorNode only runs while it reaches a destination; the gain sink keeps it silent
    var sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);
    state.tap = { source: source, node: node, sink: sink };
    emit({ type: "tap_ready" });
  };

  var outbound = function () {
    if (state.out !== null) return state.out;
    var ctx = context();
    var destination = ctx.createMediaStreamDestination();
    var node = ctx.createScriptProcessor(BLOCK, 1, 1);
    node.onaudioprocess = function (event) {
      var out = event.outputBuffer.getChannelData(0);
      var filled = 0;
      while (filled < out.length && state.queue.length > 0) {
        var head = state.queue[0];
        var take = Math.min(out.length - filled, head.samples.length - head.at);
        for (var i = 0; i < take; i++) out[filled + i] = head.samples[head.at + i] / 32768;
        head.at += take;
        filled += take;
        state.queued -= take;
        if (head.at >= head.samples.length) { state.queue.shift(); state.playedTo = head.id; }
      }
      for (var pad = filled; pad < out.length; pad++) out[pad] = 0;
      if (filled > 0 && state.queue.length === 0) emit({ type: "drained", id: state.playedTo });
      // backpressure: tell the host once when the queue has room again, so it never has to poll
      if (state.lowWater > 0 && !state.lowWaterFired && (state.queued / RATE) * 1000 < state.lowWater) {
        state.lowWaterFired = true;
        emit({ type: "low_water", queued_ms: Math.round((state.queued / RATE) * 1000) });
      }
    };
    node.connect(destination);
    state.out = { destination: destination, node: node };
    return state.out;
  };

  var livePeer = function () {
    for (var i = state.peers.length - 1; i >= 0; i--) {
      var peer = state.peers[i];
      if (peer.connectionState === "connected" || peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") return peer;
    }
    return state.peers.length > 0 ? state.peers[state.peers.length - 1] : null;
  };

  var Native = window.RTCPeerConnection;
  if (typeof Native === "function") {
    var Wrapped = function (config) {
      var peer = new Native(config);
      state.peers.push(peer);
      peer.addEventListener("track", function (event) {
        if (!event.track || event.track.kind !== "audio") return;
        attachTap(event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]));
      });
      peer.addEventListener("connectionstatechange", function () { emit({ type: "peer_state", state: peer.connectionState }); });
      emit({ type: "peer_created" });
      return peer;
    };
    Wrapped.prototype = Native.prototype;
    window.RTCPeerConnection = Wrapped;
  }

  window["__omoHuddleBridge"] = {
    startTap: function () { state.tapping = true; return { tapping: true, attached: state.tap !== null }; },
    stopTap: function () { state.tapping = false; return { tapping: false }; },
    push: function (encoded) {
      var samples = fromBase64(encoded);
      state.lastPush += 1;
      state.queue.push({ id: state.lastPush, samples: samples, at: 0 });
      state.queued += samples.length;
      while (state.queued > MAX_QUEUED && state.queue.length > 1) {
        var dropped = state.queue.shift();
        state.queued -= dropped.samples.length - dropped.at;
        emit({ type: "overflow", dropped: dropped.id });
      }
      outbound();
      var queuedMs = Math.round((state.queued / RATE) * 1000);
      if (state.lowWater > 0 && queuedMs >= state.lowWater) state.lowWaterFired = false;
      return { id: state.lastPush, queued_ms: queuedMs };
    },
    install: function () {
      var peer = livePeer();
      if (peer === null) return { ok: false, reason: "the client has no peer connection yet" };
      var senders = peer.getSenders();
      var sender = null;
      for (var i = 0; i < senders.length; i++) {
        if (senders[i].track !== null && senders[i].track.kind === "audio") { sender = senders[i]; break; }
      }
      if (sender === null) { for (var j = 0; j < senders.length; j++) { if (senders[j].track === null) { sender = senders[j]; break; } } }
      if (sender === null) return { ok: false, reason: "the call carries no outgoing audio sender" };
      var track = outbound().destination.stream.getAudioTracks()[0];
      return sender.replaceTrack(track).then(function () {
        state.sender = sender;
        track.enabled = true;
        emit({ type: "outbound_installed" });
        return { ok: true };
      }, function (error) { return { ok: false, reason: String(error) }; });
    },
    setLowWater: function (ms) { state.lowWater = ms; state.lowWaterFired = false; return { low_water_ms: ms }; },
    unmute: function () {
      if (state.out === null) return { ok: false };
      var tracks = state.out.destination.stream.getAudioTracks();
      for (var i = 0; i < tracks.length; i++) tracks[i].enabled = true;
      return { ok: true };
    },
    snapshot: function () {
      return {
        peers: state.peers.length,
        tapping: state.tapping,
        tapped: state.tap !== null,
        injecting: state.sender !== null,
        queued_ms: Math.round((state.queued / RATE) * 1000),
        played_to: state.playedTo,
        peer_state: livePeer() === null ? null : livePeer().connectionState,
      };
    },
    stats: function () {
      var peer = livePeer();
      if (peer === null) return Promise.resolve(null);
      return peer.getStats().then(function (report) {
        var result = { outbound: null, inbound: null };
        report.forEach(function (entry) {
          if (entry.type === "outbound-rtp" && entry.kind === "audio") result.outbound = { packetsSent: entry.packetsSent, bytesSent: entry.bytesSent };
          if (entry.type === "inbound-rtp" && entry.kind === "audio") result.inbound = { packetsReceived: entry.packetsReceived, bytesReceived: entry.bytesReceived, audioLevel: entry.audioLevel };
        });
        return result;
      });
    },
  };
  emit({ type: "bridge_ready" });
})();`
