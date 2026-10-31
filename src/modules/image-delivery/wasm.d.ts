declare module "*.wasm?module" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "@jsquash/webp/codec/enc/webp_enc.js" {
  type Codec = {
    encode(
      data: Uint8Array,
      width: number,
      height: number,
      options: object,
    ): Uint8Array | null;
  };
  const factory: (options: {
    instantiateWasm(
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance) => void,
    ): WebAssembly.Exports;
  }) => Promise<Codec>;
  export default factory;
}
