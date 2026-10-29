"use client";
import {Strategies} from "./strategies";
import {GenerationBalance} from "./generation-balance";
import {AppLink} from "./app-link";
import {MemoryEvidence,MemorySources} from './memory-evidence';
import {PerformanceLessons} from './performance-lessons';
import {Profile} from "./profile";
import {BusinessTeam} from "./business-team";
import {BrandReferences} from "./brand-references";
import {BrandFontChoices,BrandStylePreview} from './brand-style-preview';
import {VisualReview} from "./visual-review";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { Wordmark, Loading, Notice, Field } from "./primitives";
import { BrandFiles } from "./uploads";
import { BrandIntake } from "./intake";
import {ContentWorkspace} from "./content-workspace";
import {PublishingScreen} from "./publishing";
import {CampaignsScreen} from "./campaigns";
import {BusinessOverviewPanel} from "./business-overview";
import {ConnectionsScreen} from "./connections";
import {CampaignBuilder} from "./campaign-builder";
import {ContentArchive} from "./content-archive";
import {ContentPreferences} from "./content-preferences";
import {TimeZoneSelect} from "./time-zone-select";
import {FirstPlan} from "./first-plan";
import {CampaignReview} from "./campaign-review";
import {CampaignPostScreen} from "./campaign-post";
import { confirmNavigation, hasUnsavedChanges, useUnsavedChanges } from "./unsaved";
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
  ["overview", "Home", "home"],
  ["content-plan", "Calendar", "calendar"],
  ["campaigns", "Campaigns", "layers"],
  ["review", "Approvals", "approval"],
  ["brand-kit", "Brand Kit", "orbit"],
  ["content-preferences", "Content Preferences", "sliders"],
  ["connections", "Integrations", "bolt"],
  ["memory", "Learnings", "memory"],
  ["publishing", "Insights", "chart"],
  ["archive", "Archived Posts", "archive"],
  ["brands", "Brands", "brand"],
  ["team", "Team", "people"],
  ["billing", "Billing", "card"],
  ["profile", "Profile", "person"],
];
const groups: Record<string, string> = {
  overview: "Plan & create",
  "brand-kit": "Brand",
  memory: "Results",
  archive: "Library",
  brands: "Workspace",
};
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "M3 10 12 3l9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM8 17h8",
    layers: "m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5",
    bolt: "M9 2v6m6-6v6M7 8h10v5a5 5 0 0 1-10 0Zm5 10v4",
    orbit: "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.7 1.7 0 0 1 1-3.3h2a4 4 0 0 0 4-4c0-4-4-7-9-7ZM7 9h.01M10 6h.01M15 7h.01M6 14h.01",
    sliders: "M3 6h7m4 0h7M3 12h3m4 0h11M3 18h11m4 0h3M10 3v6M6 9v6M14 15v6",
    approval: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 12l3 3 5-6",
    brand: "M12 3 3 8v8l9 5 9-5V8Zm-9 5 9 5 9-5M12 13v8",
    calendar: "M4 5h16v16H4ZM8 2v6M16 2v6M4 11h16",
    check: "M4 4h16v16H4Zm4 8 3 3 6-7",
    star: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z",
    chart: "M3 21V11h5v10M8 21V3h5v18m0 0V8h5v13M2 21h20",
    memory: "M9 18h6m-6 3h6M8 15a7 7 0 1 1 8 0c-1 .7-1 1-1 3H9c0-2 0-2.3-1-3Z",
    link: "M9 15l6-6M8 17l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 0M16 7l2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-6 0",
    people:
      "M7 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M1 21v-3a6 6 0 0 1 12 0v3M16 5a4 4 0 0 1 0 8M17 16a5 5 0 0 1 6 5",
    archive: "M3 3h18v5H3ZM5 8v13h14V8M9 12h6",
    card: "M3 5h18v14H3ZM3 10h18M7 15h4",
    person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 22v-2a8 8 0 0 1 16 0v2",
  };
  return (
    <svg
      className="workspace-icon"
      width="20"
      height="20"
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
  const initialized=useRef(false),loadedAt=useRef(0);
  const requestedBusinessId=pathname.split("/")[1]==="b"?pathname.split("/")[2]:undefined;
  const [verifiedBusinessId,setVerifiedBusinessId]=useState<string>();
  const [workspaceRevision,setWorkspaceRevision]=useState(0);
  useEffect(()=>{const changed=()=>{loadedAt.current=0;setWorkspaceRevision(n=>n+1);},focus=()=>{if(!document.hidden&&Date.now()-loadedAt.current>=30000)setWorkspaceRevision(n=>n+1);};window.addEventListener('desvio-workspace-changed',changed);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);return()=>{window.removeEventListener('desvio-workspace-changed',changed);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};},[]);
  useEffect(()=>{setMenu(false);},[pathname]);
  const router = useRouter(),
    [session, setSession] = useState<any>(),
    [businesses, setBusinesses] = useState<Business[]>(),
    [entitlement, setEntitlement] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [signoutError, setSignoutError] = useState<unknown>(),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    if(Date.now()-loadedAt.current<30000&&(!requestedBusinessId||businesses?.some(b=>b.id===requestedBusinessId)))return;
    let active = true;
    (async () => {
      try {
        const user = await api("/api/auth/get-session");
        if (!active) return;
        if (!user?.user?.emailVerified) {
          router.replace("/sign-in");
          return;
        }
        if(!initialized.current){await api("/api/v1/accounts/current/initialize", {});initialized.current=true;}
        const [list, plan] = await Promise.all([
          api("/api/v1/businesses"),
          api("/api/v1/accounts/current/entitlements"),
        ]);
        if (active) {
          setError(undefined);
          setSession(user);
          setBusinesses(list.businesses);
          setVerifiedBusinessId(requestedBusinessId);
          setEntitlement(plan);
          loadedAt.current=Date.now();
        }
      } catch (e) {
        if (active) setError(e);
      }
    })();
    return () => {
      active = false;
    };
  }, [router,pathname,workspaceRevision]);
  if (error && (!session || !businesses))
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
      <div className="v5-shell workspace-opening" aria-busy="true" aria-label="Opening Desvio">
        <aside className="v5-sidebar"><Wordmark/><div className="shell-placeholder" aria-hidden="true"/>{sections.map(([key,title,icon])=><div className="shell-nav-placeholder" key={key}><Icon name={icon}/><span>{title}</span></div>)}</aside>
        <div className="v5-body"><header className="v5-topbar"><span className="shell-placeholder" aria-hidden="true"/></header><main id="main" className="v5-main"><span className="sr-only" role="status">Opening your workspace</span><div className="shell-content-placeholder" aria-hidden="true"/><div className="shell-content-placeholder short" aria-hidden="true"/></main></div>
      </div>
    );
  const parts = pathname.split("/").filter(Boolean),
    business =
      parts[0] === "b" ? businesses.find((b) => b.id === parts[1]) : undefined,
    section =
      parts[0] === "b" ? (parts[2] ?? "overview") : (parts[0] ?? "overview"),
    isNew = pathname === "/brands/new",
    label =
      section === "campaign-post" ? "Campaign post" : section === "canvas" ? "Campaigns" : section === "strategies" ? "Strategies" : section === "campaign-review" ? "Campaign" : section === "campaign-new" ? "New campaign" : section === "manage"
        ? "Manage brand"
        : section === "onboarding"
        ? "Brand onboarding"
        : sections.find((s) => s[0] === section)?.[1];
  const resolvingBusiness=parts[0]==="b"&&!business&&verifiedBusinessId!==parts[1];
  if ((parts[0] === "b" && !business && !resolvingBusiness) || !label)
    return (
      <main id="main" className="standalone">
        <Wordmark />
        <h1>Business unavailable</h1>
        <p>This link may have changed, or you may no longer have access.</p>
        <AppLink href="/brands">Your businesses</AppLink>
      </main>
    );
  const href = (key: string) =>
    ["brands", "billing", "profile"].includes(key)
      ? `/${key}`
      : business
        ? `/b/${business.id}/${key}`
        : businesses.length === 1 && key !== "overview"
          ? `/b/${businesses[0].id}/${key}`
          : `/${key}`;
  return (
    <div className={`v5-shell ${menu ? "menu-open" : ""}`}>
      <aside className="v5-sidebar">
        <div className="workspace-switcher"><Wordmark />
          {businesses.length === 0 ? <span className="workspace-context">Your workspace</span> : <div className="workspace-business"><span className="workspace-business-initial" aria-hidden="true">{(business?.name??"All").slice(0,1)}</span><Field label="Business">
            {(id) => (
              <select
                id={id}
                aria-label="Business"
                value={business?.id ?? ""}
                onChange={(e) =>
                  confirmNavigation() && router.push(
                    e.target.value
                      ? `/b/${e.target.value}/${["brands", "billing", "profile"].includes(section) ? "overview" : section}`
                      : "/overview",
                  )
                }
              >
                <option value="">All businesses</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </Field></div>}
        </div>
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
              <AppLink
                href={href(key)}
                aria-current={
                  section === key || (["campaign-new","campaign-review","campaign-post"].includes(section) && key === "campaigns") ||
                  (["onboarding", "manage"].includes(section) && key === "brands")
                    ? "page"
                    : undefined
                }
              >
                <Icon name={icon} />
                <span>{title}</span>
              </AppLink>
            </div>
          ))}
        </nav>
        <div className="v5-account">
          <span className="avatar" aria-hidden="true">
            {session.user.name.slice(0, 1)}
          </span>
          <div>
            <strong>{session.user.name}</strong>
            <AppLink href="/profile">Your account</AppLink>
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
          <span className="workspace-page-title">{business&&<><span className="workspace-breadcrumb">{business.name}</span><span className="workspace-separator" aria-hidden="true">/</span></>}{label}</span>
          <div className="header-actions">
            {business&&<GenerationBalance key={business.organization_id} organizationId={business.organization_id}/>}
            <AppLink className="profile-link workspace-avatar" href="/profile" aria-label="Profile" title="Your profile">
              {session.user.name.slice(0,1)}
            </AppLink>
          </div>
        </header>
        <main id="main" className="v5-main" key={pathname}>
          <Notice error={error}/>
          {resolvingBusiness ? (error ? <button onClick={()=>{loadedAt.current=0;setWorkspaceRevision(n=>n+1);}}>Try again</button> : <div role="status" aria-label="Opening business"><Loading /></div>) : section === "brands" ? (
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
            <Profile session={session} onChanged={setSession} />
          ) : section === "billing" ? (
            <Billing entitlement={entitlement} />
          ) : !business ? (
            <ChooseBusiness
              businesses={businesses}
              section={section}
              title={label!}
            />
          ) : section === "manage" ? (
            <><PageTitle eyebrow={business.name} title="Manage brand"/><section className="v5-panel"><AppLink href={`/b/${business.id}/onboarding`}>Edit brand details →</AppLink><ManageBrand business={business}/></section></>
          ) : section === "brand-kit" ? (
            <BrandKit key={business.id} business={business}/>
          ) : section === "content-preferences" ? (
            <ContentPreferences key={business.id} business={business}/>
          ) : section === "onboarding" ? (
            <BrandOnboarding business={business} />
          ) : ["content-plan","review"].includes(section) ? (
            <ContentWorkspace key={`${business.id}:${section}`} business={business} inbox={section==="review"}/>
          ) : section === "campaign-review" ? (
            <CampaignReview key={business.id} business={business}/>
          ) : section === "strategies" ? (
            <Strategies key={business.id} business={business}/>
          ) : section === "campaign-new" ? (
            <CampaignBuilder key={business.id} business={business}/>
          ) : section === "campaigns" ? (
            <CampaignsScreen key={business.id} business={business}/>
          ) : section === "archive" ? (
            <ContentArchive key={business.id} business={business}/>
          ) : section === "campaign-post" ? (
            <CampaignPostScreen business={business}/>
          ) : section === "canvas" ? (
            <RetiredCanvas businessId={business.id}/>
          ) : section === "publishing" ? (
            <PublishingScreen key={business.id} business={business}/>
          ) : section === "connections" ? (
            <ConnectionsScreen key={business.id} business={business}/>
          ) : section === "team" ? (
            <BusinessTeam key={business.id} business={business}/>
          ) : section === "memory" ? (
            <Memory key={business.id} business={business} />
          ) : (
            <Unavailable section={section} business={business} title={label!} />
          )}
        </main>
      </div>
    </div>
  );
}
function RetiredCanvas({businessId}:{businessId:string}) {
  const router=useRouter();
  useEffect(()=>{
    const source=new URLSearchParams(location.search),query=new URLSearchParams();
    for(const key of ['slot','thread','project','carousel']){const value=source.get(key);if(value)query.set(key,value);}
    router.replace(`/b/${businessId}/${query.size?'campaign-post?'+query.toString():'campaigns'}`);
  },[businessId,router]);
  return <p role="status">Opening your campaign workspace…</p>;
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
      <AppLink className="button card-open" href={`/b/${business.id}/onboarding`}>
        {business.has_approved_brand ? "Review brand" : "Continue setup"}{" "}
        <span aria-hidden="true">→</span>
      </AppLink>
      <AppLink className="brand-manage" href={`/b/${business.id}/manage`}>Manage brand →</AppLink>
    </article>
  );
}
function ManageBrand({business}:{business:Business}) {
  const [confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
  const router=useRouter();
  const confirmationInput=useRef<HTMLInputElement>(null);
  const [confirmationError,setConfirmationError]=useState(false);
  return business.role!=='owner'?null:<details className="brand-manage"><summary>Delete brand</summary>
    {business.role==='owner'&&<form onSubmit={async e=>{e.preventDefault();if(busy)return;if(confirmation.trim()!==business.name){setConfirmationError(true);confirmationInput.current?.focus();return;}setConfirmationError(false);setBusy(true);setError(undefined);try{await api(`/api/v1/businesses/${business.id}`,{organization_id:business.organization_id,name:business.name,revision:business.revision},'DELETE');router.replace('/brands');}catch(e){setError(e);}finally{setBusy(false);}}}>
      <h2>Delete brand</h2><p>This removes the brand from your workspace and frees its business slot. Saved records are retained for audit; this does not erase stored files or delete posts already published on social platforms.</p>
      <p>Active jobs and unresolved publications must be finished first.</p>
      <label htmlFor={`delete-${business.id}`}>Type {business.name} to confirm</label>
      <input ref={confirmationInput} id={`delete-${business.id}`} value={confirmation} onChange={e=>{setConfirmation(e.target.value);setConfirmationError(false);}} aria-invalid={confirmationError} aria-describedby={`delete-help-${business.id}`} autoComplete="off" disabled={busy}/>
      <p id={`delete-help-${business.id}`} role={confirmationError?'alert':undefined}>{confirmationError?`Enter “${business.name}” in the field above to confirm deletion.`:'Enter the brand name above, then select Delete brand.'}</p>
      <Notice error={error}/><button className="danger" type="submit" disabled={busy}>{busy?'Deleting…':'Delete brand'}</button>
    </form>}
  </details>;
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
        <AppLink className="button primary" href="/brands/new">
          + Add business
        </AppLink>
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
          <AppLink
            className="button primary"
            href={entitlement.can_create_business ? "/brands/new" : "/billing"}
          >
            {entitlement.can_create_business
              ? "Add a business"
              : "View business allowance"}
          </AppLink>
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
function customerSummary(value: string = "") {
  // Source IDs stay in the saved evidence, never in customer-facing prose.
  return value.replace(/(?:\b(?:cited|citations?|sources?|evidence)(?:\s+ids?)?\s*:\s*)?[\[(]?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?:[\s,;]+[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})*[\])]?\.?/gi, "").replace(/\s+([.,;])/g,"$1").replace(/ {2,}/g," ").trim();
}
function NewBusiness({ entitlement }: { entitlement: any }) {
  const router=useRouter();
  const [documents,setDocuments]=useState(false),[created,setCreated]=useState<Business>();
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
    const enteredWebsite = website.trim();
    const normalizedWebsite = enteredWebsite && !/^[a-z][a-z\d+.-]*:/i.test(enteredWebsite)
      ? `https://${enteredWebsite.replace(/^\/\//, "")}` : enteredWebsite;
    const body = { name, website: normalizedWebsite || null },
      serialized = JSON.stringify(body);
    if (serialized !== bodyKey.current) {
      bodyKey.current = serialized;
      key.current = crypto.randomUUID();
    }
    try {
      const b = await api("/api/v1/businesses", body, "POST", key.current);
      window.dispatchEvent(new Event('desvio-workspace-changed'));
      if(documents)setCreated(b);else router.push(`/b/${b.id}/onboarding`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function prepareUploads(){
    if(!created||busy)return;
    setBusy(true);setError(undefined);
    try{
      const root=scopePath(created),{assets}=await api(root+'/assets');
      if(assets.some((a:any)=>['awaiting_upload','queued','validating'].includes(a.state)))throw new Error('Your files are still being checked. Continue when the checks finish.');
      for(const asset of assets.filter((a:any)=>a.state==='ready'&&['application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation'].includes(a.content_type))){
        let job=await api(`${root}/assets/${asset.id}/extract`,{},'POST',`onboarding-document-${asset.id}`);
        for(let attempt=0;attempt<60&&['queued','running','retrying'].includes(job.status);attempt++){
          await new Promise(resolve=>setTimeout(resolve,2000));job=await api(`${root}/jobs/${job.id}`);
        }
        if(job.status!=='succeeded')throw new Error(job.error_code?`We couldn’t read ${asset.filename}: ${job.error_code}. Your upload is saved.`:`${asset.filename} is still being read. Try continuing again shortly; we’ll check the same request.`);
      }
      if(!created.website&&assets.some((a:any)=>a.state==='ready'&&['application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation'].includes(a.content_type)))await api(`/api/v1/businesses/${created.id}/intake`,{kind:'brand.analyze'},'POST',`onboarding-documents-${created.id}`);
      router.push(`/b/${created.id}/onboarding`);
    }catch(e){setError(e);}finally{setBusy(false);}
  }
  if(created)return <div className="brand-onboarding-experience"><PageTitle eyebrow="Add your business" title="Bring your brand along."><p>Upload any logos, product photos or guidelines you have.</p></PageTitle><Steps step={1}/><BrandFiles org={{id:created.organization_id,name:created.name,role:created.role??'owner'}} brandId={created.id}/><Notice error={error}/><button className="primary" disabled={busy} onClick={()=>void prepareUploads()}>{busy?"Reading your documents…":"Continue to brand analysis"}</button></div>;
  return (
    <div className="brand-onboarding-experience business-intro">
      <PageTitle
        eyebrow="Add your business"
        title="Your content. Your brand."
      >
        <p>Let’s turn your website into a marketing plan.</p>
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
          <AppLink href="/brands">Back to your businesses</AppLink>
        </section>
      ) : (
        <div className="business-intro-grid"><form
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
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={hint}
                maxLength={2048}
                value={website}
                placeholder="www.yourbusiness.com"
                onChange={(e) => setWebsite(e.target.value)}
              />
            )}
          </Field>
          <label className="checkbox-field"><input type="checkbox" checked={documents} onChange={e=>setDocuments(e.target.checked)}/>I have logos, product photos or brand documents to add</label>
          <Notice error={error} />
          <button className="primary" disabled={busy}>
            {busy ? "Saving your business…" : "Continue"}
          </button>
        </form><aside className="business-intro-preview" aria-label="Your business preview"><div className="intro-brand-tile" aria-hidden="true">{name.trim().slice(0,1).toUpperCase()||'d'}<span>·</span></div><p className="eyebrow">Built around your business</p><h2>{name.trim()||'Make it yours.'}</h2><p>{website||'Your identity. Your voice. Your next idea.'}</p><div className="intro-brand-pillars"><span>Brand</span><span>Ideas</span><span>Calendar</span></div></aside></div>
      )}
    </div>
  );
}
function Steps({ step }: { step: number }) {
  return (
    <ol className="onboarding-steps" aria-label="Brand onboarding">
      {["Add your business", "Confirm your brand", "Confirm your first plan"].map(
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
  if(business)return <BusinessOverviewPanel key={business.id} business={business} name={name}/>;
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
          <AppLink
            className="button primary"
            href="/brands"
          >
            {rows.length ? "Continue brand setup" : "Add your first business"}{" "}
            <span aria-hidden="true">→</span>
          </AppLink>
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
            <AppLink href="/brands">Manage brands →</AppLink>
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
                <AppLink href={`/b/${b.id}/${section}`}>{b.name} →</AppLink>
              </li>
            ))}
          </ul>
        ) : (
          <AppLink className="button primary" href="/brands/new">
            Add business
          </AppLink>
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
      "Review posts by social channel, approve exact versions, or revise a campaign creative. The review workflow is still being implemented.",
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
            <AppLink href={`/b/${business.id}/onboarding`}>Review brand →</AppLink>
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
              <strong>Open Campaigns to create and manage your posts.</strong>
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
          <AppLink className="button" href={`/b/${business.id}/onboarding`}>
            Continue brand setup
          </AppLink>
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
        <AppLink className="button" href="/brands">
          Manage businesses
        </AppLink>
      </section>
    </>
  );
}
export function BrandOnboarding({ business }: { business: Business }) {
  const [state, setState] = useState<any>(),
    [intakeState,setIntakeState]=useState<any>(),
    [manualSetup,setManualSetup]=useState(false),
    [brain, setBrain] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [visualEditing,setVisualEditing] = useState(false),
    [factSaving,setFactSaving] = useState(false),
    [dirty, setDirty] = useState(false);
  const path = scopePath(business), dirtyRef=useRef(false);
  dirtyRef.current=dirty;
  useUnsavedChanges(dirty && !busy);
  async function load() {
    try {
      const [s, b] = await Promise.all([
        api(`/api/v1/businesses/${business.id}/onboarding`),
        api(path + "/brain"),
      ]);
      if(!dirtyRef.current){setState(s);setDirty(false);}
      setBrain(b);
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
      const refreshed = dirty ? state : await api(`/api/v1/businesses/${business.id}/onboarding`);
      // Resolving a missing fact invalidates the recommendation's evidence version,
      // but must not silently replace the suggestions already shown with defaults.
      const direction = !dirty && state.prefilled && refreshed.recommendation?.stale && !refreshed.preferences_edited
        ? {...refreshed,goal:state.goal,cadence:state.cadence,channels:state.channels}
        : refreshed;
      const fields = {
        revision: state.revision,
        step,
        goal: direction.goal,
        timezone: direction.timezone,
        cadence: direction.cadence,
        channels: direction.channels,
        must_avoid: direction.must_avoid,
        business_stage: direction.business_stage ?? "",
        growth_expectation: direction.growth_expectation ?? "",
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
        setBrain(await api(path + "/brain"));
      }
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function confirmDetails(){
    if(factSaving || busy || !confirmNavigation())return;
    setBusy(true);setError(undefined);
    try{
      if(!brain)throw new Error('Your profile is still loading. Please try again.');
      const missing=['brand_name','offering','audience'].filter(field=>!brain.findings.some((f:any)=>f.field===field&&f.status!=='wrong'));
      if(missing.length)throw new Error(`Complete your ${missing.map(f=>f.replaceAll('_',' ')).join(', ')} before continuing.`);
      const repeated=brain.findings.find((f:any)=>f.status!=='wrong'&&brain.findings.filter((other:any)=>other.field===f.field&&other.status!=='wrong').length>1);
      if(repeated)throw new Error(`Choose one ${repeated.field.replaceAll('_',' ')} description and select Correct before continuing.`);
      const current=await api(path+'/brain');
      if(current.revision!==brain.revision)throw new Error('Your profile changed. Refresh it and review the latest details.');
      for(const fact of brain.findings.filter((f:any)=>f.status==='unreviewed'))await api(`${path}/brain/findings/${fact.id}`,{revision:fact.revision,decision:'correct'},'PATCH');
      for(const direction of (brain.visuals?.directions??[]).filter((d:any)=>!d.review))await api(path+'/brain/visuals',{analysis_job_id:direction.analysis_job_id,index:direction.index,evidence_sha256:direction.evidence_sha256,revision:0,decision:'correct'},'PATCH');
      setBrain(await api(path+'/brain'));
      await save(3);
    }catch(e){setError(e);}finally{setBusy(false);}
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
  const writable = ['owner','admin','editor'].includes(business.role),
    change = (key: string, value: any) => {
      setState({ ...state, [key]: value });
      setDirty(true);
    };
  const profileReady=!business.website||['brand_name','offering'].every(field=>brain?.findings?.some((f:any)=>(f.field===field||(field==='offering'&&f.field==='products'))&&f.status!=='wrong'));
  const preparing=!manualSetup&&(intakeState?.jobs.some((j:any)=>['queued','running','retrying'].includes(j.status))||(!!business.website&&(!profileReady||!intakeState||intakeState.jobs.find((j:any)=>j.kind==='brand.analyze')?.status!=='succeeded')));
  return (
    <div className="brand-onboarding-experience">
      <PageTitle
        eyebrow={business.name}
        title={
          confirmed
            ? "Your brand is ready."
            : preparing ? "Your brand starts here." : state.step===2 ? "Does this feel like you?" : "Your first content plan."
        }
      >
        <p>{preparing?"We’ll handle the research. You make it yours.":state.step===2?"We’ve prepared the details. Edit anything before continuing.":"Choose your channels and content mix. We’ll build your calendar."}</p>
      </PageTitle>
      <Steps step={preparing?1:state.step} />
      <Notice error={error} />
      {!manualSetup&&<BrandIntake business={business} onboarding profileReady={profileReady} onState={setIntakeState} onManual={()=>setManualSetup(true)} onComplete={()=>void load()} />}
      {preparing ? null : confirmed ? (
        <section className="v5-panel">
          <h2>Your approved brand profile is saved.</h2>
          <p>
            Your brand is saved. Open your content plan to start creating.
          </p>
          <div className="actions"><AppLink className="button" href={`/b/${business.id}/memory`}>
            View brand memory
          </AppLink>
          <AppLink className="button primary" href={`/b/${business.id}/content-plan`}>Open Content Plan</AppLink></div>
        </section>
      ) : state.step === 2 ? (
        <>
          <BrandReview business={business} onChange={setBrain} onVisualEditing={setVisualEditing} onSavingChange={setFactSaving} recommendation={state.recommendation?.recommendation} />
          <details className="onboarding-source-details" open={!business.website}><summary>Add logos, product photos or guidelines</summary>
          <BrandFiles
            org={{
              id: business.organization_id,
              name: business.name,
              role: business.role,
            }}
            brandId={business.id}
          /></details>
          {visualEditing&&<p role="status">Save or discard your visual edit before continuing to goals.</p>}
          <p className="hint">Continuing confirms the profile details shown above. Edit or remove anything that isn’t right.</p>
          <div className="wizard-actions">
            <AppLink href="/brands">Your businesses</AppLink>
            {writable && (
              <button
                className="primary"
                disabled={busy||visualEditing||factSaving}
                onClick={() => void confirmDetails()}
              >
                Confirm details & continue
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
                    ? "Your brand changed. Review your suggested direction."
                    : "Your suggested direction"}
                </strong>
                <p>{customerSummary(state.recommendation.recommendation.reason)}</p>
                <p>
                  Suggested audience:{" "}
                  {customerSummary(state.recommendation.recommendation.audience)}
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
          <Field label="What stage is your business at?">
            {(id) => <select id={id} disabled={!writable} value={state.business_stage ?? ""} onChange={e => change("business_stage", e.target.value)}>
              <option value="">Choose a stage (optional)</option>
              <option value="pre_launch">Preparing to launch</option>
              <option value="launching">Just launched</option>
              <option value="growing">Growing our customer base</option>
              <option value="established">Established and expanding</option>
            </select>}
          </Field>
          <Field label="What would success look like over the next 90 days?" hint="Optional. This guides your content; it is a target, not a promised result.">
            {(id, hint) => <textarea id={id} aria-describedby={hint} disabled={!writable} maxLength={600} value={state.growth_expectation ?? ""} placeholder="For example: attract 20 qualified enquiries a month for our new service." onChange={e => change("growth_expectation", e.target.value)} />}
          </Field>
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
          <Field label="Time zone">
            {(id) => <TimeZoneSelect id={id} disabled={!writable} value={state.timezone} onChange={value=>change("timezone",value)} />}
          </Field>
          <fieldset>
            <legend>Preferred channels</legend>
            {["linkedin", "instagram", "facebook"].map((c) => (
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
                {c === "linkedin" ? "LinkedIn" : c === "facebook" ? "Facebook" : "Instagram"}
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
              {["owner","admin"].includes(business.role)&&<button disabled={busy} onClick={async()=>{if(await save(3,true))setConfirmed(true);}}>Save brand without a plan</button>}

            </div>
          )}
          {["owner","admin"].includes(business.role)&&<FirstPlan businessId={business.id} cadence={state.cadence} timezone={state.timezone} disabled={busy||!state.channels.length} beforeSubmit={()=>save(3,true)} />}
        </section>
      )}
    </div>
  );
}
function BrandKit({business}:{business:Business}) {
 const [tab,setTab]=useState('media'),[brain,setBrain]=useState<any>(),[visualEditing,setVisualEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState<number>(),[factSaving,setFactSaving]=useState(false);
 const org={id:business.organization_id,name:business.name,role:business.role};
 const writable=['owner','admin','editor'].includes(business.role);
 async function approve(){
  if(!brain||visualEditing||factSaving)return;
  if(hasUnsavedChanges()){setError(new Error("Save or cancel your open edits before approving your brand."));return;}
  setBusy(true);setError(undefined);
  try{await api(scopePath(business)+'/brain/approve',{revision:brain.revision});setSaved(brain.revision);window.dispatchEvent(new Event('desvio-workspace-changed'));}
  catch(e){setError(e);}finally{setBusy(false);}
 }
 const tabs=[['media','Media Library'],['style','Brand Style'],['voice','Brand Voice'],['profile','Brand Profile'],['sources','Source Materials']];
 useEffect(()=>{const id=window.location.hash.slice(1);if(['media','style','voice','profile','sources'].includes(id))setTab(id);},[]);
 return <section className="brand-kit-screen"><header className="brand-kit-heading"><p>{business.name}</p><h1>Brand Kit</h1></header>
  <div className="brand-kit-layout"><nav className="brand-kit-navigation" aria-label="Brand Kit sections">{tabs.map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} disabled={busy||factSaving} onClick={()=>{if(tab!==id&&confirmNavigation()){setTab(id);history.replaceState(history.state,'',`#${id}`);setBrain(undefined);setSaved(undefined);setVisualEditing(false);setError(undefined);}}}>{label}</button>)}</nav>
  <div className="brand-kit-content"><h2>{tabs.find(([id])=>id===tab)?.[1]}</h2>
  {tab==='media'?<BrandReferences businessId={business.id} writable={writable} uploadWorkspace={org} visualPicker libraryMode/>:tab==='sources'?<><BrandFiles org={org} brandId={business.id}/><BrandReview section="sources" business={business} onChange={setBrain} onVisualEditing={setVisualEditing}/></>:<>
   <BrandReview key={tab} section={tab as 'profile'|'voice'|'style'} business={business} onChange={setBrain} onVisualEditing={setVisualEditing} onSavingChange={setFactSaving}/><Notice error={error}/>
   {['owner','admin'].includes(business.role)&&<div className="brand-kit-save"><button className="primary" disabled={!brain||busy||visualEditing||factSaving} onClick={()=>void approve()}>{busy?'Saving…':'Save approved brand'}</button>{saved===brain?.revision&&<p role="status">Your approved brand is saved.</p>}{visualEditing&&<p>Save or discard your visual edit first.</p>}</div>}
  </>}
  </div></div>
 </section>;
}
function BrandReview({
  section,
  business,
  onChange,
  onVisualEditing,
  onSavingChange,
  recommendation,
}: {
  business: Business;
  onChange: (brain: any) => void;
  onVisualEditing: (editing:boolean) => void;
  onSavingChange?: (saving:boolean) => void;
  recommendation?: {audience?:string};
  section?: 'profile'|'voice'|'style'|'sources';
}) {
  const [brain, setBrain] = useState<any>(),
    [assets, setAssets] = useState<any[]>([]),
    [error, setError] = useState<unknown>(),
    [field, setField] = useState(section==='voice'?'voice':section==='style'?'colors':"brand_name"),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<any>(),
    manualKey = useRef(""),
    lastBody = useRef(""),
    loadSequence = useRef(0),
    activeSaves = useRef(0);
  function saving(active:boolean){activeSaves.current=Math.max(0,activeSaves.current+(active?1:-1));onSavingChange?.(activeSaves.current>0);}
  const path = scopePath(business),
    writable = ['owner','admin','editor'].includes(business.role);
  useUnsavedChanges(!!value && !busy);
  async function load() {
    const sequence = ++loadSequence.current;
    try {
      const [b, a] = await Promise.all([
        api(path + "/brain"),
        api(path + "/assets"),
      ]);
      if(sequence !== loadSequence.current)return;
      setBrain(b);
      onChange(b);
      setAssets(a.assets);
      if (b.jobs?.length) setJob(b.jobs[0]);
      setError(undefined);
    } catch (e) {
      if(sequence === loadSequence.current)setError(e);
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
    saving(true);
    setError(undefined);
    const body = { field, value },
      serialized = JSON.stringify(body);
    if (serialized !== lastBody.current) {
      manualKey.current = crypto.randomUUID();
      lastBody.current = serialized;
    }
    try {
      await api(path + "/brain/findings", body, "POST", manualKey.current);
      await load();
      setValue("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      saving(false);
    }
  }
  return (
    <>
      {section!=='sources'&&<section className="v5-panel brand-profile-review">
        <div className="section-heading">
          <div>
            <h2>{section==='style'?'Colors and typography':section==='voice'?'Your brand voice':'Your brand profile'}</h2>
            <p>Check the details and make them yours.</p>
          </div>
          <button className="quiet" onClick={()=>void load()}>Refresh profile</button>
        </div>
        <Notice error={error} />
        {!brain ? (
          <Loading />
        ) : (
          <>
            {[
              {title:'Your business',description:'What you do and what makes you different.',fields:['brand_name','offering','products','positioning']},
              {title:'Your audience',description:'The people you want to reach.',fields:['audience']},
              {title:'Your voice',description:'How your brand sounds and what it stands for.',fields:['voice','cta','prohibited_claims']},
              {title:'Your visual identity',description:'The colors and typography behind your content.',fields:['colors','fonts']},
            ].filter(group=>!section||(section==='voice'?group.title==='Your voice':section==='style'?group.title==='Your visual identity':['Your business','Your audience'].includes(group.title))).filter(group=>group.fields.some(field=>brain.findings.some((f:any)=>f.field===field)||['brand_name','offering','audience','voice'].includes(field))).map(group=><section className="brand-profile-section" key={group.title} aria-label={group.title}>
              <header><h3>{group.title}</h3><p>{group.description}</p></header>
              <div className="finding-grid">
              {group.fields.filter(field=>brain.findings.some((f:any)=>f.field===field)).map(field => (
                <FindingGroup
                  key={field}
                  findings={brain.findings.filter((f:any)=>f.field===field)}
                  path={path}
                  writable={writable}
                  onSaved={load}
                  onSaving={saving}
                />
              ))}
              {group.fields.filter(field=>['brand_name','offering','audience','voice'].includes(field)&&!brain.findings.some((f:any)=>f.field===field&&f.status!=='wrong')).map(field=><MissingBrandDetail key={field} field={field} suggested={field==='audience'?recommendation?.audience:field==='offering'?preferredFinding(brain.findings.filter((f:any)=>f.field==='products'&&f.status!=='wrong'))?.value:undefined} path={path} writable={writable} onSaved={load} onSaving={saving}/>)}
            </div>
            </section>)}
            {!brain.findings.length && (
              <p>
                Add the missing details above to build your brand profile.
              </p>
            )}
          </>
        )}
        {writable && (
          <details>
            <summary>Add a detail the website does not cover</summary>
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
                    ].filter(f=>!section||(section==='voice'?['voice','cta','prohibited_claims'].includes(f):section==='style'?['colors','fonts'].includes(f):['brand_name','offering','audience','positioning','products'].includes(f))).map((f) => (
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
            {field==="fonts"&&<BrandFontChoices value={value} onChange={setValue} disabled={busy}/>}
            {field==="colors"&&<BrandStylePreview field={field} value={value}/>}
            <button disabled={busy}>
              {busy ? "Saving…" : "Add for review"}
            </button>
          </form>
          </details>
        )}
      </section>}
      {(!section||section==='style')&&<VisualReview state={brain?.visuals} path={path} writable={writable} onSaved={load} onEditingChange={onVisualEditing} />}
      {(!section||section==='sources')&&assets.some(a=>a.state==="ready"&&["application/pdf","application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(a.content_type))&&<details className="onboarding-source-details"><summary>Read additional brand documents</summary><section className="v5-panel document-evidence">
        <h2>Brand documents</h2>
        <p>Choose an uploaded guideline to add its information to your profile.</p>
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
          You’ll review the extracted details before they become part of your brand.
        </p>
      </section></details>}
    </>
  );
}
function MissingBrandDetail({field,suggested,path,writable,onSaved,onSaving}:{field:string;suggested?:string;path:string;writable:boolean;onSaved:()=>Promise<void>;onSaving?:(active:boolean)=>void}) {
 const [value,setValue]=useState(suggested??''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const request=useRef({body:'',key:''}),previousSuggestion=useRef(suggested??'');
 useEffect(()=>{const previous=previousSuggestion.current;setValue(current=>current===previous?(suggested??''):current);previousSuggestion.current=suggested??'';},[suggested]);
 useUnsavedChanges(value!==(suggested??''));
 async function save(){setBusy(true);onSaving?.(true);setError(undefined);try{const body={field,value:value.trim()},encoded=JSON.stringify(body);if(request.current.body!==encoded)request.current={body:encoded,key:crypto.randomUUID()};await api(path+'/brain/findings',body,'POST',request.current.key);await onSaved();}catch(e){setError(e);}finally{setBusy(false);onSaving?.(false);}}
 return <article className="missing-brand-detail"><h3>{field.replaceAll('_',' ')}</h3><p className="hint">{suggested?'Suggested from your business. Adjust it, then add it to your profile.':'We couldn’t verify this from your website. Add this detail to complete your profile.'}</p><Field label={field==='audience'?'Who are your customers?':`Your ${field.replaceAll('_',' ')}`}>{id=><textarea id={id} value={value} maxLength={4000} disabled={!writable||busy} onChange={e=>setValue(e.target.value)}/>}</Field><Notice error={error}/>{writable&&<button disabled={busy||!value.trim()} onClick={()=>void save()}>{busy?'Saving…':'Add to my profile'}</button>}</article>;
}
function preferredFinding(findings:any[]) {
  return [...findings].sort((a,b)=>{
    const rank=(f:any)=>f.status==='edited'?3:f.status==='correct'?2:f.status==='unreviewed'?1:0;
    return rank(b)-rank(a)||String(b.reviewed_at??'').localeCompare(String(a.reviewed_at??''))||String(a.id).localeCompare(String(b.id));
  })[0];
}
function FindingGroup({findings,path,writable,onSaved,onSaving}:{findings:any[];path:string;writable:boolean;onSaved:()=>Promise<void>;onSaving?:(active:boolean)=>void}) {
  const active=findings.filter(f=>f.status!=='wrong');
  const options=active.length?active:findings;
  const [selected,setSelected]=useState<string>();
  const chosen=options.find(f=>f.id===selected)??preferredFinding(options);
  return <div className="finding-group">
    {options.length>1&&<Field label={`Choose your ${chosen.field.replaceAll('_',' ')} description`}>{id=><select id={id} value={chosen.id} onChange={e=>setSelected(e.target.value)} disabled={!writable}>{options.map((f:any,i:number)=><option key={f.id} value={f.id}>Description {i+1}: {f.value.slice(0,90)}</option>)}</select>}</Field>}
    <Finding key={chosen.id} finding={chosen} alternatives={active.filter(f=>f.id!==chosen.id)} path={path} writable={writable} onSaved={onSaved} onSaving={onSaving}/>
  </div>;
}
function Finding({
  finding: f,
  alternatives = [],
  path,
  writable,
  onSaved,
  onSaving,
}: {
  finding: any;
  alternatives?: any[];
  path: string;
  writable: boolean;
  onSaved: () => Promise<void>;
  onSaving?: (active:boolean) => void;
}) {
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(f.value),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  useUnsavedChanges(editing && value !== f.value);
  async function decide(decision: string) {
    setBusy(true);
    onSaving?.(true);
    setError(undefined);
    try {
      await api(
        `${path}/brain/findings/${f.id}`,
        {
          revision: f.revision,
          decision,
          ...(decision!=="wrong"&&alternatives.length?{alternatives:alternatives.map(a=>({id:a.id,revision:a.revision}))}:{}),
          ...(decision === "edited" ? { value } : {}),
        },
        "PATCH",
      );
      await onSaved();
      setEditing(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      onSaving?.(false);
    }
  }
  return (
    <article className="finding-card">
      <div className="section-heading">
        <h3>{f.field.replaceAll("_", " ")}</h3>
        <span className="status neutral" role="status">
          {busy ? "Saving…" : f.status === "unreviewed" ? "Review" : f.status === "wrong" ? "Excluded" : "Confirmed"}
        </span>
      </div>
      <BrandStylePreview field={f.field} value={editing?value:f.value}/>
      {editing&&f.field==="fonts"&&<BrandFontChoices value={value} onChange={setValue} disabled={busy}/>}
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
      <Notice error={error} />
      {alternatives.length>0&&<p className="hint">Choose Correct or save an edit to use this description instead of the other versions.</p>}
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
              <button aria-pressed={f.status==="correct"||f.status==="edited"} disabled={busy} onClick={() => void decide(f.status==="edited"?"edited":"correct")}>
                Correct
              </button>
              <button aria-pressed={f.status==="wrong"} disabled={busy} onClick={() => void decide("wrong")}>
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
  const [brain, setBrain] = useState<any>(), [error, setError] = useState<unknown>();
  const [view,setView]=useState('facts'),[search,setSearch]=useState(''),[retry,setRetry]=useState(0);
  useEffect(() => {let alive=true;setError(undefined);setBrain(undefined);
    api(scopePath(business) + "/brain").then(value=>{if(alive)setBrain(value);}).catch(e=>{if(alive)setError(e);});
    return()=>{alive=false;};
  }, [business.id,retry]);
  const facts=brain?.active?.snapshot.facts??[];
  return <section className="learnings-workspace" data-view={view}>
    <PageTitle eyebrow={business.name} title="Learnings"><p>Your brand knowledge and what to try next.</p></PageTitle>
    <div className="workspace-view-switch" role="group" aria-label="Learning views">
      {[['facts','Brand knowledge'],['lessons','What’s working'],['sources','Sources']].map(([key,label])=><button key={key} aria-pressed={view===key} onClick={()=>setView(key)}>{label}</button>)}
    </div>
    <Notice error={error}/>{error!==undefined&&<button onClick={()=>setRetry(n=>n+1)}>Try again</button>}
    {view==='facts'&&<div className="learning-proposals"><PerformanceLessons key={business.id} businessId={business.id}/></div>}
    {view==='facts'&&(brain?<section className="learning-facts-panel">
      <div className="heading-row"><div><h2>Brand knowledge</h2><p className="hint">{facts.length} confirmed facts{brain.active&&` · Updated ${new Date(brain.active.approved_at).toLocaleDateString()}`}</p></div><AppLink className="button" href={`/b/${business.id}/onboarding`}>Edit brand facts</AppLink></div>
      {brain.active?<><label className="learning-search"><span className="sr-only">Search brand knowledge</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search your brand knowledge…"/></label>
      <dl className="memory-facts">{facts.filter((f:any)=>(f.field+' '+f.value).toLowerCase().includes(search.toLowerCase())).map((f:any)=><div key={f.id}><dt>{f.field.replaceAll('_',' ')}</dt><dd><span>{f.value}</span><MemoryEvidence fact={f} path={scopePath(business)}/></dd></div>)}</dl>
      {!facts.some((f:any)=>(f.field+' '+f.value).toLowerCase().includes(search.toLowerCase()))&&<p className="workspace-empty">No facts match “{search}”.</p>}</>:<p className="workspace-empty">Confirm your brand profile to start building its knowledge.</p>}
    </section>:!error&&<Loading/>)}
    {view==='sources'&&brain&&<MemorySources sources={brain.sources} businessId={business.id}/>}
    {view==='lessons'&&<PerformanceLessons key={business.id} businessId={business.id}/>}
  </section>;
}
