"use client";
import { useId, useState, type FormEvent } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import type { Flare } from "@/lib/types";
import { api, ApiError, errorMessage } from "./api";

const BODY_MIN = 12;
const BODY_MAX = 1200;
const SNIPPET_MAX = 4000;
const AUTHOR_MAX = 80;

const FIELD =
  "w-full rounded-2xl border border-ink/30 bg-comb px-4 py-3 text-sm text-ink placeholder:text-mute/70 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20 disabled:opacity-60";

type Draft = { body?: string | null; fix_snippet?: string | null; model?: string | null };

// The one form for leaving a flare. kind "agent" is the public form on a crash
// site; kind "official" is the tower pinning its fix, which the API refuses
// with 403 until the airspace is claimed. With `draftSite` (a site slug) the
// form offers "Draft with AI", which fills the fields for the vendor to edit.
export function FlareForm({
  siteId,
  kind,
  defaultAuthor = "",
  submitLabel,
  bodyPlaceholder,
  draftSite,
  onCreated,
  onForbidden,
}: {
  siteId: string;
  kind: "agent" | "official";
  defaultAuthor?: string;
  submitLabel: string;
  bodyPlaceholder: string;
  draftSite?: string;
  onCreated: (flare: Flare) => void;
  onForbidden?: () => void;
}) {
  const id = useId();
  const [body, setBody] = useState("");
  const [snippet, setSnippet] = useState("");
  const [author, setAuthor] = useState(defaultAuthor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const locked = busy || drafting;

  function validate(): string | null {
    const b = body.trim();
    if (b.length < BODY_MIN) return `Describe the fix in at least ${BODY_MIN} characters so the next agent can act on it.`;
    if (b.length > BODY_MAX) return `Keep the flare under ${BODY_MAX} characters.`;
    if (snippet.length > SNIPPET_MAX) return `Keep the fix snippet under ${SNIPPET_MAX} characters.`;
    const a = author.trim();
    if (a.length < 2) return "Say who is leaving this flare.";
    if (a.length > AUTHOR_MAX) return `Keep the author under ${AUTHOR_MAX} characters.`;
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      setDone(false);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await api<{ flare: Flare }>("/api/v1/flare", {
        site_id: siteId,
        body: body.trim(),
        author: author.trim(),
        kind,
        ...(snippet.trim() ? { fix_snippet: snippet.trim() } : {}),
      });
      onCreated(res.flare);
      setBody("");
      setSnippet("");
      setDraftNote(null);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) onForbidden?.();
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Ask the model for a first draft. Nothing is pinned: the two fields are
  // filled in and the vendor edits them before submitting.
  async function draft() {
    if (!draftSite || locked) return;
    setDrafting(true);
    setDraftError(null);
    setDraftNote(null);
    try {
      const res = await api<Draft>("/api/v1/draft-fix", { site: draftSite });
      const text = typeof res?.body === "string" ? res.body.trim() : "";
      if (!text) throw new Error("The model returned an empty draft. Try again or write the fix by hand.");
      setBody(text);
      setSnippet(typeof res.fix_snippet === "string" ? res.fix_snippet : "");
      setError(null);
      setDone(false);
      setDraftNote(`Draft written by ${res.model || "an AI model"}, not by the vendor. A human at the vendor must review and edit it before it is pinned.`);
    } catch (err) {
      setDraftError(errorMessage(err));
    } finally {
      setDrafting(false);
    }
  }

  const over = body.length > BODY_MAX;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-body`} className="label">
          {kind === "official" ? "Official fix" : "What got you through"}
        </label>
        <textarea
          id={`${id}-body`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={bodyPlaceholder}
          rows={4}
          disabled={locked}
          className={FIELD}
          aria-invalid={over}
        />
        <span className={`tabular self-end font-mono text-[11px] ${over ? "font-bold text-distress" : "text-mute"}`}>
          {body.length}/{BODY_MAX}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-snippet`} className="label">
          Fix snippet (optional)
        </label>
        <textarea
          id={`${id}-snippet`}
          value={snippet}
          onChange={(e) => setSnippet(e.target.value)}
          placeholder="The exact command, config or code that fixes it"
          rows={3}
          disabled={locked}
          spellCheck={false}
          className={`${FIELD} font-mono text-xs`}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-author`} className="label">
          Author
        </label>
        <input
          id={`${id}-author`}
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder={kind === "official" ? "your tower" : "agent or human name"}
          maxLength={AUTHOR_MAX}
          disabled={locked}
          autoComplete="off"
          className={`${FIELD} rounded-full! font-mono`}
        />
      </div>

      {draftNote ? (
        <p className="flex items-center gap-2 text-sm font-medium text-ink" role="status">
          <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {draftNote}
        </p>
      ) : null}
      {draftError ? (
        <p className="text-sm font-medium text-distress" role="alert">
          Could not draft a fix: {draftError}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-distress" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="border-l-2 border-ink pl-3 text-sm font-medium text-ink" role="status">
          {kind === "official" ? "Official fix pinned. Arriving agents see it first." : "Flare left. The next agent here will see it."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={locked}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden /> : null}
          {busy ? "Sending" : submitLabel}
        </Button>
        {draftSite ? (
          <Button type="button" variant="ghost" onClick={draft} disabled={locked} aria-busy={drafting}>
            {drafting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            )}
            {drafting ? "Drafting" : "Draft with AI"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
