"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import "./settings-layout.css";
import { api, type Workspace } from "./api";
import { Field, Loading, Notice } from "./primitives";
type Member = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
};
export function TeamScreen({
  org,
  userId,
}: {
  org: Workspace;
  userId: string;
}) {
  const [members, setMembers] = useState<Member[]>(),
    [invites, setInvites] = useState<any[]>([]),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("editor"),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [editing, setEditing] = useState<string>(),
    [targetRole, setTargetRole] = useState(""),
    [confirm, setConfirm] = useState(false);
  const request = useRef({ body: "", key: "" }),
    admin = ["owner", "admin"].includes(org.role),
    path = `/api/v1/workspaces/${org.id}`;
  async function load() {
    try {
      const result = await api(path + "/members");
      setMembers(result.members);
      if (admin) setInvites((await api(path + "/invitations")).invitations);
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => {
    void load();
  }, [path]);
  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSent(false);
    setError(undefined);
    const body = JSON.stringify({ email, role });
    if (request.current.body !== body)
      request.current = { body, key: crypto.randomUUID() };
    try {
      await api(
        path + "/invitations",
        { email, role },
        "POST",
        request.current.key,
      );
      setSent(true);
      setEmail("");
      request.current = { body: "", key: "" };
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function change(member: Member, active: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await api(
        `${path}/members/${member.user_id}`,
        { role: targetRole, active },
        "PATCH",
      );
      setEditing(undefined);
      setConfirm(false);
      if (member.user_id === userId) {
        location.assign("/");
        return;
      }
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page settings-page account-team-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{org.name} / TEAM</span>
          <h1>Good work, together.</h1>
          <p className="intro">
            Give the right people access to this client’s brands and files.
          </p>
        </div>
        <span className="status neutral">{org.role} access</span>
      </div>
      <Notice error={error} />
      {admin && (
        <section className="editor-panel">
          <h2>Invite a teammate</h2>
          <form className="invite-form" onSubmit={invite} aria-busy={busy}>
            <Field label="Teammate’s email">
              {(id) => (
                <input
                  id={id}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Workspace role">
              {(id) => (
                <select
                  id={id}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="editor">Editor — brands & files</option>
                  <option value="viewer">Viewer — read & download</option>
                  {org.role === "owner" && (
                    <option value="admin">Admin — brands & team</option>
                  )}
                </select>
              )}
            </Field>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Send invitation"}
            </button>
          </form>
          <p className="hint">
            Invitations expire after 7 days. Only the invited email can accept.
          </p>
          {sent && (
            <p role="status" className="success-text">
              Invitation saved and email queued. Delivery status appears below.
            </p>
          )}
        </section>
      )}
      <section>
        <div className="section-heading">
          <h2>People with access</h2>
          <button onClick={() => void load()}>Refresh team</button>
        </div>
        {!members ? (
          <Loading />
        ) : (
          <ul className="member-list">
            {members.map((member) => (
              <li key={member.user_id}>
                <div className="member-row">
                  <span className="avatar" aria-hidden="true">
                    {member.name.slice(0, 1)}
                  </span>
                  <div className="member-info">
                    <strong>
                      {member.name}
                      {member.user_id === userId ? " (you)" : ""}
                    </strong>
                    <span>{member.email}</span>
                  </div>
                  <span className="status neutral">
                    {member.active ? member.role : "Removed"}
                  </span>
                  {member.active &&
                    (org.role === "owner" ||
                      (org.role === "admin" &&
                        ["editor", "viewer"].includes(member.role))) && (
                      <button
                        onClick={() => {
                          setEditing(member.user_id);
                          setTargetRole(member.role);
                          setConfirm(false);
                        }}
                      >
                        Manage <span className="sr-only">{member.name}</span>
                      </button>
                    )}
                </div>
                {editing === member.user_id && (
                  <div className="member-edit">
                    <Field label={`Role for ${member.name}`}>
                      {(id) => (
                        <select
                          id={id}
                          value={targetRole}
                          onChange={(e) => setTargetRole(e.target.value)}
                        >
                          {(org.role === "owner"
                            ? ["owner", "admin", "editor", "viewer"]
                            : ["editor", "viewer"]
                          ).map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <div className="actions">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void change(member, true)}
                      >
                        Save role
                      </button>
                      <button disabled={busy} onClick={() => setConfirm(true)}>
                        Remove access
                      </button>
                      <button
                        className="quiet"
                        onClick={() => {
                          setEditing(undefined);
                          setConfirm(false);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    {confirm && (
                      <div className="notice">
                        <p>
                          Remove {member.name} from {org.name}? They will lose
                          access to all this client’s brands.
                        </p>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => void change(member, false)}
                        >
                          Confirm removal
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {admin && (
        <section className="invitations">
          <h2>Invitations</h2>
          {invites.length ? (
            <ul className="member-list">
              {invites.map((invite) => (
                <li key={invite.id} className="member-row">
                  <div className="member-info">
                    <strong>{invite.email}</strong>
                    <span>
                      {invite.role} · {invite.status} · Email:{" "}
                      {(
                        {
                          pending: "queued",
                          processing: "sending",
                          retry: "waiting to retry",
                          accepted: "accepted by mail server",
                          unknown: "delivery uncertain",
                          failed: "failed",
                          expired: "expired",
                          canceled: "canceled",
                        } as Record<string, string>
                      )[invite.email_status] ?? "status unavailable"}
                    </span>
                  </div>
                  {invite.status === "pending" && (
                    <button
                      onClick={async () => {
                        setError(undefined);
                        try {
                          await api(
                            `${path}/invitations/${invite.id}/revoke`,
                            {},
                          );
                          await load();
                        } catch (e) {
                          setError(e);
                        }
                      }}
                    >
                      Revoke
                      <span className="sr-only">
                        {" "}
                        invitation to {invite.email}
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No invitations yet.</p>
          )}
        </section>
      )}
    </div>
  );
}
