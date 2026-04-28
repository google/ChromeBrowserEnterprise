/**
 * @file Server-side user search combobox with debounced typeahead.
 *
 * Pre-fetches a recent-activity map on mount and uses it to:
 * - show users with activity even before the directory search returns
 * - show a dot + event count on users with recent Chrome events
 * - rank active users above inactive ones in search results
 *
 * Data fetching is driven by SWR (`useSWR`), which handles request
 * deduping, focus revalidation, retry, and a localStorage cache via the
 * provider in `swr-provider.tsx`. The 300 ms typeahead debounce lives
 * in this component so SWR isn't asked to fetch a new key on every
 * keystroke.
 */

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import { Search, Loader2, UserX, Check, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { isAuthErrorPayload, type AuthErrorPayload } from "@/lib/auth-errors";
import { USER_SEARCH_INPUT_ID } from "@/lib/constants";
import type { DirectoryUser } from "@/app/api/users/route";
import type { UserActivity } from "@/app/api/users/activity/route";

type UserSelectorProps = {
  selectedUser: string;
  onUserChange: (email: string) => void;
  /** Owned by the dashboard — passed down to avoid a second fetch. */
  activity: Record<string, UserActivity>;
};

/**
 * Response shape from `GET /api/users`.
 */
type UsersResponse = { users?: unknown };

/**
 * SWR errors throw plain `Error`. The default fetcher attaches the
 * AuthErrorPayload (when present) so this component can show the
 * structured remedy in its dropdown without re-fetching.
 */
type SwrError = Error & { authPayload?: AuthErrorPayload };

export function UserSelector({ selectedUser, onUserChange, activity }: UserSelectorProps) {
  const [query, setQuery] = useState(selectedUser);
  const [debouncedQuery, setDebouncedQuery] = useState(selectedUser);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  /**
   * Local-first search shortcut: very short prefixes (≤ 2 chars) hit
   * thousands of users in any real org. Filtering the cached activity
   * map locally returns instant results for the most common keystrokes
   * — no debounce wait, no Directory API call, no server round-trip.
   * Once the prefix grows past 2 chars we hand off to the server
   * (Directory's substring matching beats local-only filtering).
   */
  const useLocalSearch = debouncedQuery.length > 0 && debouncedQuery.length <= 2;
  const { data, error, isLoading, mutate } = useSWR<UsersResponse, SwrError>(
    useLocalSearch ? null : `/api/users?q=${encodeURIComponent(debouncedQuery)}`,
    { keepPreviousData: true },
  );

  const users = useLocalSearch
    ? localFilterFromActivity(activity, debouncedQuery)
    : extractUserList(data);
  const authPayload =
    error?.authPayload && isAuthErrorPayload(error.authPayload) ? error.authPayload : null;

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setIsOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  const selectUser = (email: string) => {
    onUserChange(email);
    setQuery(email);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (rankedUsers.length > 0) {
        selectUser(rankedUsers[0].email);
      } else if (query.includes("@")) {
        selectUser(query);
      }
    }
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const handleBlur = () => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    blurTimeoutRef.current = setTimeout(() => setIsOpen(false), 200);
  };

  /**
   * Rank so users with recent activity float to the top (more events
   * first), then directory order for everything else. When the query is
   * empty and directory results don't cover all active users, synthesize
   * minimal entries for the active-but-unseen users so admins can still
   * pick them from the initial dropdown.
   *
   * React Compiler memoizes this for us; manual `useMemo` here trips
   * the `react-hooks/preserve-manual-memoization` rule because the
   * compiler can't statically verify the deps cover the closure.
   */
  const rankedUsers: DirectoryUser[] = (() => {
    const byEmail = new Map<string, DirectoryUser>();
    for (const u of users) byEmail.set(u.email.toLowerCase(), u);

    if (!query) {
      for (const email of Object.keys(activity)) {
        if (!byEmail.has(email)) {
          byEmail.set(email, { email, name: "", suspended: false });
        }
      }
    }

    return Array.from(byEmail.values()).sort((a, b) => {
      const aCount = activity[a.email.toLowerCase()]?.eventCount ?? 0;
      const bCount = activity[b.email.toLowerCase()]?.eventCount ?? 0;
      if (aCount !== bCount) return bCount - aCount;
      return a.email.localeCompare(b.email);
    });
  })();

  const isCredentialError = authPayload !== null;
  const showLoading = isLoading && users.length === 0;
  const showError = !!error && !isLoading;
  const isEmptyResults = !isLoading && !error && users.length === 0 && rankedUsers.length === 0;

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={USER_SEARCH_INPUT_ID} className="text-on-surface text-sm font-medium">
        Investigate user
      </label>

      <div className="relative">
        <div className="text-on-surface-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
          {isLoading ? <Loader2 className="spin-slow size-3.5" /> : <Search className="size-3.5" />}
        </div>

        <input
          ref={inputRef}
          id={USER_SEARCH_INPUT_ID}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls="user-listbox"
          /*
           * Suppress browser + password-manager autofill: Chrome ignores
           * autoComplete="off" when it heuristically classifies a field
           * as an email (which `name="selectedUser"` was triggering).
           * Using a random autoComplete value + data-*-ignore attributes
           * covers Chrome, Safari, 1Password, LastPass, and Bitwarden.
           */
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Search by email or name…"
          className="bg-surface text-on-surface placeholder:text-on-surface-muted focus:ring-primary ring-on-surface/10 w-full rounded-[var(--radius-xs)] py-2 pr-3 pl-8 text-sm ring-1 focus:ring-2 focus:outline-none"
        />

        {isOpen && (
          <div className="bg-surface ring-on-surface/10 absolute top-full left-0 z-20 mt-1 w-full overflow-hidden rounded-[var(--radius-sm)] shadow-[var(--shadow-elevation-2)] ring-1">
            {showLoading && <LoadingSkeleton />}

            {showError && (
              <div className="px-3 py-3">
                <p className="text-error text-sm font-medium">
                  {isCredentialError ? "Credential Error" : "Search Failed"}
                </p>
                <p className="text-error/80 mt-1 text-sm text-pretty">
                  {authPayload?.remedy ?? error?.message}
                </p>
                {authPayload?.command && (
                  <code className="bg-surface-container text-on-surface-variant mt-1.5 block rounded-[var(--radius-xs)] px-2 py-1 font-mono text-[0.6875rem]">
                    {authPayload.command}
                  </code>
                )}
                <button
                  type="button"
                  onMouseDown={() => mutate()}
                  className="state-layer text-primary mt-2 rounded-[var(--radius-xs)] px-2 py-1 text-xs font-medium"
                >
                  Retry
                </button>
              </div>
            )}

            {isEmptyResults && (
              <div className="flex flex-col items-center gap-1.5 px-3 py-4 text-center">
                <UserX className="text-on-surface-muted size-5" aria-hidden="true" />
                <p className="text-on-surface-muted text-sm text-pretty">
                  {query ? `No users matching "${query}"` : "No users found in this org"}
                </p>
              </div>
            )}

            {rankedUsers.length > 0 && (
              <ul id="user-listbox" role="listbox" className="max-h-60 overflow-y-auto py-1">
                {rankedUsers.map((user) => {
                  const act = activity[user.email.toLowerCase()];
                  return (
                    <li
                      key={user.email}
                      role="option"
                      aria-selected={user.email === selectedUser}
                      onMouseDown={() => selectUser(user.email)}
                      className={cn(
                        "state-layer flex cursor-pointer items-center gap-2 px-3 py-1.5",
                        user.email === selectedUser && "bg-primary-light",
                      )}
                    >
                      {user.email === selectedUser ? (
                        <Check className="text-primary size-3.5 shrink-0" aria-hidden="true" />
                      ) : act ? (
                        <span
                          className="bg-primary size-1.5 shrink-0 rounded-full"
                          aria-label="Has recent activity"
                        />
                      ) : (
                        <span className="size-1.5 shrink-0" aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{user.email}</p>
                        {user.name && user.name !== user.email && (
                          <p className="text-on-surface-muted truncate text-xs">{user.name}</p>
                        )}
                      </div>
                      {act && (
                        <span
                          className="text-primary flex shrink-0 items-center gap-1 text-xs tabular-nums"
                          title={`${act.eventCount} recent event${act.eventCount === 1 ? "" : "s"}`}
                        >
                          <Activity className="size-3" aria-hidden="true" />
                          {act.eventCount}
                        </span>
                      )}
                      {user.suspended && (
                        <span className="text-on-surface-muted text-xs">Suspended</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Narrows the `/api/users` response into a `DirectoryUser[]`. The payload
 * crosses a JSON boundary, so we check the outer shape and each entry's
 * required `email` + `name` fields rather than casting blind.
 */
function extractUserList(body: unknown): DirectoryUser[] {
  if (!body || typeof body !== "object" || !("users" in body) || !Array.isArray(body.users)) {
    return [];
  }
  return body.users.filter(
    (u): u is DirectoryUser =>
      !!u && typeof u === "object" && typeof u.email === "string" && typeof u.name === "string",
  );
}

/**
 * Builds a `DirectoryUser[]` from the activity map for short-prefix
 * local search. Returns up to 20 entries whose lowercase email starts
 * with the prefix. We don't have name data here — that's fine because
 * the prefix is short enough that the email match is the signal.
 */
function localFilterFromActivity(
  activity: Record<string, UserActivity>,
  prefix: string,
): DirectoryUser[] {
  const lower = prefix.toLowerCase();
  const matches: DirectoryUser[] = [];
  for (const email of Object.keys(activity)) {
    if (!email.startsWith(lower)) continue;
    matches.push({ email, name: "", suspended: false });
    if (matches.length >= 20) break;
  }
  return matches;
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-5/6" />
      <Skeleton className="h-6 w-4/6" />
      <Skeleton className="h-6 w-3/6" />
    </div>
  );
}
