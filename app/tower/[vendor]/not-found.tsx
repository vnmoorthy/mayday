import { ButtonLink } from "@/components/ui";

export default function TowerNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col items-start gap-6 px-5 py-16 sm:px-8 sm:py-24">
      <span className="label">404 — No tower</span>
      <h1 className="max-w-3xl text-5xl font-extrabold! text-ink sm:text-7xl">This airspace is not on the radar</h1>
      <p className="max-w-xl text-base text-mute">
        No agent has sent a stop signal for this vendor yet. An airspace appears the first time an agent goes down on the product.
      </p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/tower">Browse the airspaces</ButtonLink>
        <ButtonLink href="/flights" variant="ghost">
          Launch a test flight
        </ButtonLink>
      </div>
    </div>
  );
}
