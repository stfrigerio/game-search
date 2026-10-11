import { describe, expect, it } from "vitest";
import { steamMedia } from "../src/server/media.ts";

describe("steamMedia", () => {
  it("builds CDN URLs for trailers first, then screenshots in order", () => {
    const items = steamMedia({
      screenshots: {
        all_ages_screenshots: [
          { filename: "steam/apps/1/ss_b.jpg?t=2", ordinal: 2 },
          { filename: "steam/apps/1/ss_a.jpg?t=2", ordinal: 1 },
        ],
      },
      trailers: {
        highlights: [
          {
            trailer_name: "Launch Trailer",
            screenshot_medium: "9/movie.293x165.jpg?t=1",
            screenshot_full: "9/movie_full.jpg?t=1",
            microtrailer: [{ filename: "1/9/micro.mp4", type: "video/mp4" }],
            adaptive_trailers: [
              { cdn_path: "1/9/dash_h264.mpd", encoding: "dash_h264" },
              { cdn_path: "1/9/hls_264_master.m3u8", encoding: "hls_h264" },
            ],
          },
          { trailer_name: "No HLS", adaptive_trailers: [{ cdn_path: "x.mpd", encoding: "dash_av1" }] },
        ],
      },
    });
    expect(items).toEqual([
      {
        kind: "video",
        title: "Launch Trailer",
        thumb: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/9/movie.293x165.jpg?t=1",
        poster: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/9/movie_full.jpg?t=1",
        hls: "https://video.akamai.steamstatic.com/store_trailers/1/9/hls_264_master.m3u8",
        preview: "https://video.akamai.steamstatic.com/store_trailers/1/9/micro.mp4",
        youtube: null,
      },
      {
        kind: "image",
        thumb: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_a.600x338.jpg?t=2",
        full: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_a.1920x1080.jpg?t=2",
      },
      {
        kind: "image",
        thumb: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_b.600x338.jpg?t=2",
        full: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_b.1920x1080.jpg?t=2",
      },
    ]);
  });
});
