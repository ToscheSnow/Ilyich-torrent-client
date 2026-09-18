import net from "node:net";

const server = net.createServer((socket) => {
  console.log("🐇 Client connected!");

  socket.on("data", (data) => {
    console.log("📦 Received:", data);
    console.log("hex:", data.toString("hex"));
    console.log("text:", data.toString());
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
