import net from "node:net";
export type TCP_STATE =
  | "HANDSHAKING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "CONNECTING"
  | "READY";

export type TCP_EVENT =
  | { type: "TCP_CONNECTED" }
  | { type: "HANDSHAKE_SENT" }
  | { type: "HANDSHAKE_RECEIVED"; peerId: Uint8Array }
  | { type: "TCP_DISCONNECTED" }
  | { type: "SOCKET_ERROR"; error: Error }
  | { type: "SOCKET_CLOSED" };

export function transitionTCP(state: TCP_STATE, event: TCP_EVENT): TCP_STATE {
  switch (event.type) {
    case "TCP_CONNECTED": {
      if (state === "CONNECTING") return "CONNECTED";
      return state;
    }
    case "HANDSHAKE_RECEIVED": {
      if (state === "HANDSHAKING") {
        //run handshake validator;
        return "READY";
      }
      return state;
    }
    case "HANDSHAKE_SENT": {
      if (state === "CONNECTED") return "HANDSHAKING";
      return state;
    }
    case "SOCKET_CLOSED": {
      return "DISCONNECTED";
    }
    case "SOCKET_ERROR": {
      return "DISCONNECTED";
    }
    case "TCP_DISCONNECTED": {
      return "DISCONNECTED";
    }

    default:
      throw new Error("invalid TCP_EVENT");
  }
}

export type TCP_CONNECTION = {
  state: TCP_STATE;
  socket: net.Socket;
};

export function dispatch(connection: TCP_CONNECTION, event: TCP_EVENT) {
  connection.state = transitionTCP(connection.state, event);
}
