// Client -> Nexus
export const MSG_PEER_REGISTER = 'PEER_REGISTER';
export const MSG_PEER_HEARTBEAT = 'PEER_HEARTBEAT';
export const MSG_PEER_REQUEST = 'PEER_REQUEST';     // request events with P2P preference
export const MSG_PEER_SIGNAL = 'PEER_SIGNAL';       // relay ICE/SDP to another peer
export const MSG_PEER_CACHE_HAVE = 'PEER_CACHE_HAVE'; // announce cached event IDs
export const MSG_PEER_STATS = 'PEER_STATS';         // report sharing statistics

// Nexus -> Client
export const MSG_PEER_REGISTERED = 'PEER_REGISTERED';
export const MSG_PEER_HEARTBEAT_ACK = 'PEER_HEARTBEAT_ACK';
export const MSG_PEER_ERROR = 'PEER_ERROR';
export const MSG_PEER_OFFER = 'PEER_OFFER';         // offer peers that have requested events
export const MSG_PEER_SIGNAL_RELAY = 'PEER_SIGNAL';  // relayed ICE/SDP from another peer
export const MSG_PEER_PROMOTED = 'PEER_PROMOTED';   // promoted to Super Peer
export const MSG_PEER_DEMOTED = 'PEER_DEMOTED';     // demoted to Casual
export const MSG_PEER_STATS_OK = 'PEER_STATS_OK';   // stats received
export const MSG_PEER_EVENT_NEW = 'PEER_EVENT_NEW'; // new event to cache (broadcast)
