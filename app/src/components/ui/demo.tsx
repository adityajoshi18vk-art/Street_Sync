import { HeroSection03 } from "@/components/ui/hero-03";

export default function DemoOne() {
  return (
    <HeroSection03
      title="Demo Hero Section"
      rows={[
        { content: "Digital" },
        { content: "Products" },
        { content: "Design & Code" }
      ]}
    />
  );
}
