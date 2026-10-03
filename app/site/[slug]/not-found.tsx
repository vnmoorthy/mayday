import { ButtonLink } from "@/components/ui";

export default function SiteNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col items-start gap-6 px-5 py-16 sm:px-8 sm:py-24">
      <span className="label">404 — Uncharted</span>
      <h1 className="max-w-3xl text-5xl font-extrabold! text-ink sm:text-7xl">No crash site at this position</h1>
      <p className="max-w-xl text-base text-mute">
        No agent has reported going down here. The link may be wrong, or the crash site has not been charted yet.
      </p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/">Back to the radar</ButtonLink>
        <ButtonLink href="/tower" variant="ghost">
          Browse the airspaces
        </ButtonLink>
      </div>
    </div>
  );
}
