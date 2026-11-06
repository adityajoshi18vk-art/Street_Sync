import { MapPinned } from "@aliimam/icons";
import { Github } from "@aliimam/logos";

import { HomeClient } from "@/components/home/HomeClient";

// Server Component: @aliimam/* are single multi-megabyte modules that can't be tree-shaken,
// so their glyphs are rendered here and only the SVG markup reaches the client.
export default function HomePage() {
  return (
    <HomeClient
      glyphs={{
        pin: <MapPinned className="mx-[0.02em] h-[0.8em] w-[0.8em] text-primary" strokeWidth={1} aria-hidden />,
        github: <Github className="h-5 w-5" aria-hidden />
      }}
    />
  );
}
