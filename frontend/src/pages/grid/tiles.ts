// An empty url means no basemap is configured.
export type TileLayerConfig = { url: string; attribution: string };

export const tileLayerConfig = (config: { mapTileUrl: string; mapTileAttribution: string }): TileLayerConfig => ({
  url: config.mapTileUrl,
  attribution: config.mapTileAttribution,
});
