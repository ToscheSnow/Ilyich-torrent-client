export class DownloadStats {
  private downloadedBytes = 0;
  private completedPieces = 0;

  constructor(private peerCount: () => number) {}

  addDownloadedBytes(bytes: number) {
    this.downloadedBytes += bytes;
  }

  pieceCompleted() {
    this.completedPieces++;
  }

  getDownloadedBytes() {
    return this.downloadedBytes;
  }

  getCompletedPieces() {
    return this.completedPieces;
  }

  get peers(): number {
    return this.peerCount();
  }

  pieceIncrement = () => {
    this.completedPieces++;
  };

  async start() {
    while (true) {}
  }
}
