declare module 'heic-decode' {
  interface HeicDecodeResult {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  interface HeicDecodeOptions {
    buffer: Buffer | Uint8Array | ArrayBuffer;
  }
  function heicDecode(options: HeicDecodeOptions): Promise<HeicDecodeResult>;
  export = heicDecode;
}
