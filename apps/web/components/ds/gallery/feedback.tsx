"use client";
import {useState} from 'react';
import styles from './gallery.module.css';
import {Section} from './foundations';
import {Button} from '../button';
import {Card, CardHeader} from '../card';
import {Badge} from '../badge';
import {Text} from '../text';
import {Modal, Drawer} from '../modal';
import {Menu, Popover} from '../popover';
import {Tooltip} from '../tooltip';
import {useToast} from '../toast';
import {Disclosure} from '../disclosure';
import {EmptyState} from '../empty-state';
import {Skeleton, SkeletonCard, SkeletonGroup, SkeletonText} from '../skeleton';
import {Table, TableContainer, TBody, Td, Th, THead, Tr} from '../table';
import {AnimatedNumber} from '../animated-number';
import {CalendarIcon, InfoIcon, SparkIcon} from '../icons';

const POSTS = [
  {title: 'Family homes near Hiranandani Estate', channel: 'Instagram', status: ['positive', 'Published'] as const, reach: 12840},
  {title: 'What to ask before you book a site visit', channel: 'LinkedIn', status: ['info', 'Scheduled'] as const, reach: 0},
  {title: 'Retail spaces now open for enquiries', channel: 'Facebook', status: ['caution', 'To review'] as const, reach: 0},
  {title: 'Old launch teaser', channel: 'Instagram', status: ['danger', 'Failed'] as const, reach: 0},
];

/** Overlays, feedback, loading and data components. */
export function Feedback() {
  const [modal, setModal] = useState(false), [drawer, setDrawer] = useState(false), [credits, setCredits] = useState(9417), [loading, setLoading] = useState(true);
  const {toast} = useToast();
  return (
    <>
      <Section id="overlays" title="Overlays" description="Modals, drawers, popovers and menus are frosted glass and grow from the control that opened them.">
        <Card>
          <div className={styles.row}>
            <Button variant="secondary" onClick={() => setModal(true)}>Open modal</Button>
            <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
            <Popover title="Credits" trigger={<Button variant="secondary">Open popover</Button>}>
              <Text tone="muted" size="callout">Images use 1 credit, carousels 5 and videos 20. Unused credits roll over each month.</Text>
            </Popover>
            <Menu trigger={<Button variant="secondary">Open menu</Button>} items={[
              {label: 'Edit post', icon: <SparkIcon />, onSelect: () => toast({title: 'Editing post'})},
              {label: 'Reschedule', icon: <CalendarIcon />, onSelect: () => toast({title: 'Pick a new date'})},
              'separator',
              {label: 'Archive post', destructive: true, onSelect: () => toast({title: 'Post archived', tone: 'caution'})},
            ]} />
            <Tooltip content="Evidence found on 2 pages of your website"><Button variant="ghost" icon={<InfoIcon />} aria-label="About this evidence" /></Tooltip>
          </div>
        </Card>
        <Modal open={modal} onOpenChange={setModal} title="Approve 4 posts?" description="They will be scheduled for next week on Instagram and LinkedIn."
          footer={<><Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button><Button onClick={() => { setModal(false); toast({title: '4 posts approved', description: 'Scheduled for next week.', tone: 'positive'}); }}>Approve posts</Button></>}>
          <Text tone="muted">You can still edit or unschedule each post from the calendar before it goes out.</Text>
        </Modal>
        <Drawer open={drawer} onOpenChange={setDrawer} title="Post details" description="Thursday 19 November · Instagram"
          footer={<><Button variant="ghost" onClick={() => setDrawer(false)}>Close</Button><Button onClick={() => setDrawer(false)}>Save changes</Button></>}>
          <div className={styles.stack}>
            <Text>Family homes near Hiranandani Estate, built around everyday routines.</Text>
            <Text tone="muted" size="callout">The drawer keeps its header and footer in place while long content scrolls.</Text>
          </div>
        </Drawer>
      </Section>

      <Section id="feedback" title="Feedback" description="Badges say status in words, toasts confirm what happened, and skeletons stand in while content loads.">
        <div className={styles.gridWide}>
          <Card>
            <div className={styles.stack}>
              <div className={styles.row}>
                <Badge tone="positive" dot>Approved</Badge><Badge tone="info" dot>Scheduled</Badge><Badge tone="caution" dot>To review</Badge>
                <Badge tone="danger" dot>Failed</Badge><Badge tone="neutral">Draft</Badge><Badge tone="accent">New</Badge>
              </div>
              <div className={styles.row}>
                <Button variant="secondary" size="sm" onClick={() => toast({title: 'Brand profile approved', description: 'You can create posts now.', tone: 'positive'})}>Success toast</Button>
                <Button variant="secondary" size="sm" onClick={() => toast({title: 'Instagram needs reconnecting', tone: 'caution', action: {label: 'Reconnect', onClick: () => undefined}})}>Toast with action</Button>
                <Button variant="secondary" size="sm" onClick={() => toast({title: 'Couldn’t save your changes', description: 'Check your connection and try again.', tone: 'danger'})}>Error toast</Button>
              </div>
              <div className={styles.row}>
                <span className={styles.metric}><AnimatedNumber value={credits} format={n => Math.round(n).toLocaleString('en-US')} /></span>
                <Text tone="muted" size="callout">credits</Text>
                <Button variant="secondary" size="sm" onClick={() => setCredits(c => c - 250)}>Use 250</Button>
                <Button variant="ghost" size="sm" onClick={() => setCredits(9417)}>Reset</Button>
              </div>
            </div>
          </Card>
          <Card>
            <div className={styles.stack}>
              <div className={styles.row}><Button variant="secondary" size="sm" onClick={() => setLoading(v => !v)}>{loading ? 'Show content' : 'Show loading'}</Button></div>
              {loading ? (
                <SkeletonGroup label="Loading posts"><div className={styles.stack}><Skeleton height="2.5rem" radius="md" /><SkeletonText lines={3} /></div></SkeletonGroup>
              ) : (
                <div className={styles.stack}><CardHeader title="Upcoming posts" description="Next 7 days" level={3} /><Text tone="muted">Three posts are scheduled and one is waiting for your approval.</Text></div>
              )}
            </div>
          </Card>
          <SkeletonGroup label="Loading card"><SkeletonCard /></SkeletonGroup>
          <EmptyState tone="card" icon={<CalendarIcon />} title="Nothing planned yet" description="Plan a month of posts and they will appear here." action={<Button variant="secondary">Plan my content</Button>} />
        </div>
      </Section>

      <Section id="data" title="Data" description="Tables keep numbers aligned; disclosures open in place with a chevron instead of the browser triangle.">
        <div className={styles.stack}>
          <TableContainer aria-label="Recent posts">
            <Table>
              <THead><Tr><Th>Post</Th><Th>Channel</Th><Th>Status</Th><Th align="end">Reach</Th></Tr></THead>
              <TBody>
                {POSTS.map(p => (
                  <Tr key={p.title}><Td>{p.title}</Td><Td>{p.channel}</Td><Td><Badge tone={p.status[0]} dot>{p.status[1]}</Badge></Td><Td numeric>{p.reach ? p.reach.toLocaleString('en-US') : '—'}</Td></Tr>
                ))}
              </TBody>
            </Table>
          </TableContainer>
          <Card padding="compact">
            <Disclosure title="Activity and results" meta={<Badge tone="neutral">3 updates</Badge>}>
              <Text tone="muted" size="callout">Performance, research and recent activity open here, in place, without a card inside a card.</Text>
            </Disclosure>
            <Disclosure title="Your business answers" defaultOpen>
              <Text tone="muted" size="callout">Residential real estate developer · Families and first-time buyers · Mumbai.</Text>
            </Disclosure>
          </Card>
        </div>
      </Section>
    </>
  );
}
