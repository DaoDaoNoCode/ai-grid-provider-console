// An empty url means no tile server is configured; the map draws its bundled land outline.
export type TileLayerConfig = { url: string; attribution: string };

export const tileLayerConfig = (config: { mapTileUrl: string; mapTileAttribution: string }): TileLayerConfig => ({
  url: config.mapTileUrl,
  attribution: config.mapTileAttribution,
});
