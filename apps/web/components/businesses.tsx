"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { Wordmark, Loading, Notice, Field } from "./primitives";
import { BrandFiles } from "./uploads";
import { BrandIntake } from "./intake";
import {ContentWorkspace} from "./content-workspace";
import {PublishingScreen} from "./publishing";
import {BusinessOverviewPanel} from "./business-overview";
import {ConnectionsScreen} from "./connections";
import {CanvasScreen} from "./canvas";
import { useUnsavedChanges } from "./unsaved";
type Business = {
  id: string;
  organization_id: string;
  name: string;
  website: string | null;
  role: string;
  has_approved_brand: boolean;
  revision: number;
};
const sections = [
  ["overview", "Overview", "home"],
  ["brands", "Brands", "brand"],
  ["content-plan", "Content Plan", "calendar"],
  ["review", "Review Inbox", "check"],
  ["canvas", "Canvas", "star"],
  ["publishing", "Publishing & Analytics", "chart"],
  ["memory", "Memory", "memory"],
  ["connections", "Connections", "link"],
  ["team", "Team", "people"],
  ["billing", "Billing", "card"],
  ["profile", "Profile", "person"],
];
const groups: Record<string, string> = {
  overview: "Home",
  brands: "Marketing",
  memory: "Intelligence",
  connections: "Management",
  billing: "Account",
};
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
    brand: "M12 3 3 8v8l9 5 9-5V8Zm-9 5 9 5 9-5M12 13v8",
    calendar: "M4 5h16v16H4ZM8 2v6M16 2v6M4 11h16",
    check: "M4 4h16v16H4Zm4 8 3 3 6-7",
    star: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z",
    chart: "M4 20V4M4 20h17M7 15l5-5 4 2 5-7",
    memory: "m12 3 9 9-9 9-9-9Zm0 5 4 4-4 4-4-4Z",
    link: "M9 15l6-6M8 17l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 0M16 7l2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-6 0",
    people:
      "M7 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M1 21v-3a6 6 0 0 1 12 0v3M16 5a4 4 0 0 1 0 8M17 16a5 5 0 0 1 6 5",
    card: "M3 5h18v14H3ZM3 10h18M7 15h4",
    person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 22v-2a8 8 0 0 1 16 0v2",
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.brand} />
    </svg>
  );
}
const scopePath = (b: Business) =>
  `/api/v1/workspaces/${b.organization_id}/brands/${b.id}`;
export function BusinessApp({ pathname }: { pathname: string }) {
  const router = useRouter(),
    [session, setSession] = useState<any>(),
    [businesses, setBusinesses] = useState<Business[]>(),
    [entitlement, setEntitlement] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [signoutError, setSignoutError] = useState<unknown>(),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const user = await api("/api/auth/get-session");
        if (!active) return;
        if (!user?.user?.emailVerified) {
          router.replace("/sign-in");
          return;
        }
        await api("/api/v1/accounts/current/initialize", {});
        const [list, plan] = await Promise.all([
          api("/api/v1/businesses"),
          api("/api/v1/accounts/current/entitlements"),
        ]);
        if (active) {
          setSession(user);
          setBusinesses(list.businesses);
          setEntitlement(plan);
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
        <h1>We couldn’t open Desvio.</h1>
        <Notice error={error} />
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  if (!session || !businesses)
    return (
      <main id="main" className="standalone">
        <Wordmark />
        <Loading />
      </main>
    );
  const parts = pathname.split("/").filter(Boolean),
    business =
      parts[0] === "b" ? businesses.find((b) => b.id === parts[1]) : undefined,
    section =
      parts[0] === "b" ? (parts[2] ?? "overview") : (parts[0] ?? "overview"),
    isNew = pathname === "/brands/new",
    label =
      section === "onboarding"
        ? "Brand onboarding"
        : sections.find((s) => s[0] === section)?.[1];
  if ((parts[0] === "b" && !business) || !label)
    return (
      <main id="main" className="standalone">
        <Wordmark />
        <h1>Business unavailable</h1>
        <p>This link may have changed, or you may no longer have access.</p>
        <a href="/brands">Your businesses</a>
      </main>
    );
  const href = (key: string) =>
    ["brands", "billing", "profile"].includes(key)
      ? `/${key}`
      : business
        ? `/b/${business.id}/${key}`
        : `/${key}`;
  return (
    <div className={`v5-shell ${menu ? "menu-open" : ""}`}>
      <aside className="v5-sidebar">
        <Wordmark />
        <button
          className="v5-menu"
          aria-expanded={menu}
          aria-controls="business-nav"
          onClick={() => setMenu(!menu)}
        >
          Menu
        </button>
        <nav id="business-nav" aria-label="Main navigation">
          {sections.map(([key, title, icon]) => (
            <div key={key}>
              {groups[key] && <p className="nav-group">{groups[key]}</p>}
              <a
                href={href(key)}
                aria-current={
                  section === key ||
                  (section === "onboarding" && key === "brands")
                    ? "page"
                    : undefined
                }
              >
                <Icon name={icon} />
                <span>{title}</span>
              </a>
            </div>
          ))}
        </nav>
        <div className="v5-account">
          <span className="avatar" aria-hidden="true">
            {session.user.name.slice(0, 1)}
          </span>
          <div>
            <strong>{session.user.name}</strong>
            <a href="/profile">Your account</a>
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
        <Notice error={signoutError} />
      </aside>
      <div className="v5-body">
        <header className="v5-topbar">
          <Field label="Business">
            {(id) => (
              <select
                id={id}
                aria-label="Business"
                value={business?.id ?? ""}
                onChange={(e) =>
                  location.assign(
                    e.target.value
                      ? `/b/${e.target.value}/${["brands", "billing", "profile"].includes(section) ? "overview" : section}`
                      : "/overview",
                  )
                }
              >
                <option value="" disabled={section !== "overview"}>
                  {section === "overview"
                    ? "All businesses"
                    : "Select a business"}
                </option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="header-actions">
            <span className="build-label">Development preview</span>
            <a className="button" href={href("canvas")}>
              <Icon name="star" />
              Create
            </a>
            <a className="profile-link" href="/profile">
              Profile
            </a>
          </div>
        </header>
        <main id="main" className="v5-main">
          {section === "brands" ? (
            isNew ? (
              <NewBusiness entitlement={entitlement} />
            ) : (
              <BusinessesIndex
                businesses={businesses}
                entitlement={entitlement}
              />
            )
          ) : section === "overview" ? (
            <Overview
              businesses={businesses}
              business={business}
              name={session.user.name}
            />
          ) : section === "profile" ? (
            <Profile user={session.user} />
          ) : section === "billing" ? (
            <Billing entitlement={entitlement} />
          ) : !business ? (
            <ChooseBusiness
              businesses={businesses}
              section={section}
              title={label!}
            />
          ) : section === "onboarding" ? (
            <BrandOnboarding business={business} />
          ) : ["content-plan","review"].includes(section) ? (
            <ContentWorkspace key={`${business.id}:${section}`} business={business} inbox={section==="review"}/>
          ) : section === "canvas" ? (
            <CanvasScreen business={business}/>
          ) : section === "publishing" ? (
            <PublishingScreen key={business.id} business={business}/>
          ) : section === "connections" ? (
            <ConnectionsScreen key={business.id} business={business}/>
          ) : section === "memory" ? (
            <Memory business={business} />
          ) : (
            <Unavailable section={section} business={business} title={label!} />
          )}
        </main>
      </div>
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="v5-page-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {children}
    </div>
  );
}
function BusinessCard({
  business,
  index,
}: {
  business: Business;
  index: number;
}) {
  return (
    <article className="v5-business-card">
      <span className="business-monogram" data-tone={index % 3}>
        {business.name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .slice(0, 2)
          .toUpperCase()}
      </span>
      <h2>{business.name}</h2>
      <p>
        {business.website
          ? new URL(business.website).hostname
          : "Your business, in one place."}
      </p>
      <span className="status neutral">
        {business.has_approved_brand
          ? "Brand facts confirmed"
          : "Brand setup in progress"}
      </span>
      <a className="button card-open" href={`/b/${business.id}/onboarding`}>
        {business.has_approved_brand ? "Review brand" : "Continue setup"}{" "}
        <span aria-hidden="true">→</span>
      </a>
    </article>
  );
}
function BusinessesIndex({
  businesses,
  entitlement,
}: {
  businesses: Business[];
  entitlement: any;
}) {
  return (
    <>
      <div className="heading-row">
        <PageTitle eyebrow="Manage your businesses" title="Your brands">
          <p>
            Each business has its own identity, content, channels and memory.
          </p>
        </PageTitle>
        <a className="button primary" href="/brands/new">
          + Add business
        </a>
      </div>
      <p className="quota-caption">
        {entitlement.active_businesses} of {entitlement.max_active_businesses}{" "}
        owned businesses · {entitlement.plan} allowance
      </p>
      <div className="v5-business-grid">
        {businesses.map((b, i) => (
          <BusinessCard key={b.id} business={b} index={i} />
        ))}
        <article className="v5-add-card">
          <span className="add-symbol" aria-hidden="true">
            +
          </span>
          <h2>
            {businesses.length
              ? "A new business belongs here"
              : "Your first business starts here"}
          </h2>
          <p>
            {entitlement.can_create_business
              ? `${entitlement.max_active_businesses - entitlement.active_businesses} business slots remaining in your account.`
              : "You’ve used all your business slots. Your existing businesses remain available."}
          </p>
          <a
            className="button primary"
            href={entitlement.can_create_business ? "/brands/new" : "/billing"}
          >
            {entitlement.can_create_business
              ? "Add a business"
              : "View business allowance"}
          </a>
        </article>
      </div>
      <div className="v5-guidance">
        <h2>A little context. Better creative.</h2>
        <p>
          Tell us about your business, confirm the details that matter, then set
          your goals. You can return to your saved setup anytime.
        </p>
        <ol className="journey">
          <li>
            <span>1</span>Your business
          </li>
          <li>
            <span>2</span>Confirm your brand
          </li>
          <li>
            <span>3</span>Review goals & finish
          </li>
        </ol>
      </div>
    </>
  );
}
function NewBusiness({ entitlement }: { entitlement: any }) {
  const [name, setName] = useState(""),
    [website, setWebsite] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    key = useRef(""),
    bodyKey = useRef("");
  useUnsavedChanges(!!(name || website) && !busy);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const body = { name, website: website || null },
      serialized = JSON.stringify(body);
    if (serialized !== bodyKey.current) {
      bodyKey.current = serialized;
      key.current = crypto.randomUUID();
    }
    try {
      const b = await api("/api/v1/businesses", body, "POST", key.current);
      location.assign(`/b/${b.id}/onboarding`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="A home for your next idea"
        title="Let’s meet your business."
      >
        <p>Start with the basics. Your brand setup is saved as you go.</p>
      </PageTitle>
      <Steps step={1} />
      {!entitlement.can_create_business ? (
        <section className="v5-panel">
          <h2>Your account is at its business limit.</h2>
          <p>
            {entitlement.active_businesses} of{" "}
            {entitlement.max_active_businesses} slots are in use. Paid upgrades
            are not available in this build.
          </p>
          <a href="/brands">Back to your businesses</a>
        </section>
      ) : (
        <form
          className="v5-panel onboarding-form"
          onSubmit={save}
          aria-busy={busy}
        >
          <h2>Your business</h2>
          <Field label="Business name">
            {(id) => (
              <input
                id={id}
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Website (optional)"
            hint="We’ll read your public website to prepare your brand. No website? Add documents or facts in the next step."
          >
            {(id, hint) => (
              <input
                id={id}
                type="url"
                aria-describedby={hint}
                maxLength={2048}
                value={website}
                placeholder="https://yourbusiness.com"
                onChange={(e) => setWebsite(e.target.value)}
              />
            )}
          </Field>
          <Notice error={error} />
          <button className="primary" disabled={busy}>
            {busy ? "Saving your business…" : "Save & continue"}
          </button>
        </form>
      )}
    </>
  );
}
function Steps({ step }: { step: number }) {
  return (
    <ol className="onboarding-steps" aria-label="Brand onboarding">
      {["Your business", "Confirm your brand", "Review goals & finish"].map(
        (text, i) => (
          <li key={text} aria-current={step === i + 1 ? "step" : undefined}>
            <span>{i + 1}</span>
            {text}
          </li>
        ),
      )}
    </ol>
  );
}
function Overview({
  businesses,
  business,
  name,
}: {
  businesses: Business[];
  business?: Business;
  name: string;
}) {
  if(business)return <BusinessOverviewPanel key={business.id} business={business}/>;
  const rows = businesses;
  return (
    <>
      <PageTitle
        eyebrow="Your marketing, together"
        title={`Welcome, ${name.split(" ")[0]}.`}
      >
        <p>
          {rows.length
            ? "A clear place for every business you’re building."
            : "Your first brand is one step away."}
        </p>
      </PageTitle>
      <section className="v5-overview-hero">
        <div>
          <span className="eyebrow">Start with what makes you, you</span>
          <h2>
            Good marketing starts
            <br />
            with knowing your brand.
          </h2>
          <p>
            Bring in your business details and brand guidelines. Confirm the
            facts, set your direction, and keep every business’s work separate.
          </p>
          <a
            className="button primary"
            href="/brands"
          >
            {rows.length ? "Continue brand setup" : "Add your first business"}{" "}
            <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="brand-orbit" aria-hidden="true">
          <span className="orbit-center">
            d<span>·</span>
          </span>
          <span className="orbit-label orbit-one">Your voice</span>
          <span className="orbit-label orbit-two">Your story</span>
          <span className="orbit-label orbit-three">Your audience</span>
        </div>
      </section>
      {!!rows.length && (
        <>
          <div className="section-heading">
            <h2>Your businesses</h2>
            <a href="/brands">Manage brands →</a>
          </div>
          <div className="v5-business-grid">
            {rows.map((b, i) => (
              <BusinessCard key={b.id} business={b} index={i} />
            ))}
          </div>
        </>
      )}
      <p className="availability-note">
        Select a business to see its saved reviews, creative work and publishing activity.
      </p>
    </>
  );
}
function ChooseBusiness({
  businesses,
  section,
  title,
}: {
  businesses: Business[];
  section: string;
  title: string;
}) {
  return (
    <>
      <PageTitle eyebrow="Your business workspace" title={title} />
      <section className="v5-panel">
        <h2>
          {businesses.length
            ? "Choose a business to continue"
            : "Add your first business"}
        </h2>
        <p>Keep this work connected to one business and its brand.</p>
        {businesses.length ? (
          <ul className="business-choice">
            {businesses.map((b) => (
              <li key={b.id}>
                <a href={`/b/${b.id}/${section}`}>{b.name} →</a>
              </li>
            ))}
          </ul>
        ) : (
          <a className="button primary" href="/brands/new">
            Add business
          </a>
        )}
      </section>
    </>
  );
}
function Unavailable({
  section,
  business,
  title,
}: {
  section: string;
  business: Business;
  title: string;
}) {
  const details: Record<string, string> = {
    "content-plan":
      "Create and revise a 30-day content calendar for this business. Planning and scheduling are still being implemented.",
    review:
      "Review posts by social channel, approve exact versions, or send feedback to Canvas. The review workflow is still being implemented.",
    canvas:
      "Create images and videos, then revise them in conversation. Generation, editable projects and saved conversations are still being implemented.",
    publishing:
      "Schedule approved posts and understand their actual performance. Publishing and analytics are still being implemented.",
    connections:
      "Connect authorized social accounts to this business. The OAuth connection flow is still being implemented.",
    team: "Invite people to specific businesses and control what they can view, edit or approve. Business-scoped invitations and the full role set are still being implemented.",
  };
  return (
    <>
      <PageTitle eyebrow={business.name} title={title}>
        <p>{details[section]}</p>
      </PageTitle>
      {section === "canvas" ? (
        <div className="canvas-frame">
          <aside>
            <span className="eyebrow">Brand context</span>
            <h2>{business.name}</h2>
            <p>
              {business.has_approved_brand
                ? "Approved brand facts saved"
                : "Confirm your brand before creating"}
            </p>
            <a href={`/b/${business.id}/onboarding`}>Review brand →</a>
          </aside>
          <section className="canvas-conversation">
            <span className="canvas-symbol" aria-hidden="true">
              ✦
            </span>
            <h2>
              What would you like
              <br />
              to create?
            </h2>
            <p>Your ideas. Your brand. A space to make them yours.</p>
            <div className="availability-card">
              <strong>Canvas is not available in this build.</strong>
              <p>No generation request has been sent.</p>
            </div>
          </section>
          <aside className="canvas-preview">
            <h3>Creation preview</h3>
            <p>
              Your saved image or video will appear here when generation is
              available.
            </p>
          </aside>
        </div>
      ) : (
        <section className="v5-panel feature-unavailable">
          <Icon name={sections.find((s) => s[0] === section)?.[2] ?? "brand"} />
          <h2>This workflow is not available yet.</h2>
          <p>
            Your business and approved brand information stay saved while this
            part of Desvio is being built.
          </p>
          <a className="button" href={`/b/${business.id}/onboarding`}>
            Continue brand setup
          </a>
        </section>
      )}
    </>
  );
}
function Billing({ entitlement }: { entitlement: any }) {
  return (
    <>
      <PageTitle eyebrow="Your account" title="Billing">
        <p>A clear view of your business allowance.</p>
      </PageTitle>
      <section className="v5-panel narrow">
        <span className="eyebrow">Configured allowance</span>
        <h2>
          {entitlement.active_businesses} of {entitlement.max_active_businesses}{" "}
          businesses
        </h2>
        <p>
          Standard account allowance. Payment collection, subscriptions,
          invoices and usage billing are not available in this build.
        </p>
        <p>No paid subscription is implied by this allowance.</p>
        <a className="button" href="/brands">
          Manage businesses
        </a>
      </section>
    </>
  );
}
function Profile({ user }: { user: any }) {
  return (
    <>
      <PageTitle eyebrow="Your account" title="Profile">
        <p>Your identity and account access.</p>
      </PageTitle>
      <section className="v5-panel narrow">
        <dl>
          <dt>Name</dt>
          <dd>{user.name}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Email status</dt>
          <dd>{user.emailVerified ? "Verified" : "Verification needed"}</dd>
        </dl>
        <a className="button" href="/forgot-password">
          Reset password
        </a>
        <p className="hint">
          Password recovery uses the account email flow. Additional profile
          settings, MFA and device management are not available in this build.
        </p>
      </section>
    </>
  );
}
export function BrandOnboarding({ business }: { business: Business }) {
  const [state, setState] = useState<any>(),
    [brain, setBrain] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [dirty, setDirty] = useState(false);
  const path = scopePath(business);
  useUnsavedChanges(dirty && !busy);
  async function load() {
    try {
      const [s, b] = await Promise.all([
        api(`/api/v1/businesses/${business.id}/onboarding`),
        api(path + "/brain"),
      ]);
      setState(s);
      setBrain(b);
      setDirty(false);
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => {
    void load();
  }, [business.id]);
  async function save(step: number, approve = false) {
    setBusy(true);
    setError(undefined);
    try {
      const direction = dirty
        ? state
        : await api(`/api/v1/businesses/${business.id}/onboarding`);
      const fields = {
        revision: state.revision,
        step,
        goal: direction.goal,
        timezone: direction.timezone,
        cadence: direction.cadence,
        channels: direction.channels,
        must_avoid: direction.must_avoid,
        preferences_edited: dirty || state.preferences_edited || approve,
      };
      const saved = await api(
        `/api/v1/businesses/${business.id}/onboarding`,
        fields,
        "PATCH",
      );
      setState({
        ...saved,
        recommendation: direction.recommendation,
        prefilled: direction.prefilled,
      });
      setDirty(false);
      if (approve) {
        const current = await api(path + "/brain");
        await api(path + "/brain/approve", { revision: current.revision });
        setConfirmed(true);
        setBrain(await api(path + "/brain"));
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!state)
    return (
      <>
        <Notice error={error} />
        {error ? (
          <button onClick={() => void load()}>Try again</button>
        ) : (
          <Loading />
        )}
      </>
    );
  const writable = business.role !== "viewer",
    change = (key: string, value: any) => {
      setState({ ...state, [key]: value });
      setDirty(true);
    };
  return (
    <>
      <PageTitle
        eyebrow={business.name}
        title={
          confirmed
            ? "Your brand facts are confirmed."
            : "Make it unmistakably yours."
        }
      >
        <p>Confirm your identity and set the direction for your business.</p>
      </PageTitle>
      <Steps step={state.step} />
      <Notice error={error} />
      {confirmed ? (
        <section className="v5-panel">
          <h2>Your approved brand profile is saved.</h2>
          <p>
            Your goals and brand evidence are preserved. Creating the first
            content plan is not available in this build.
          </p>
          <a className="button primary" href={`/b/${business.id}/memory`}>
            View brand memory
          </a>
        </section>
      ) : state.step === 2 ? (
        <>
          <BrandReview business={business} onChange={setBrain} />
          <BrandFiles
            org={{
              id: business.organization_id,
              name: business.name,
              role: business.role,
            }}
            brandId={business.id}
          />
          <div className="wizard-actions">
            <a href="/brands">Your businesses</a>
            {writable && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void save(3)}
              >
                Save & continue to goals →
              </button>
            )}
          </div>
        </>
      ) : (
        <section className="v5-panel onboarding-form">
          <h2>Review your direction</h2>
          <div className="availability-card">
            {state.recommendation ? (
              <>
                <strong>
                  {state.recommendation.stale
                    ? "Your evidence changed. Review these earlier suggestions."
                    : "AI-prepared direction · yours to adjust"}
                </strong>
                <p>{state.recommendation.recommendation.reason}</p>
                <p>
                  Suggested audience:{" "}
                  {state.recommendation.recommendation.audience}
                </p>
                <details>
                  <summary>Why these suggestions?</summary>
                  {state.recommendation.evidence?.map((e: any) => (
                    <div key={e.id}>
                      {e.website_url && (
                        <a
                          href={e.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Source website
                        </a>
                      )}
                      <blockquote>{e.text}</blockquote>
                    </div>
                  ))}
                </details>
                <p className="hint">
                  Suggestions based on your saved evidence. Your edits take
                  priority.
                </p>
              </>
            ) : (
              <>
                <strong>No AI recommendations yet.</strong>
                <p>
                  Run brand analysis after adding website or document evidence.
                  These editable defaults have not been prepared by AI.
                </p>
              </>
            )}
          </div>
          <p>
            These preferences do not connect channels or authorize publication.
          </p>
          <Field label="Primary goal">
            {(id) => (
              <select
                id={id}
                disabled={!writable}
                value={state.goal}
                onChange={(e) => change("goal", e.target.value)}
              >
                {["awareness", "traffic", "leads", "sales"].map((g) => (
                  <option key={g} value={g}>
                    {g[0].toUpperCase() + g.slice(1)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Posts per week">
            {(id) => (
              <input
                id={id}
                disabled={!writable}
                type="number"
                min={1}
                max={30}
                value={state.cadence}
                onChange={(e) => change("cadence", Number(e.target.value))}
              />
            )}
          </Field>
          <Field
            label="Time zone"
            hint="Use a named time zone, such as Asia/Kuala_Lumpur."
          >
            {(id, hint) => (
              <input
                id={id}
                aria-describedby={hint}
                disabled={!writable}
                value={state.timezone}
                onChange={(e) => change("timezone", e.target.value)}
              />
            )}
          </Field>
          <fieldset>
            <legend>Preferred channels</legend>
            {["linkedin", "instagram"].map((c) => (
              <label className="checkbox-field" key={c}>
                <input
                  type="checkbox"
                  disabled={!writable}
                  checked={state.channels.includes(c)}
                  onChange={(e) =>
                    change(
                      "channels",
                      e.target.checked
                        ? [...state.channels, c]
                        : state.channels.filter((x: string) => x !== c),
                    )
                  }
                />
                {c === "linkedin" ? "LinkedIn" : "Instagram"}
              </label>
            ))}
          </fieldset>
          <Field label="Topics or claims to avoid">
            {(id) => (
              <textarea
                id={id}
                disabled={!writable}
                maxLength={2000}
                value={state.must_avoid}
                onChange={(e) => change("must_avoid", e.target.value)}
              />
            )}
          </Field>
          <p className="hint">
            Publication will require human approval. Review all findings and
            confirm the business name, offering and audience before approving
            your brand.
          </p>
          <Notice error={error} />
          {writable && (
            <div className="actions">
              <button disabled={busy} onClick={() => void save(2)}>
                Back to brand review
              </button>
              <button disabled={busy} onClick={() => void save(3)}>
                Save goals
              </button>
              {["owner", "admin"].includes(business.role) && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void save(3, true)}
                >
                  {busy ? "Saving…" : "Confirm brand profile"}
                </button>
              )}
            </div>
          )}
          <p className="availability-note">
            First-plan generation is still being implemented. Saving these
            settings does not generate a plan.
          </p>
        </section>
      )}
    </>
  );
}
function BrandReview({
  business,
  onChange,
}: {
  business: Business;
  onChange: (brain: any) => void;
}) {
  const [brain, setBrain] = useState<any>(),
    [assets, setAssets] = useState<any[]>([]),
    [error, setError] = useState<unknown>(),
    [field, setField] = useState("brand_name"),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<any>(),
    manualKey = useRef(""),
    lastBody = useRef("");
  const path = scopePath(business),
    writable = business.role !== "viewer";
  useUnsavedChanges(!!value && !busy);
  async function load() {
    try {
      const [b, a] = await Promise.all([
        api(path + "/brain"),
        api(path + "/assets"),
      ]);
      setBrain(b);
      onChange(b);
      setAssets(a.assets);
      if (b.jobs?.length) setJob(b.jobs[0]);
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => {
    void load();
  }, [path]);
  useEffect(() => {
    if (
      !job ||
      ["succeeded", "failed", "rejected", "canceled"].includes(job.status)
    )
      return;
    let live = true;
    const timer = setInterval(async () => {
      try {
        const j = await api(`${path}/jobs/${job.id}`);
        if (live) {
          setJob(j);
          if (j.status === "succeeded") void load();
        }
      } catch (e) {
        if (live) setError(e);
      }
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status, path]);
  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const body = { field, value },
      serialized = JSON.stringify(body);
    if (serialized !== lastBody.current) {
      manualKey.current = crypto.randomUUID();
      lastBody.current = serialized;
    }
    try {
      await api(path + "/brain/findings", body, "POST", manualKey.current);
      setValue("");
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <BrandIntake business={business} onComplete={() => void load()} />
      <section className="v5-panel">
        <div className="section-heading">
          <div>
            <h2>Here’s what we know about your brand.</h2>
            <p>
              Review each fact. Your decisions become the brand’s approved
              memory.
            </p>
          </div>
          <button onClick={() => void load()}>Refresh evidence</button>
        </div>
        <Notice error={error} />
        {!brain ? (
          <Loading />
        ) : (
          <>
            <div className="finding-grid">
              {brain.findings.map((f: any) => (
                <Finding
                  key={f.id}
                  finding={f}
                  path={path}
                  writable={writable}
                  onSaved={() => void load()}
                />
              ))}
            </div>
            {!brain.findings.length && (
              <p>
                No findings yet. Add facts below or extract them from a
                validated PDF or PowerPoint file.
              </p>
            )}
          </>
        )}
        {writable && (
          <form onSubmit={add} className="manual-fact">
            <h3>Add a brand fact</h3>
            <div className="fact-inputs">
              <Field label="Brand field">
                {(id) => (
                  <select
                    id={id}
                    value={field}
                    onChange={(e) => setField(e.target.value)}
                  >
                    {[
                      "brand_name",
                      "offering",
                      "audience",
                      "voice",
                      "colors",
                      "prohibited_claims",
                      "positioning",
                      "cta",
                      "fonts",
                      "products",
                    ].map((f) => (
                      <option key={f} value={f}>
                        {f.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Fact">
                {(id) => (
                  <textarea
                    id={id}
                    required
                    maxLength={4000}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <button disabled={busy}>
              {busy ? "Saving…" : "Add for review"}
            </button>
          </form>
        )}
      </section>
      <section className="v5-panel document-evidence">
        <h2>Have brand guidelines already?</h2>
        <p>
          Upload your files below, wait for validation, then extract their text
          here. This parser reads embedded PDF/PPTX text; scanned pages, images
          and visual guidelines still need additional review.
        </p>
        {assets
          .filter(
            (a) =>
              a.state === "ready" &&
              [
                "application/pdf",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              ].includes(a.content_type),
          )
          .map((a) => (
            <div className="document-row" key={a.id}>
              <span>{a.filename}</span>
              {writable && (
                <button
                  disabled={
                    busy ||
                    (!!job &&
                      !["succeeded", "failed", "rejected", "canceled"].includes(
                        job.status,
                      ))
                  }
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setJob(
                        await api(
                          `${path}/assets/${a.id}/extract`,
                          {},
                          "POST",
                          crypto.randomUUID(),
                        ),
                      );
                    } catch (e) {
                      setError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Extract brand evidence
                </button>
              )}
            </div>
          ))}
        {job && (
          <p role="status">
            Document extraction: {job.status}
            {job.error_code
              ? ` · ${job.error_code.replaceAll("_", " ").toLowerCase()}`
              : ""}
          </p>
        )}
        <p className="hint">
          Refresh evidence after a new file passes validation. Extraction never
          approves a fact automatically.
        </p>
      </section>
    </>
  );
}
function Finding({
  finding: f,
  path,
  writable,
  onSaved,
}: {
  finding: any;
  path: string;
  writable: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(f.value),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  useUnsavedChanges(editing && value !== f.value && !busy);
  async function decide(decision: string) {
    setBusy(true);
    setError(undefined);
    try {
      await api(
        `${path}/brain/findings/${f.id}`,
        {
          revision: f.revision,
          decision,
          ...(decision === "edited" ? { value } : {}),
        },
        "PATCH",
      );
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="finding-card">
      <div className="section-heading">
        <h3>{f.field.replaceAll("_", " ")}</h3>
        <span className="status neutral">
          {f.status === "unreviewed" ? "Needs review" : f.status}
        </span>
      </div>
      {editing ? (
        <Field label={`Edit ${f.field.replaceAll("_", " ")}`}>
          {(id) => (
            <textarea
              id={id}
              maxLength={4000}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
      ) : (
        <p>{f.value}</p>
      )}
      <details>
        <summary>
          {f.extraction_type === "ai_suggestion"
            ? "AI suggestion · supporting evidence"
            : `Source · page ${f.page}`}
        </summary>
        {f.evidence_quote && <blockquote>{f.evidence_quote}</blockquote>}
        <blockquote>{f.evidence}</blockquote>
      </details>
      <Notice error={error} />
      {writable && (
        <div className="actions">
          {editing ? (
            <>
              <button disabled={busy} onClick={() => void decide("edited")}>
                Save correction
              </button>
              <button disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button disabled={busy} onClick={() => void decide("correct")}>
                Correct
              </button>
              <button disabled={busy} onClick={() => void decide("wrong")}>
                Wrong
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setValue(f.value);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
function Memory({ business }: { business: Business }) {
  const [brain, setBrain] = useState<any>(),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    api(scopePath(business) + "/brain")
      .then(setBrain)
      .catch(setError);
  }, [business.id]);
  return (
    <>
      <PageTitle eyebrow={business.name} title="Memory">
        <p>
          The facts you’ve confirmed. A foundation for everything you create.
        </p>
      </PageTitle>
      <Notice error={error} />
      {brain ? (
        <section className="v5-panel">
          <h2>Brand knowledge</h2>
          {brain.active ? (
            <>
              <p>
                Approved{" "}
                {new Date(brain.active.approved_at).toLocaleDateString()} ·
                draft revision {brain.active.review_revision}
              </p>
              <dl className="memory-facts">
                {brain.active.snapshot.facts.map((f: any) => (
                  <div key={f.id}>
                    <dt>{f.field.replaceAll("_", " ")}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p>
              No approved brand profile yet. Confirm your facts to start
              building this business’s memory.
            </p>
          )}
          <a className="button" href={`/b/${business.id}/onboarding`}>
            Review brand facts
          </a>
          <p className="availability-note">
            Creative preferences, performance lessons and experiments are still
            being implemented.
          </p>
        </section>
      ) : (
        !error && <Loading />
      )}
    </>
  );
}
