import net from "node:net";

const SERVER_ID = Buffer.from(
  "61206C6F766520736E6F7762756E6E6965732121",
  "hex",
);

let receiveBuff = Buffer.alloc(0);

const server = net.createServer((socket) => {
  console.log("🐇 Client connected!");

  socket.on("data", (data) => {
    console.log("📦 Received:", data);
    console.log("text:", data.toString());

    receiveBuff = Buffer.concat([receiveBuff, data]);

    if (receiveBuff.length >= 68) {
      const response = Buffer.from(receiveBuff.subarray(0, 68));
      response.set(SERVER_ID, 48);
      socket.write(response);
      receiveBuff = Buffer.from(receiveBuff.subarray(68));
    }
  });

  socket.on("close", () => {
    console.log("❌ Client disconnected");
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err);
  });
});

server.listen(6881, "127.0.0.1", () => {
  console.log("🚀 Listening on 127.0.0.1:6881");
});
