"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, type Workspace } from "./api";
import { Wordmark, Loading, Notice, Field } from "./primitives";
import {SocialCallbackResult} from "./connections";
import {PostformeReturn} from "./postforme-return";
import { BusinessApp } from "./businesses";
import {useHistoryEditGuard} from "./unsaved";
import { AuthScreen } from "./auth";
import { WorkspaceHome, BrandHome } from "./workspaces";
import { TeamScreen } from "./team";
export function Desvio() {
  useHistoryEditGuard();
  const pathname = usePathname();
  const mode = pathname.split("/")[1];
  if(pathname==="/connections/postforme/return")return <PostformeReturn/>;
  if(pathname==="/integrations/social/result")return <SocialCallbackResult/>;
  if (
    [
      "sign-in",
      "sign-up",
      "forgot-password",
      "reset-password",
      "verify-email",
    ].includes(mode)
  )
    return <AuthScreen key={mode} mode={mode} />;
  if(pathname.startsWith("/clients"))return <LegacyBusinessLink pathname={pathname}/>;
  if(pathname==="/accept-invitation")return <Session key={pathname} pathname={pathname} />;
  return <BusinessApp pathname={pathname} />;
}
function Session({ pathname }: { pathname: string }) {
  const router = useRouter(),
    [session, setSession] = useState<any>(),
    [workspaces, setWorkspaces] = useState<Workspace[]>(),
    [error, setError] = useState<unknown>(),
    [signoutError, setSignoutError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const value = await api("/api/auth/get-session");
        if (!active) return;
        if (!value?.user?.emailVerified) {
          const invitation =
            pathname === "/accept-invitation"
              ? new URLSearchParams(location.hash.slice(1)).get("token")
              : null;
          router.replace(
            "/sign-in" +
              (invitation ? "#invite=" + encodeURIComponent(invitation) : ""),
          );
          return;
        }
        const list = await api("/api/v1/workspaces");
        if (active) {
          setSession(value);
          setWorkspaces(list.workspaces);
        }
      } catch (e) {
        if (active) setError(e);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);
  if (error)
    return (
      <main id="main" className="standalone">
        <Wordmark />
        <h1>We couldn’t open your workspace.</h1>
        <Notice error={error} />
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  if (!session || !workspaces)
    return (
      <main id="main" className="standalone">
        <Wordmark />
        <Loading />
      </main>
    );
  if (pathname === "/accept-invitation") return <AcceptInvitation />;
  const parts = pathname.split("/").filter(Boolean),
    org =
      parts[0] === "clients"
        ? workspaces.find((w) => w.id === parts[1])
        : undefined,
    brand = parts[2] === "brands" ? parts[3] : undefined,
    team = parts[2] === "team";
  if (parts.length && (!org || (!team && parts[2] && parts[2] !== "brands")))
    return (
      <main id="main" className="standalone">
        <Wordmark />
        <h1>Workspace unavailable</h1>
        <p>This link may have changed, or you may no longer have access.</p>
        <a href="/">Back to your clients</a>
      </main>
    );
  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <Wordmark />
        <div className="sidebar-context">
          <span className="eyebrow">CLIENT WORKSPACE</span>
          <Field label="Switch client">
            {(id) => (
              <select
                id={id}
                value={org?.id ?? ""}
                onChange={(e) =>
                  location.assign(
                    e.target.value ? `/clients/${e.target.value}` : "/",
                  )
                }
              >
                <option value="">All clients</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <nav aria-label="Workspace">
          <a href="/" aria-current={!org ? "page" : undefined}>
            <span aria-hidden="true">▦</span>All clients
          </a>
          {org && (
            <>
              <a
                href={`/clients/${org.id}`}
                aria-current={!team ? "page" : undefined}
              >
                <span aria-hidden="true">◇</span>Brands & references
              </a>
              <a
                href={`/clients/${org.id}/team`}
                aria-current={team ? "page" : undefined}
              >
                <span aria-hidden="true">♧</span>Team
              </a>
            </>
          )}
        </nav>
        <Notice error={signoutError} />
        <div className="sidebar-bottom">
          <span className="avatar" aria-hidden="true">
            {session.user.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{session.user.name}</strong>
            <span>{org ? org.role : "Your account"}</span>
          </div>
          <button
            className="quiet"
            onClick={async () => {
              try {
                await api("/api/auth/sign-out", {});
                router.replace("/sign-in");
              } catch (e) {
                setSignoutError(e);
              }
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <span>{org?.name ?? "Your workspace"}</span>
          <span className="edition">Desvio · Early access</span>
        </header>
        <main id="main">
          {team && org ? (
            <TeamScreen org={org} userId={session.user.id} />
          ) : brand && org ? (
            <BrandHome org={org} brandId={brand} />
          ) : (
            <WorkspaceHome org={org} workspaces={workspaces} />
          )}
        </main>
        <footer className="app-footer">Your brand starts here.</footer>
      </div>
    </div>
  );
}
function AcceptInvitation() {
  const router = useRouter(),
    [token, setToken] = useState(""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setToken(new URLSearchParams(location.hash.slice(1)).get("token") ?? "");
    history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <main id="main" className="standalone">
      <Wordmark />
      <span className="eyebrow">CLIENT INVITATION</span>
      <h1>Join your team’s workspace.</h1>
      <p>
        Your signed-in email must match the invitation. Accepting gives you
        access to the client and role in that email.
      </p>
      <Notice error={error} />
      <button
        className="primary"
        disabled={!token || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/api/v1/invitations/accept", { token });
            setToken("");
            router.replace("/");
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Joining…" : "Accept invitation"}
      </button>
      {!token && <p>Reopen the invitation from your email to continue.</p>}
      <p>
        <a href="/">Back to your clients</a>
      </p>
    </main>
  );
}

function LegacyBusinessLink({pathname}:{pathname:string}){const router=useRouter();useEffect(()=>{const parts=pathname.split('/');router.replace(parts[3]==='brands'&&parts[4]?`/b/${parts[4]}/onboarding`:'/brands');},[pathname,router]);return <main id="main" className="standalone"><Loading/></main>;}
