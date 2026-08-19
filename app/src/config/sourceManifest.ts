export interface VerifiedSourceAsset {
  path: string;
  bytes: number;
  sha256: string;
}

export interface SourceManifest {
  sourceRoot: string;
  sourceBundle: VerifiedSourceAsset;
  verifiedAssetCount: number;
  assets: Record<string, VerifiedSourceAsset>;
}

/**
 * Read-only provenance for this local study build. The internal source mirror
 * is never imported at runtime; these hashes make accidental substitutions
 * visible during review.
 */
export const SOURCE_MANIFEST: SourceManifest = {
  sourceRoot: verifiedAssets.sourceRoot,
  sourceBundle: {
    path: "study/app.beautified.js",
    bytes: 8_440_760,
    sha256: "DD81256BE689287B0CBA43463DBD702C2746162C7B2EAA4EF5743253B6D209C5",
  },
  verifiedAssetCount: verifiedAssets.verifiedAssetCount,
  assets: Object.fromEntries(verifiedAssets.assets.map((asset) => [asset.path, asset])),
};
import verifiedAssets from "./source-assets.manifest.json";
