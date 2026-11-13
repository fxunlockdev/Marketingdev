"use client";
import {BrandDirectionSettings} from './brand-direction';
import {factLabel} from './fact-labels';
import {GuidedBusinessBrief} from "./guided-business";
import {CreativeBrief} from "./creative-brief";
import dynamic from "next/dynamic";
import {ActionButton} from "./design-system";
import {DesvioSelect,DesvioMultiSelect} from './desvio-select';
const CreateChat=dynamic(()=>import('./create-chat').then(module=>module.CreateChat),{loading:()=> <Loading/>});
const Strategies=dynamic(()=>import('./strategies').then(module=>module.Strategies),{loading:()=> <Loading/>});
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
import {BrandStrategy} from "./brand-strategy";
import {KnowledgeView} from "./knowledge-view";
const ContentWorkspace=dynamic(()=>import('./content-workspace').then(module=>module.ContentWorkspace),{loading:()=> <Loading/>});
const PublishingScreen=dynamic(()=>import('./publishing').then(module=>module.PublishingScreen),{loading:()=> <Loading/>});
const CampaignsScreen=dynamic(()=>import('./campaigns').then(module=>module.CampaignsScreen),{loading:()=> <Loading/>});
import {BusinessOverviewPanel} from "./business-overview";
import {ConnectionsScreen} from "./connections";
const CampaignBuilder=dynamic(()=>import('./campaign-builder').then(module=>module.CampaignBuilder),{loading:()=> <Loading/>});
const ContentArchive=dynamic(()=>import('./content-archive').then(module=>module.ContentArchive),{loading:()=> <Loading/>});
import {ContentPreferences} from "./content-preferences";
import {TimeZoneSelect} from "./time-zone-select";
const FirstPlan=dynamic(()=>import('./first-plan').then(module=>module.FirstPlan),{loading:()=> <Loading/>});
const CampaignReview=dynamic(()=>import('./campaign-review').then(module=>module.CampaignReview),{loading:()=> <Loading/>});
const CampaignPostScreen=dynamic(()=>import('./campaign-post').then(module=>module.CampaignPostScreen),{loading:()=> <Loading/>});
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
  ["create", "Create", "star"],
  ["review", "Approvals", "approval"],
  ["brand-kit", "Brand Kit", "orbit"],
  ["brand-strategy", "Strategy", "layers"],
  ["knowledge", "What Desvio knows", "memory"],
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
/** A group heading is shown only above a group that has at least one link, so no empty heading is rendered. */
const groupKeys = sections.map(([key]) => key).filter((key) => groups[key]);
function groupLabel(key: string): string | undefined {
  const label = groups[key];
  if (!label) return undefined;
  const start = sections.findIndex(([k]) => k === key), next = groupKeys.find((k) => sections.findIndex(([s]) => s === k) > start);
  const end = next ? sections.findIndex(([s]) => s === next) : sections.length;
  return end > start ? label : undefined;
}
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
    if(pathname!=="/"&&Date.now()-loadedAt.current<30000&&(!requestedBusinessId||businesses?.some(b=>b.id===requestedBusinessId)))return;
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
        let entryPath: string | undefined;
        if (pathname === "/") {
          if (list.businesses.length === 0 && plan.can_create_business) entryPath = "/brands/new";
          if (list.businesses.length === 1) {
            const first: Business = list.businesses[0];
            entryPath = `/b/${first.id}/overview`;
            if (["owner", "admin"].includes(first.role)) {
              const setup = await api(`/api/v1/businesses/${first.id}/guided-brief`);
              const unfinished = !setup.research_job_id && !setup.answers_locked &&
                (setup.revision > 0 || !first.has_approved_brand);
              if (unfinished) entryPath = `/b/${first.id}/guided-onboarding`;
            }
          }
        }
        if (active) {
          setError(undefined);
          setSession(user);
          setBusinesses(list.businesses);
          if(entryPath)router.replace(entryPath);
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
        <ActionButton onClick={() => location.reload()} label="Try again" />
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
      section === "campaigns" ? "Calendar" : section === "create" ? "Create" : section === "campaign-post" ? "Post" : section === "canvas" ? "Create" : section === "strategies" ? "Strategies" : section === "campaign-review" ? "Calendar" : ["campaign-new","monthly-planning"].includes(section) ? "Plan my content" : section === "manage"
        ? "Manage brand"
        : ["onboarding","guided-onboarding"].includes(section)
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
  if(section === "create" && business)return <CreateChat key={business.id} business={business}/>;
  return (
    <div className={`v5-shell ${menu ? "menu-open" : ""}`}>
      <aside className="v5-sidebar">
        <div className="workspace-switcher"><Wordmark />
          {businesses.length === 0 ? <span className="workspace-context">Your workspace</span> : businesses.length === 1 ? <div className="workspace-business"><span className="workspace-business-initial" aria-hidden="true">{businesses[0].name.slice(0,1)}</span><div><span className="workspace-context">Your business</span><strong>{businesses[0].name}</strong></div></div> : <div className="workspace-business"><span className="workspace-business-initial" aria-hidden="true">{(business?.name??"All").slice(0,1)}</span><Field label="Business">
            {(id) => (
              <DesvioSelect
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
              </DesvioSelect>
            )}
          </Field></div>}
        </div>
        <ActionButton type="button" className="v5-menu"
          aria-expanded={menu}
          aria-controls="business-nav"
          onClick={() => setMenu(!menu)} label="Menu" />
        <nav id="business-nav" aria-label="Main navigation">
          {sections.map(([key, title, icon]) => (
            <div key={key}>
              {groupLabel(key) && <p className="nav-group">{groupLabel(key)}</p>}
              <AppLink
                href={href(key)}
                aria-current={
                  section === key || (["campaign-review","campaign-post","campaigns"].includes(section) && key === "content-plan") ||
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
          <ActionButton
            className="quiet"
            onClick={async () => {
              try {
                await api("/api/auth/sign-out", {});
                router.replace("/sign-in");
              } catch (e) {
                setSignoutError(e);
              }
            }}
           label="Sign out" />
        </div>
        <Notice error={signoutError} />
      </aside>
      <div className="v5-body">
        <header className="v5-topbar">
          <span className="workspace-page-title">{business&&businesses.length!==1&&<><span className="workspace-breadcrumb">{business.name}</span><span className="workspace-separator" aria-hidden="true">/</span></>}{label}</span>
          <div className="header-actions">
            {business&&<GenerationBalance key={business.organization_id} organizationId={business.organization_id}/>}
            {business&&["owner","admin","editor"].includes(business.role)&&<AppLink className="button header-create" href={`/b/${business.id}/create`}><span aria-hidden="true">✳</span> Create</AppLink>}
          </div>
        </header>
        <main id="main" className="v5-main" key={pathname}>
          <Notice error={error}/>
          {resolvingBusiness ? (error ? <ActionButton onClick={()=>{loadedAt.current=0;setWorkspaceRevision(n=>n+1);}} label="Try again" /> : <div role="status" aria-label="Opening business"><Loading /></div>) : section === "brands" ? (
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
          ) : section === "brand-strategy" ? (
            <BrandStrategy key={business.id} business={business}/>
          ) : section === "knowledge" ? (
            <KnowledgeView key={business.id} business={business}/>
          ) : section === "content-preferences" ? (
            <ContentPreferences key={business.id} business={business}/>
          ) : section === "monthly-planning" ? (
            <GuidedBusinessBrief key={`${business.id}:planning`} business={business} accountEmail={session.user.email} planning/>
          ) : section === "guided-onboarding" ? (
            <GuidedBusinessBrief key={business.id} business={business} accountEmail={session.user.email}/>
          ) : section === "onboarding" ? (
            <BrandOnboarding business={business} />
          ) : ["content-plan","review"].includes(section) ? (
            <ContentWorkspace key={`${business.id}:${section}`} business={business} inbox={section==="review"}/>
          ) : section === "create" ? (
            <CreateChat key={business.id} business={business}/>
          ) : section === "campaign-review" ? (
            <CampaignReview key={business.id} business={business}/>
          ) : section === "strategies" ? (
            <Strategies key={business.id} business={business}/>
          ) : section === "campaign-new" ? (
            <GuidedBusinessBrief key={`${business.id}:planning`} business={business} accountEmail={session.user.email} planning/>
          ) : section === "campaigns" ? (
            <ContentWorkspace key={business.id} business={business}/>
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
    router.replace(`/b/${businessId}/${query.size?'campaign-post?'+query.toString():'create'}`);
  },[businessId,router]);
  return <p role="status">Opening your creative workspace…</p>;
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
      <AppLink className="button card-open" href={`/b/${business.id}/${business.has_approved_brand?'onboarding':'guided-onboarding'}`}>
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
      <Notice error={error}/><ActionButton className="danger" type="submit" disabled={busy} label={busy?'Deleting…':'Delete brand'} />
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
    <div className="brands-page">
      <div className="heading-row">
        <PageTitle eyebrow="Your workspace" title="Your businesses">
          <p>
            Each business has its own brand, content, social profile and memory.
          </p>
        </PageTitle>
        {entitlement.can_create_business&&<AppLink className="button primary" href="/brands/new">
          {entitlement.active_businesses===0?"Set up my business":"+ Add business"}
        </AppLink>}
      </div>
      <p className="quota-caption">
        {entitlement.active_businesses} of {entitlement.max_active_businesses} businesses in use.
      </p>
      <div className="v5-business-grid">
        {businesses.map((b, i) => (
          <BusinessCard key={b.id} business={b} index={i} />
        ))}
        {entitlement.can_create_business&&<article className="v5-add-card">
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
        </article>}
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
    </div>
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
      if(documents)setCreated(b);else router.push(`/b/${b.id}/guided-onboarding`);
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
      router.push(`/b/${created.id}/guided-onboarding`);
    }catch(e){setError(e);}finally{setBusy(false);}
  }
  if(created)return <div className="brand-onboarding-experience"><PageTitle eyebrow="Add your business" title="Bring your brand along."><p>Upload any logos, product photos or guidelines you have.</p></PageTitle><Steps step={1}/><BrandFiles org={{id:created.organization_id,name:created.name,role:created.role??'owner'}} brandId={created.id}/><Notice error={error}/><ActionButton className="primary" disabled={busy} onClick={()=>void prepareUploads()} label={busy?"Reading your documents…":"Continue to brand analysis"} /></div>;
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
            {entitlement.active_businesses} of {entitlement.max_active_businesses} businesses are in use. Continue with an existing business below.
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
          <ActionButton className="primary" disabled={busy} label={busy ? "Saving your business…" : "Continue"} />
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
  return <section className="reference-business-chooser">
    <PageTitle eyebrow="Home" title={businesses.length?"Choose a business":"Add your first business"}><p>{businesses.length?"Pick which business to open.":"Create your business to start your workspace."}</p></PageTitle>
    {businesses.length?<div className="reference-business-choices">{businesses.map((b,i)=><AppLink key={b.id} href={`/b/${b.id}/overview`} className="reference-business-choice" style={{background:['#FFD9C7','#CFE6C8','#DDD6FF'][i%3]}}><span aria-hidden="true">{b.name.slice(0,1)}</span><div><h2>{b.name}</h2><p>{b.website?b.website.replace(/^https?:\/\//,'').replace(/\/$/,''):'Your business, in one place.'}</p></div></AppLink>)}</div>:<AppLink className="button primary" href="/brands/new">Add business</AppLink>}
  </section>;
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
  const details: Record<string, string> = {};

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
          <h2>We couldn’t find that page.</h2>
          <p>
            Choose a section from the menu. Your business and brand information
            are saved.
          </p>
          <AppLink className="button" href={`/b/${business.id}/overview`}>
            Go to Home
          </AppLink>
        </section>
      )}
    </>
  );
}
function Billing({ entitlement }: { entitlement: any }) {
  return (
    <div className="billing-page">
      <PageTitle eyebrow="Your account" title="Billing">
        <p>A clear view of your business allowance.</p>
      </PageTitle>
      <section className="v5-panel billing-summary">
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
    </div>
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
        creative_brief: direction.creative_brief ?? {},
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
      if(missing.length)throw new Error(`Complete these details before continuing: ${missing.map(f=>factLabel(f)).join(', ')}.`);
      const repeated=brain.findings.find((f:any)=>f.status!=='wrong'&&brain.findings.filter((other:any)=>other.field===f.field&&other.status!=='wrong').length>1);
      if(repeated)throw new Error(`${factLabel(repeated.field)}: choose one version and select Correct before continuing.`);
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
          <ActionButton onClick={() => void load()} label="Try again" />
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
  // The business name is already known from the owner, so research only has to find what the business offers;
  // a missing name is confirmed on the review step, pre-filled with the name the owner typed.
  const profileReady=!business.website||brain?.findings?.some((f:any)=>['offering','products'].includes(f.field)&&f.status!=='wrong');
  const preparing=!manualSetup&&(intakeState?.jobs.some((j:any)=>['queued','running','retrying'].includes(j.status))||(!!business.website&&(!profileReady||!intakeState||intakeState.jobs.find((j:any)=>j.kind==='brand.analyze')?.status!=='succeeded')));
  return (
    <div className="brand-onboarding-experience">
      <PageTitle
        eyebrow={business.name}
        title={
          confirmed
            ? "Your brand is ready."
            : preparing ? "Your brand starts here." : state.step===2 ? "Does this feel like you?" : "Your content preferences."
        }
      >
        <p>{preparing?"We’ll handle the research. You make it yours.":state.step===2?"We’ve prepared the details. Edit anything before continuing.":"Save your preferences, then review your creative direction."}</p>
      </PageTitle>
      <Steps step={preparing?1:state.step} />
      <Notice error={error} />
      {!manualSetup&&<BrandIntake business={business} onboarding profileReady={profileReady} onState={setIntakeState} onManual={()=>setManualSetup(true)} onComplete={()=>void load()} />}
      {preparing ? null : confirmed ? (
        <section className="v5-panel">
          <h2>Your approved brand profile is saved.</h2>
          <p>
            Your brand is saved. Review your creative direction before planning your content.
          </p>
          <div className="actions"><AppLink className="button" href={`/b/${business.id}/memory`}>
            View brand memory
          </AppLink>
          <AppLink className="button primary" href={`/b/${business.id}/guided-onboarding`}>Continue to my creative direction</AppLink></div>
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
              <ActionButton
                className="primary"
                disabled={busy||visualEditing||factSaving}
                onClick={() => void confirmDetails()}
               label="Confirm details & continue" />
            )}
          </div>
        </>
      ) : (
        <section className="v5-panel onboarding-form">
          <h2>Make your content feel like you</h2>
          <p>Tell us what social media should do for your business. We will use your answers to guide new content plans.</p>
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
            {(id) => <DesvioSelect id={id} disabled={!writable} value={state.business_stage ?? ""} onChange={e => change("business_stage", e.target.value)}>
              <option value="">Choose a stage (optional)</option>
              <option value="pre_launch">Preparing to launch</option>
              <option value="launching">Just launched</option>
              <option value="growing">Growing our customer base</option>
              <option value="established">Established and expanding</option>
            </DesvioSelect>}
          </Field>
          <Field label="What would success look like over the next 90 days?" hint="Optional. This guides your content; it is a target, not a promised result.">
            {(id, hint) => <textarea id={id} aria-describedby={hint} disabled={!writable} maxLength={600} value={state.growth_expectation ?? ""} placeholder="For example: attract 20 qualified enquiries a month for our new service." onChange={e => change("growth_expectation", e.target.value)} />}
          </Field>
          <Field label="Primary goal">
            {(id) => (
              <DesvioSelect
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
              </DesvioSelect>
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
          <DesvioMultiSelect label="Preferred channels" value={state.channels} options={['linkedin','instagram','facebook'].map(value=>({value,label:value==='linkedin'?'LinkedIn':value==='instagram'?'Instagram':'Facebook'}))} onChange={next=>change('channels',next)} disabled={!writable}/>
          <CreativeBrief value={state.creative_brief} onChange={next=>change("creative_brief",next)} disabled={!writable||busy}/>
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
              <ActionButton disabled={busy} onClick={() => void save(2)} label="Back to brand review" />
              <ActionButton disabled={busy} onClick={() => void save(3)} label="Save goals" />
              {["owner","admin"].includes(business.role)&&<ActionButton disabled={busy} onClick={async()=>{if(await save(3,true))setConfirmed(true);}} label="Save brand without a plan" />}

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
 const tabs=[['media','Media Library'],['direction','Creative direction'],['style','Brand Style'],['voice','Brand Voice'],['profile','Brand Profile'],['sources','Source Materials']];
 useEffect(()=>{const id=window.location.hash.slice(1);if(tabs.some(([tabId])=>tabId===id))setTab(id);},[]);
 return <section className="brand-kit-screen"><header className="brand-kit-heading"><p>{business.name}</p><h1>Brand Kit</h1></header>
  <div className="brand-kit-layout"><nav className="brand-kit-navigation" aria-label="Brand Kit sections">{tabs.map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} disabled={busy||factSaving} onClick={()=>{if(tab!==id&&confirmNavigation()){setTab(id);history.replaceState(history.state,'',`#${id}`);setBrain(undefined);setSaved(undefined);setVisualEditing(false);setError(undefined);}}}>{label}</button>)}</nav>
  <div className="brand-kit-content"><h2>{tabs.find(([id])=>id===tab)?.[1]}</h2>
  {tab==='media'?<BrandReferences businessId={business.id} writable={writable} uploadWorkspace={org} visualPicker libraryMode/>:tab==='direction'?<BrandDirectionSettings business={business}/>:tab==='sources'?<><BrandFiles org={org} brandId={business.id}/><BrandReview section="sources" business={business} onChange={setBrain} onVisualEditing={setVisualEditing}/></>:<>
   <BrandReview key={tab} section={tab as 'profile'|'voice'|'style'} business={business} onChange={setBrain} onVisualEditing={setVisualEditing} onSavingChange={setFactSaving}/><Notice error={error}/>
   {['owner','admin'].includes(business.role)&&<div className="brand-kit-save"><ActionButton className="primary" disabled={!brain||busy||visualEditing||factSaving} onClick={()=>void approve()} label={busy?'Saving…':'Save approved brand'} />{saved===brain?.revision&&<p role="status">Your approved brand is saved.</p>}{visualEditing&&<p>Save or discard your visual edit first.</p>}</div>}
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
          <ActionButton className="quiet" onClick={()=>void load()} label="Refresh profile" />
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
              {group.fields.filter(field=>['brand_name','offering','audience','voice'].includes(field)&&!brain.findings.some((f:any)=>f.field===field&&f.status!=='wrong')).map(field=><MissingBrandDetail key={field} field={field} suggested={field==='brand_name'?business.name:field==='audience'?recommendation?.audience:field==='offering'?preferredFinding(brain.findings.filter((f:any)=>f.field==='products'&&f.status!=='wrong'))?.value:undefined} path={path} writable={writable} onSaved={load} onSaving={saving}/>)}
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
                  <DesvioSelect
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
                        {factLabel(f)}
                      </option>
                    ))}
                  </DesvioSelect>
                )}
              </Field>
              {field!=="fonts"&&<Field label="Fact">
                {(id) => (
                  <textarea
                    id={id}
                    required
                    maxLength={4000}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                )}
              </Field>}
            </div>
            {field==="fonts"&&<BrandFontChoices value={value} onChange={setValue} disabled={busy}/>}
            {field==="colors"&&<BrandStylePreview field={field} value={value}/>}
            <ActionButton disabled={busy||!value.trim()} label={busy ? "Saving…" : "Add for review"} />
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
                <ActionButton
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
                 label="Extract brand evidence" />
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
 return <article className="missing-brand-detail"><h3>{factLabel(field)}</h3><p className="hint">{suggested?'Suggested from your business. Adjust it, then add it to your profile.':'We couldn’t verify this from your website. Add this detail to complete your profile.'}</p><Field label={field==='audience'?'Who are your customers?':factLabel(field)}>{id=><textarea id={id} value={value} maxLength={4000} disabled={!writable||busy} onChange={e=>setValue(e.target.value)}/>}</Field><Notice error={error}/>{writable&&<ActionButton disabled={busy||!value.trim()} onClick={()=>void save()} label={busy?'Saving…':'Add to my profile'} />}</article>;
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
    {options.length>1&&<Field label={`${factLabel(chosen.field)}: choose a version`}>{id=><DesvioSelect id={id} value={chosen.id} onChange={e=>setSelected(e.target.value)} disabled={!writable}>{options.map((f:any,i:number)=><option key={f.id} value={f.id}>Description {i+1}: {f.value.slice(0,90)}</option>)}</DesvioSelect>}</Field>}
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
        <h3>{factLabel(f.field)}</h3>
        <span className="status neutral" role="status">
          {busy ? "Saving…" : f.status === "unreviewed" ? "Review" : f.status === "wrong" ? "Excluded" : "Confirmed"}
        </span>
      </div>
      <BrandStylePreview field={f.field} value={editing?value:f.value}/>
      {editing&&f.field==="fonts"&&<BrandFontChoices value={value} onChange={setValue} disabled={busy}/>}
      {editing && f.field!=="fonts" ? (
        <Field label={`Edit ${factLabel(f.field)}`}>
          {(id) => (
            <textarea
              id={id}
              maxLength={4000}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
      ) : !editing ? (
        <p>{f.value}</p>
      ) : null}
      <Notice error={error} />
      {alternatives.length>0&&<p className="hint">Choose Correct or save an edit to use this description instead of the other versions.</p>}
      {writable && (
        <div className="actions">
          {editing ? (
            <>
              <ActionButton disabled={busy} onClick={() => void decide("edited")} label="Save correction" />
              <ActionButton disabled={busy} onClick={() => setEditing(false)} label="Cancel" />
            </>
          ) : (
            <>
              <ActionButton aria-pressed={f.status==="correct"||f.status==="edited"} disabled={busy} onClick={() => void decide(f.status==="edited"?"edited":"correct")} label="Correct" />
              <ActionButton aria-pressed={f.status==="wrong"} disabled={busy} onClick={() => void decide("wrong")} label="Wrong" />
              <ActionButton
                disabled={busy}
                onClick={() => {
                  setValue(f.value);
                  setEditing(true);
                }}
               label="Edit" />
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
    <Notice error={error}/>{error!==undefined&&<ActionButton onClick={()=>setRetry(n=>n+1)} label="Try again" />}
    {view==='facts'&&<div className="learning-proposals"><PerformanceLessons key={business.id} businessId={business.id}/></div>}
    {view==='facts'&&(brain?<section className="learning-facts-panel">
      <div className="heading-row"><div><h2>Brand knowledge</h2><p className="hint">{facts.length} confirmed facts{brain.active&&` · Updated ${new Date(brain.active.approved_at).toLocaleDateString()}`}</p></div><AppLink className="button" href={`/b/${business.id}/onboarding`}>Edit brand facts</AppLink></div>
      {brain.active?<><label className="learning-search"><span className="sr-only">Search brand knowledge</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search your brand knowledge…"/></label>
      <dl className="memory-facts">{facts.filter((f:any)=>(f.field+' '+f.value).toLowerCase().includes(search.toLowerCase())).map((f:any)=><div key={f.id}><dt>{factLabel(f.field)}</dt><dd><span>{f.value}</span><MemoryEvidence fact={f} path={scopePath(business)}/></dd></div>)}</dl>
      {!facts.some((f:any)=>(f.field+' '+f.value).toLowerCase().includes(search.toLowerCase()))&&<p className="workspace-empty">No facts match “{search}”.</p>}</>:<p className="workspace-empty">Confirm your brand profile to start building its knowledge.</p>}
    </section>:!error&&<Loading/>)}
    {view==='sources'&&brain&&<MemorySources sources={brain.sources} businessId={business.id}/>}
    {view==='lessons'&&<PerformanceLessons key={business.id} businessId={business.id}/>}
  </section>;
}
