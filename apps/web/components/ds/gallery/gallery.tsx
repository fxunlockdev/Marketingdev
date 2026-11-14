"use client";
import {useEffect, useLayoutEffect, useState} from 'react';
import styles from './gallery.module.css';
import {Stage} from '../materials';
import {AppShell, BusinessSwitcher} from '../shell';
import {Nav, NavItem, NavSection} from '../nav';
import {Button} from '../button';
import {PageHeader} from '../text';
import {PageTransition} from '../motion';
import {ToastProvider} from '../toast';
import {TooltipProvider} from '../tooltip';
import {AnimatedNumber} from '../animated-number';
import {BulbIcon, CalendarIcon, ChartIcon, CheckCircleIcon, HomeIcon, LayersIcon, PaletteIcon, PlugIcon, SlidersIcon, SparkIcon} from '../icons';
import {Foundations} from './foundations';
import {Controls} from './components';
import {Feedback} from './feedback';

/** The old global stylesheets hang off these body classes; the new system renders without them. */
const LEGACY_BODY_CLASSES = ['desvio-redesign', 'desvio-polished'];
const BUSINESSES = [{id: 'runwal', name: 'Runwal Enterprises'}, {id: 'courtyard', name: 'Courtyard Studio'}, {id: 'test', name: 'Test 1'}];
const NAV = [
  {label: 'Foundations', items: [['colour', 'Colour', <PaletteIcon key="i" />], ['type', 'Type', <LayersIcon key="i" />], ['glass', 'Glass', <SparkIcon key="i" />], ['motion', 'Motion', <SlidersIcon key="i" />]]},
  {label: 'Components', items: [['buttons', 'Buttons', <HomeIcon key="i" />], ['cards', 'Cards', <CalendarIcon key="i" />], ['forms', 'Forms', <CheckCircleIcon key="i" />], ['overlays', 'Overlays', <PlugIcon key="i" />], ['feedback', 'Feedback', <BulbIcon key="i" />], ['data', 'Data', <ChartIcon key="i" />]]},
] as const;

/** Every token and shared component, in every state, inside the real app frame. For design review. */
export function DesignGallery() {
  const [active, setActive] = useState('colour'), [business, setBusiness] = useState('runwal');
  useLayoutEffect(() => {
    const body = document.body, removed = LEGACY_BODY_CLASSES.filter(c => body.classList.contains(c));
    body.classList.remove(...removed);
    return () => body.classList.add(...removed);
  }, []);
  // The pill follows the section in view, so scrolling shows it slide.
  useEffect(() => {
    const ids = NAV.flatMap(group => group.items.map(([id]) => id));
    const observer = new IntersectionObserver(entries => {
      const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.id);
    }, {rootMargin: '-12% 0px -78% 0px'});
    ids.forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);
  return (
    <TooltipProvider>
      <ToastProvider>
        <Stage>
          <AppShell
            brand={<img className={styles.logo} src="/site-brand/brand/desvio-black-lime.svg" alt="Desvio" width="114" height="28" />}
            sidebarHead={<BusinessSwitcher businesses={BUSINESSES} value={business} onChange={setBusiness} />}
            navigation={
              <Nav aria-label="Design system sections" activeKey={active}>
                {NAV.map(group => (
                  <NavSection key={group.label} label={group.label}>
                    {group.items.map(([id, label, icon]) => (
                      <NavItem key={id} href={`#${id}`} icon={icon} active={active === id} onClick={() => setActive(id)}>{label}</NavItem>
                    ))}
                  </NavSection>
                ))}
              </Nav>
            }
            sidebarFoot={<div className={styles.account}><span className={styles.avatar} aria-hidden="true">D</span><span>Dev2 Owner<small>Your account</small></span></div>}
            topbarLeading={<><span className={styles.crumb}>{BUSINESSES.find(b => b.id === business)?.name ?? 'All businesses'}</span><span className={styles.crumb} aria-hidden="true">/</span><strong>Design system</strong></>}
            topbarTrailing={<><span className={styles.credits}><strong><AnimatedNumber value={9417} format={n => Math.round(n).toLocaleString('en-US')} /></strong> credits</span><Button size="sm" icon={<SparkIcon />}>Create</Button></>}
          >
            <PageTransition routeKey="design-system">
              <PageHeader eyebrow="Review" title="Design system" description="Every token and shared component the redesign is built from, in every state. Hover, press, tab through and open things: the motion is part of the design." />
              <div className={styles.sections}>
                <Foundations />
                <Controls />
                <Feedback />
              </div>
            </PageTransition>
          </AppShell>
        </Stage>
      </ToastProvider>
    </TooltipProvider>
  );
}
