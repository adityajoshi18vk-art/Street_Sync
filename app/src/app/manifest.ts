import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StreetSync",
    short_name: "StreetSync",
    description:
      "Community-funded civic repair bounties with World ID verification and tamper-proof evidence on Arc Testnet.",
    start_url: "/",
    display: "standalone",
    background_color: "#f9fafb",
    theme_color: "#1b6bf5",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      }
    ]
  };
}
