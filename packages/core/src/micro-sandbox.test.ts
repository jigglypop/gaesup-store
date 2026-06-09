import { describe, expect, it } from 'vitest';
import {
  FrontendSandboxGrid,
  SandboxRuntimeError,
  assertAllowedWasmImports,
  resolveSandboxCoordinate,
  sandboxCoordinateKey,
  sha256Hex,
  verifyArtifactHash
} from './micro-sandbox';

const WASM_ANSWER = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x0a, 0x01, 0x06, 0x61, 0x6e, 0x73, 0x77, 0x65, 0x72, 0x00, 0x00,
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b
]);

const WASM_WITH_IMPORT = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x02, 0x0e, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x06, 0x73, 0x65, 0x63, 0x72, 0x65, 0x74, 0x00, 0x00
]);

describe('micro sandbox runtime primitives', () => {
  it('tracks frontend containers by route, region, and layer', () => {
    const coordinate = resolveSandboxCoordinate({
      manifestVersion: '1.0',
      name: '@shop/body',
      version: '1.0.0',
      runtime: 'wasm-worker',
      deployment: { slot: 'body', releaseId: 'web-1' },
      sandbox: {
        coordinate: {
          route: '/shop',
          region: 'main',
          layer: 'state'
        }
      }
    });

    const grid = new FrontendSandboxGrid<string>();
    const key = grid.upsert(coordinate, 'body-container');

    expect(key).toBe('/shop::main::state');
    expect(sandboxCoordinateKey(coordinate)).toBe(key);
    expect(grid.get(coordinate)).toBe('body-container');
    expect(grid.list({ route: '/shop', layer: 'state' })).toHaveLength(1);
  });

  it('requires signed artifacts by default', async () => {
    await expect(verifyArtifactHash(WASM_ANSWER)).rejects.toMatchObject({
      code: 'ARTIFACT_HASH_REQUIRED'
    });
  });

  it('verifies artifact sha256 values', async () => {
    const hash = await sha256Hex(WASM_ANSWER);

    await expect(verifyArtifactHash(WASM_ANSWER, `sha256:${hash}`)).resolves.toBe(hash);
    await expect(verifyArtifactHash(WASM_ANSWER, `sha256:${'0'.repeat(64)}`)).rejects.toMatchObject({
      code: 'ARTIFACT_HASH_MISMATCH'
    });
  });

  it('fails closed when a WASM import is not allowlisted', async () => {
    const module = await WebAssembly.compile(WASM_WITH_IMPORT);
    const imports = WebAssembly.Module.imports(module);

    expect(() => assertAllowedWasmImports(imports, [])).toThrow(SandboxRuntimeError);
    expect(() => assertAllowedWasmImports(imports, ['env.secret'])).not.toThrow();
    expect(() => assertAllowedWasmImports(imports, ['env/secret'])).not.toThrow();
  });
});
