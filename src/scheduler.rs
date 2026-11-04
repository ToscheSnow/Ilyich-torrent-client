use std::{
  collections::{HashMap, HashSet},
  net::SocketAddr,
  sync::{Arc, RwLock},
  time::{Duration, Instant},
};

use tokio::{
  select,
  sync::mpsc::{UnboundedReceiver, error::TrySendError},
  task::JoinHandle,
  time::interval,
};

use crate::{
  event::event::TorrentEvent,
  peer_protocol::BlockRequest,
  peers::{
    client::BLOCK_SIZE,
    peer::{PeerCommand, PeerHandle},
  },
  pieces::piece_geometry::PieceGeometry,
};

const MIN_DEPTH: usize = 20; // blocks in flight for a new or slow peer
const MAX_DEPTH: usize = 150;
const TARGET_QUEUE_SECS: f64 = 4.0; // keep ~4s of data queued per peer
const STALE_REQ: Duration = Duration::from_secs(10); // a single request older than this is re-queued
const STALL: Duration = Duration::from_secs(5); // a started piece with no new block for this long is "stalled"
const PARK: Duration = Duration::from_secs(10); // how long a parked piece sits out
const SWEEP: Duration = Duration::from_secs(2);
const ACTIVE_BYTES: u64 = 125 * 1024 * 1024; // total bytes worth of pieces open at once

type Key = (u32, u32); // (piece_idx, offset)

#[derive(Default)]
struct Rate {
  blocks: u32,
  per_sec: f64,
}

pub struct Scheduler {
  max_active_pieces: usize,
  total_pieces: u32,
  geometry: PieceGeometry,
  event_queue: UnboundedReceiver<TorrentEvent>,

  // ---- piece bookkeeping ----
  verified: Vec<bool>,
  in_slot: HashSet<u32>,
  pending: HashMap<u32, Vec<u32>>, // started piece -> offsets still to hand out (pop from the end)
  received: HashMap<u32, HashSet<u32>>, // piece -> offsets the PieceManager already holds
  last_progress: HashMap<u32, Instant>,
  stalls: HashMap<u32, u8>,
  cooldown: HashMap<u32, Instant>,
  fail_count: HashMap<u32, u32>,

  // ---- request bookkeeping ----
  // invariant: key is in peer_reqs[addr]  <=>  requested[key].0 == addr
  unchoked: HashMap<SocketAddr, PeerHandle>,
  requested: HashMap<Key, (SocketAddr, Instant)>,
  peer_reqs: HashMap<SocketAddr, HashSet<Key>>,
  rates: HashMap<SocketAddr, Rate>,
  last_sweep: Instant,

  // ---- who needs a refill after this batch of events ----
  refill: HashSet<SocketAddr>,
  refill_all: bool,
}

impl Scheduler {
  pub fn new(
    _active_peers: Arc<RwLock<HashSet<PeerHandle>>>, // no longer needed, kept so Torrent::new stays unchanged
    event_queue: UnboundedReceiver<TorrentEvent>,
    total_length: u64,
    piece_length: u32,
  ) -> Self {
    let total_pieces = total_length.div_ceil(piece_length as u64) as u32;
    let blocks_per_piece = piece_length.div_ceil(BLOCK_SIZE as u32) as u64;
    let max_active_pieces = ACTIVE_BYTES
      .div_ceil(blocks_per_piece * BLOCK_SIZE as u64)
      .max(1) as usize;

    Self {
      max_active_pieces,
      total_pieces,
      geometry: PieceGeometry::new(total_length, piece_length),
      event_queue,
      verified: vec![false; total_pieces as usize],
      in_slot: HashSet::new(),
      pending: HashMap::new(),
      received: HashMap::new(),
      last_progress: HashMap::new(),
      stalls: HashMap::new(),
      cooldown: HashMap::new(),
      fail_count: HashMap::new(),
      unchoked: HashMap::new(),
      requested: HashMap::new(),
      peer_reqs: HashMap::new(),
      rates: HashMap::new(),
      last_sweep: Instant::now(),
      refill: HashSet::new(),
      refill_all: false,
    }
  }

  pub fn run(mut self) -> JoinHandle<()> {
    tokio::spawn(async move {
      let mut sweep = interval(SWEEP);
      loop {
        select! {
          event = self.event_queue.recv() => {
            let Some(event) = event else { break };
            if self.handle(event) {
              break;
            }
            // drain whatever else is queued, then refill ONCE
            let mut done = false;
            while let Ok(e) = self.event_queue.try_recv() {
              if self.handle(e) {
                done = true;
                break;
              }
            }
            if done {
              break;
            }
          },
          _ = sweep.tick() => self.sweep(),
        }
        self.flush();
      }
    })
  }

  // ---------- events (only mutate state + mark who needs a refill) ----------
  /// returns true when the download is complete
  fn handle(&mut self, event: TorrentEvent) -> bool {
    match event {
      TorrentEvent::DownloadComplete => return true,

      TorrentEvent::Unchoke(peer) => {
        let addr = peer.addr;
        self.unchoked.insert(addr, peer);
        self.refill.insert(addr);
      }

      TorrentEvent::Choke(peer) => {
        self.unchoked.remove(&peer.addr);
        self.release_blocks(peer.addr);
        self.refill_all = true;
      }

      TorrentEvent::Disconnect(peer) => {
        self.unchoked.remove(&peer.addr);
        self.rates.remove(&peer.addr);
        self.release_blocks(peer.addr);
        self.refill_all = true;
      }

      TorrentEvent::Have(peer, _) => {
        self.refill.insert(peer.addr);
      }

      TorrentEvent::Bitfield => self.refill_all = true,

      // piece already on disk (resume). Assumes Exists(piece_idx, len) and that the
      // scheduler is subscribed to Topic::Exists
      TorrentEvent::Exists(piece_idx, _) => {
        if let Some(v) = self.verified.get_mut(piece_idx as usize) {
          *v = true;
        }
      }

      TorrentEvent::BlockReceive(piece) => self.on_block(piece.piece_idx, piece.offset),

      TorrentEvent::PieceComplete(piece_idx, _) => {
        if let Some(v) = self.verified.get_mut(piece_idx as usize) {
          *v = true;
        }
        self.forget_piece(piece_idx);
        self.fail_count.remove(&piece_idx);
        self.cooldown.remove(&piece_idx);
        self.refill_all = true; // a slot just opened
      }

      // hash failed: free the slot and back off before retrying
      TorrentEvent::PieceFail(piece_idx) => {
        self.forget_piece(piece_idx);
        let n = self.fail_count.entry(piece_idx).or_default();
        *n += 1;
        let backoff = (1000u64 * 2u64.pow((*n).min(6))).min(60_000);
        self
          .cooldown
          .insert(piece_idx, Instant::now() + Duration::from_millis(backoff));
        self.refill_all = true;
      }

      _ => {}
    }
    false
  }

  fn on_block(&mut self, piece: u32, offset: u32) {
    if self.verified.get(piece as usize).copied().unwrap_or(true) {
      return;
    }

    if self.in_slot.contains(&piece) {
      self.last_progress.insert(piece, Instant::now());
      self.stalls.remove(&piece);
    }

    self.received.entry(piece).or_default().insert(offset);

    // if a duplicate request for it was queued, don't send it
    if let Some(offs) = self.pending.get_mut(&piece) {
      offs.retain(|o| *o != offset);
    }

    let key = (piece, offset);
    if let Some((addr, _)) = self.requested.remove(&key) {
      if let Some(set) = self.peer_reqs.get_mut(&addr) {
        set.remove(&key);
      }
      self.rates.entry(addr).or_default().blocks += 1;
      self.refill.insert(addr); // this peer has room again, top it up
    }
  }

  // ---------- refilling ----------
  fn flush(&mut self) {
    let addrs: Vec<SocketAddr> = if self.refill_all {
      self.unchoked.keys().copied().collect()
    } else {
      self.refill.iter().copied().collect()
    };
    self.refill.clear();
    self.refill_all = false;

    for addr in addrs {
      self.request_peer(addr);
    }
  }

  /// ~4 seconds of data per peer: slow peers can't hoard blocks anymore
  fn inflight_limit(&self, addr: &SocketAddr) -> usize {
    let per_sec = self.rates.get(addr).map_or(0.0, |r| r.per_sec);
    ((per_sec * TARGET_QUEUE_SECS).ceil() as usize).clamp(MIN_DEPTH, MAX_DEPTH)
  }

  fn request_peer(&mut self, addr: SocketAddr) {
    let Some(peer) = self.unchoked.get(&addr).cloned() else {
      return;
    };

    let limit = self.inflight_limit(&addr);
    let mut dead = false;

    {
      let bits = peer.available_pieces.read().unwrap();
      loop {
        let inflight = self.peer_reqs.get(&addr).map_or(0, |s| s.len());
        if inflight >= limit {
          break;
        }

        let Some((piece, offset)) = self.next_for(addr, &bits) else {
          break;
        };

        let length = self.geometry.get_block_length(piece, offset);
        let cmd = PeerCommand::Request(BlockRequest {
          piece_idx: piece,
          offset,
          length,
        });

        match peer.cmd_sender.try_send(cmd) {
          Ok(()) => self.record_request(addr, (piece, offset)),
          Err(TrySendError::Full(_)) => {
            self.pending.entry(piece).or_default().push(offset);
            break;
          }
          Err(TrySendError::Closed(_)) => {
            self.pending.entry(piece).or_default().push(offset);
            dead = true;
            break;
          }
        }
      }
    }

    if dead {
      self.unchoked.remove(&addr);
      self.release_blocks(addr);
    }
  }

  fn record_request(&mut self, addr: SocketAddr, key: Key) {
    // a duplicate request moves ownership to the new peer
    if let Some((old, _)) = self.requested.insert(key, (addr, Instant::now())) {
      if old != addr {
        if let Some(set) = self.peer_reqs.get_mut(&old) {
          set.remove(&key);
        }
      }
    }
    self.peer_reqs.entry(addr).or_default().insert(key);
  }

  // ---------- picking blocks ----------
  fn next_for(&mut self, addr: SocketAddr, bits: &[u8]) -> Option<Key> {
    loop {
      // 1) blocks from pieces that already hold a slot
      if let Some(key) = self.take_from_slots(addr, bits) {
        return Some(key);
      }

      if self.in_slot.len() >= self.max_active_pieces {
        return None;
      }

      // 2) open a brand new piece this peer has
      let idx = self.pick_new_piece(bits)?;
      let offsets = self.missing_offsets(idx);
      self.start_piece(idx, offsets);
    }
  }

  fn take_from_slots(&mut self, addr: SocketAddr, bits: &[u8]) -> Option<Key> {
    let mut emptied: Vec<u32> = Vec::new();
    let mut found: Option<Key> = None;

    for (&idx, offs) in self.pending.iter_mut() {
      if offs.is_empty() {
        emptied.push(idx);
        continue;
      }
      if !peer_has(bits, idx) {
        continue;
      }

      let requested = &self.requested;
      // don't ask the same peer twice for a block it's already fetching
      let pos = offs
        .iter()
        .rposition(|&o| requested.get(&(idx, o)).map_or(true, |(a, _)| *a != addr));

      if let Some(pos) = pos {
        let offset = offs.remove(pos);
        if offs.is_empty() {
          emptied.push(idx);
        }
        found = Some((idx, offset));
        break;
      }
    }

    for idx in emptied {
      self.pending.remove(&idx);
    }
    found
  }

  fn pick_new_piece(&self, bits: &[u8]) -> Option<u32> {
    let now = Instant::now();
    for (byte_idx, &byte) in bits.iter().enumerate() {
      if byte == 0 {
        continue;
      }
      for bit in 0..8u32 {
        if byte & (0x80u8 >> bit) == 0 {
          continue;
        }
        let idx = byte_idx as u32 * 8 + bit;
        if idx >= self.total_pieces {
          return None;
        }
        if self.verified[idx as usize] || self.in_slot.contains(&idx) {
          continue;
        }
        if self.cooldown.get(&idx).is_some_and(|t| *t > now) {
          continue;
        }
        let have = self.received.get(&idx).map_or(0, |s| s.len() as u32);
        if have >= self.geometry.get_block_count(idx) {
          continue; // every block is already in the PieceManager
        }
        return Some(idx);
      }
    }
    None
  }

  /// offsets not received yet, reversed so pop()/rposition hands them out in ascending order
  fn missing_offsets(&self, idx: u32) -> Vec<u32> {
    let recvd = self.received.get(&idx);
    (0..self.geometry.get_block_count(idx))
      .rev()
      .map(|i| i * BLOCK_SIZE as u32)
      .filter(|o| recvd.map_or(true, |s| !s.contains(o)))
      .collect()
  }

  fn start_piece(&mut self, idx: u32, offsets: Vec<u32>) {
    self.in_slot.insert(idx);
    self.stalls.remove(&idx);
    self.last_progress.insert(idx, Instant::now());
    self.pending.insert(idx, offsets);
  }

  // ---------- cleanup ----------
  /// piece finished or failed: forget every trace of it
  fn forget_piece(&mut self, idx: u32) {
    for i in 0..self.geometry.get_block_count(idx) {
      let key = (idx, i * BLOCK_SIZE as u32);
      if let Some((addr, _)) = self.requested.remove(&key) {
        if let Some(set) = self.peer_reqs.get_mut(&addr) {
          set.remove(&key);
        }
      }
    }
    self.pending.remove(&idx);
    self.in_slot.remove(&idx);
    self.received.remove(&idx);
    self.last_progress.remove(&idx);
    self.stalls.remove(&idx);
  }

  /// give the slot back and sit out for a while (blocks already received stay in the PieceManager)
  fn park(&mut self, idx: u32) {
    self.pending.remove(&idx);
    self.in_slot.remove(&idx);
    self.last_progress.remove(&idx);
    self.stalls.remove(&idx);
    self.cooldown.insert(idx, Instant::now() + PARK);
  }

  /// put a block back in the pool, but only if it's still wanted
  fn requeue(&mut self, piece: u32, offset: u32) {
    if !self.in_slot.contains(&piece) || self.verified[piece as usize] {
      return;
    }
    if self.received.get(&piece).is_some_and(|s| s.contains(&offset)) {
      return;
    }
    let offs = self.pending.entry(piece).or_default();
    if !offs.contains(&offset) {
      offs.push(offset);
    }
  }

  /// peer choked / disconnected: everything it owed us goes back in the pool
  fn release_blocks(&mut self, addr: SocketAddr) {
    let Some(keys) = self.peer_reqs.remove(&addr) else {
      return;
    };
    for key in keys {
      if self.requested.get(&key).is_some_and(|(a, _)| *a == addr) {
        self.requested.remove(&key);
        self.requeue(key.0, key.1);
      }
    }
  }

  // ---------- maintenance ----------
  fn sweep(&mut self) {
    let now = Instant::now();

    // 0) refresh per-peer block rates
    let secs = now.duration_since(self.last_sweep).as_secs_f64().max(0.001);
    self.last_sweep = now;
    for r in self.rates.values_mut() {
      let inst = r.blocks as f64 / secs;
      r.per_sec = if r.per_sec == 0.0 {
        inst
      } else {
        r.per_sec * 0.5 + inst * 0.5
      };
      r.blocks = 0;
    }

    // 1) individual requests that have been outstanding too long
    let stale: Vec<Key> = self
      .requested
      .iter()
      .filter(|(_, (_, sent))| now.duration_since(*sent) >= STALE_REQ)
      .map(|(k, _)| *k)
      .collect();

    for key in stale {
      if let Some((addr, _)) = self.requested.remove(&key) {
        if let Some(set) = self.peer_reqs.get_mut(&addr) {
          set.remove(&key);
        }
        self.requeue(key.0, key.1);
      }
    }

    // 2) pieces that stopped making progress
    let slots: Vec<u32> = self.in_slot.iter().copied().collect();
    for idx in slots {
      let last = self.last_progress.get(&idx).copied().unwrap_or(now);
      if now.duration_since(last) < STALL {
        continue;
      }

      let n = {
        let n = self.stalls.entry(idx).or_default();
        *n += 1;
        *n
      };

      if n >= 2 {
        self.park(idx); // stalled twice: nobody can serve it right now
        continue;
      }

      // first stall: open the missing blocks to other peers (duplicates are fine)
      let missing = self.missing_offsets(idx);
      if !missing.is_empty() {
        self.pending.insert(idx, missing);
      }
      self.last_progress.insert(idx, now);
    }

    self.refill_all = true;
  }
}

fn peer_has(bits: &[u8], piece: u32) -> bool {
  let byte = (piece / 8) as usize;
  byte < bits.len() && bits[byte] & (0x80u8 >> (piece % 8)) != 0
}