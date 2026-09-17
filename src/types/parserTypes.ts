export type BencodeVal =
  | number
  | string
  | BencodeVal[]
  | BencodeDict
  | Uint8Array;
export type BencodeDict = {
  [key: string]: BencodeVal;
};
