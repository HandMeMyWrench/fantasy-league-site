import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Relegation Line",
    short_name: "Relegation Line",
    description:
      "The relegation league app — pick'em with real stakes, live standings, promotion and the drop. Home of Self Will Run Riot.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1226",
    theme_color: "#0b1226",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
