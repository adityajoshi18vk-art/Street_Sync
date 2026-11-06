import { Camera, HandCoins, ScanFace, Vote } from "lucide-react";

const STEPS = [
  { icon: HandCoins, title: "Fund", body: "Drop a pin and lock USDC in escrow. Neighbors can pledge on top." },
  { icon: ScanFace, title: "Claim", body: "A World ID–verified worker claims it and gets a one-time challenge code." },
  { icon: Camera, title: "Prove", body: "Before/after photos with GPS and the code, compressed and stored on Arkiv." },
  { icon: Vote, title: "Settle", body: "Three verified reviewers commit-reveal their votes. Majority releases the USDC." }
];

export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <h2 id="how-it-works" className="heading text-xl">How it works</h2>
        <p className="text-xs text-zinc-500">Every step is a transaction you can audit.</p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="card card-hover relative p-5">
            <span className="absolute right-5 top-5 font-display text-3xl font-extrabold text-white/[0.06]">
              0{i + 1}
            </span>
            <span className="icon-tile">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <p className="heading mt-4 text-base">{title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
